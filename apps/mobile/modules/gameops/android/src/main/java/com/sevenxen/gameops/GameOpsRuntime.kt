package com.sevenxen.gameops

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import com.sevenxen.gameops.automation.RecipeRunner
import com.sevenxen.gameops.automation.TeachSession
import com.sevenxen.gameops.capture.CaptureService
import com.sevenxen.gameops.model.StartOptions
import com.sevenxen.gameops.upload.UploadQueue
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** Latest downscaled detector frame (for fingerprints, teach mode and viewport→screen mapping). */
class FrameSnapshot(
  val argb: IntArray,
  val width: Int,
  val height: Int,
  /** game viewport in frame px: x, y, w, h */
  val viewport: IntArray,
  /** size of the captured display (VirtualDisplay) in px, same orientation as the frame */
  val displayW: Int,
  val displayH: Int,
  val screen: String,
  val atMs: Long,
)

data class CaptureEventModel(
  val kind: String,
  val auto: Boolean,
  val path: String,
  val screenshotId: String?,
  val uploaded: Boolean,
  val error: String?,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "kind" to kind, "auto" to auto, "path" to path, "screenshotId" to screenshotId, "uploaded" to uploaded, "error" to error,
  )
}

/**
 * Process-wide session state shared by the Expo module, the foreground CaptureService, the overlay, the
 * AccessibilityService and the upload workers. Events go to JS through [emitter] when the JS runtime is alive;
 * native work never depends on it.
 */
object GameOpsRuntime {
  private const val TAG = "GameOps"

  const val EV_STATUS = "onStatus"
  const val EV_CAPTURE = "onCapture"
  const val EV_SCREEN = "onScreen"
  const val EV_ROOM = "onRoomInfo"
  const val EV_UPLOAD = "onUploadProgress"
  const val EV_ERROR = "onError"
  val EVENTS = arrayOf(EV_STATUS, EV_CAPTURE, EV_SCREEN, EV_ROOM, EV_UPLOAD, EV_ERROR)

  @Volatile
  var appContext: Context? = null
    private set

  @Volatile
  var emitter: ((String, Map<String, Any?>) -> Unit)? = null

  val main = Handler(Looper.getMainLooper())

  // ---- session state (guarded by `this`) ----
  var state: String = "IDLE"
    private set
  var options: StartOptions? = null
    private set
  var screen: String? = null
  var videoPath: String? = null
  var error: String? = null
  var slotList = 0
  var results = 0
  var pendingUploads = 0
  private var liveSince = 0L
  private var accumulatedMs = 0L

  @Volatile
  var runner: RecipeRunner? = null

  @Volatile
  var service: CaptureService? = null

  @Volatile
  var latestFrame: FrameSnapshot? = null

  @Volatile
  var teach: TeachSession? = null

  /** Pending startSession promise: completed by CaptureService once recording is live (or failed). */
  @Volatile
  var startCallback: ((Throwable?) -> Unit)? = null

  fun init(ctx: Context) {
    if (appContext == null) appContext = ctx.applicationContext
    queue // load the persisted queue and resume uploads
  }

  val queue: UploadQueue by lazy {
    UploadQueue(requireNotNull(appContext) { "GameOpsRuntime.init() not called" }, object : UploadQueue.Listener {
      override fun onScreenshotResult(entry: UploadQueue.Entry, screenshotId: String?, error: String?, final: Boolean) {
        emit(
          EV_CAPTURE,
          CaptureEventModel(entry.kind ?: "RESULTS", entry.source == "APP_AUTO", entry.path ?: "", screenshotId, final && error == null, error).toMap(),
        )
        if (final && error == null && entry.matchId == options?.matchId) {
          recordingEvent("capture", "${entry.kind} uploaded${screenshotId?.let { " ($it)" } ?: " (duplicate)"}")
        }
      }

      override fun onPendingChanged(pendingScreenshots: Int) {
        synchronized(this@GameOpsRuntime) { pendingUploads = pendingScreenshots }
        if (state != "IDLE") emitStatus()
      }
    })
  }

  // ---------------------------------------------------------------- state

  @Synchronized
  fun beginSession(opts: StartOptions) {
    options = opts
    state = "STARTING"
    screen = null
    videoPath = null
    error = null
    slotList = 0
    results = 0
    liveSince = 0L
    accumulatedMs = 0L
    runner = null
    latestFrame = null
  }

  fun setState(s: String, err: String? = null) {
    synchronized(this) {
      val now = SystemClock.elapsedRealtime()
      if (state == "LIVE" && s != "LIVE" && liveSince > 0) {
        accumulatedMs += now - liveSince
        liveSince = 0
      }
      if (s == "LIVE" && liveSince == 0L) liveSince = now
      state = s
      if (err != null) error = err
    }
    emitStatus()
    service?.onStateChanged()
  }

  @Synchronized
  fun elapsedMs(): Long = accumulatedMs + if (liveSince > 0) SystemClock.elapsedRealtime() - liveSince else 0L

  fun statusMap(): Map<String, Any?> {
    val r = runner
    val checklist = r?.let { run -> run.steps.mapIndexed { i, s -> mapOf("stepId" to s.id, "done" to run.isDone(i), "label" to s.label) } }
      ?: options?.checklist?.map { mapOf("stepId" to it.id, "done" to false, "label" to it.label) }
      ?: emptyList()
    synchronized(this) {
      return mapOf(
        "state" to state,
        "recordingId" to options?.recordingId,
        "matchId" to options?.matchId,
        "elapsedMs" to elapsedMs().toDouble(),
        "screen" to screen,
        "captures" to mapOf("slotList" to slotList, "results" to results, "pendingUploads" to pendingUploads),
        "checklist" to checklist,
        "videoPath" to videoPath,
        "error" to error,
      )
    }
  }

  // ---------------------------------------------------------------- events

  fun emit(name: String, body: Map<String, Any?>) {
    val e = emitter ?: return
    main.post {
      try {
        e(name, body)
      } catch (t: Throwable) {
        Log.w(TAG, "emit $name failed", t)
      }
    }
  }

  fun emitStatus() = emit(EV_STATUS, statusMap())

  fun emitError(message: String, fatal: Boolean) {
    Log.w(TAG, "error (fatal=$fatal): $message")
    emit(EV_ERROR, mapOf("message" to message, "fatal" to fatal))
  }

  fun emitUploadProgress(recordingId: String, uploaded: Long, total: Long, state: String, error: String?) {
    emit(
      EV_UPLOAD,
      mapOf("recordingId" to recordingId, "uploadedBytes" to uploaded.toDouble(), "totalBytes" to total.toDouble(), "state" to state, "error" to error),
    )
  }

  // ---------------------------------------------------------------- recording events → API

  private val iso: SimpleDateFormat
    get() = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }

  fun nowIso(): String = iso.format(Date())

  /** Queue PATCH /api/manager/recordings/:id { events:[{at,type,detail}], status?, durationSec?, error? }. */
  fun recordingEvent(type: String, detail: String?, status: String? = null, durationSec: Int? = null, errorText: String? = null) {
    val o = options ?: return
    if (appContext == null) return
    val body = JSONObject()
    body.put("events", JSONArray().put(JSONObject().put("at", nowIso()).put("type", type).put("detail", detail?.take(300) ?: JSONObject.NULL)))
    if (status != null) body.put("status", status)
    if (durationSec != null) body.put("durationSec", durationSec.coerceIn(0, 6 * 3600))
    if (errorText != null) body.put("error", errorText.take(300))
    try {
      queue.enqueueRecordingPatch(o.apiBaseUrl, o.token, o.recordingId, body)
    } catch (t: Throwable) {
      Log.w(TAG, "could not queue recording event", t)
    }
  }
}
