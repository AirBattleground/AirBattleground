package com.sevenxen.gameops.capture

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.SystemClock
import android.util.DisplayMetrics
import android.util.Log
import android.view.Display
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.sevenxen.gameops.CaptureEventModel
import com.sevenxen.gameops.FrameSnapshot
import com.sevenxen.gameops.GameOpsRuntime
import com.sevenxen.gameops.Permissions
import com.sevenxen.gameops.R
import com.sevenxen.gameops.autocapture.AutoCaptureController
import com.sevenxen.gameops.automation.AutomationService
import com.sevenxen.gameops.automation.GestureActions
import com.sevenxen.gameops.automation.RecipeRunner
import com.sevenxen.gameops.detect.DetectorBridge
import com.sevenxen.gameops.detect.pixelRectToFrame
import com.sevenxen.gameops.detect.viewportRegionToFrame
import com.sevenxen.gameops.model.FingerprintSpec
import com.sevenxen.gameops.overlay.OverlayController
import com.sevenxen.gameops.upload.VideoUploadWorker
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Foreground service (type mediaProjection) that owns one live match session:
 * MediaProjection → VirtualDisplay → FrameRouter (GL) → H.264 MP4 + detector frames + full-res stills,
 * auto-capture, the floating bubble, the checklist / recipe runner, and recording events to the API.
 *
 * Android 14+ rules honoured: the consent Intent is fresh for every session (requested by the module right
 * before starting us), startForeground(TYPE_MEDIA_PROJECTION) is called BEFORE getMediaProjection(), a
 * MediaProjection.Callback is registered before createVirtualDisplay(), and only ONE VirtualDisplay is created
 * per projection (rotation → VirtualDisplay.resize()).
 */
class CaptureService : Service(), FrameRouter.Listener {
  private val tag = "GameOps.Capture"
  private lateinit var control: HandlerThread
  private lateinit var controlHandler: Handler
  private val io = Executors.newSingleThreadExecutor { r -> Thread(r, "gameops-io") }

  private var projection: MediaProjection? = null
  private var virtualDisplay: VirtualDisplay? = null
  private var router: FrameRouter? = null
  private var encoder: VideoEncoder? = null
  private var overlay: OverlayController? = null
  private var autoCapture: AutoCaptureController? = null
  private var displayListener: DisplayManager.DisplayListener? = null
  private var stopping = false
  private var displayW = 0
  private var displayH = 0
  private var captureDir: File? = null
  private var runnerTicker: Runnable? = null
  private var storageTicker: Runnable? = null
  private var stableScreen: String? = null

  private val projectionCallback = object : MediaProjection.Callback() {
    override fun onStop() {
      // User tapped "Stop sharing" (status bar chip / notification), another app took the projection, or the
      // system revoked it (e.g. screen locked on some Android 15 builds).
      if (!stopping) {
        GameOpsRuntime.emitError("Screen capture was stopped by Android or the user — the session has ended", true)
        controlHandler.post { doStop(wifiOnly = true, reason = "Screen capture stopped by the system/user", failed = false) }
      }
    }

    override fun onCapturedContentResize(width: Int, height: Int) {
      // single-app capture (Android 14 QPR+): content size changed
      onSourceSize(width, height)
    }

    override fun onCapturedContentVisibilityChanged(isVisible: Boolean) {
      if (!isVisible) GameOpsRuntime.emitError("The captured app is not visible — the recording shows nothing until you return to it", false)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    GameOpsRuntime.init(this)
    control = HandlerThread("gameops-control").apply { start() }
    controlHandler = Handler(control.looper)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> {
        // MUST go foreground (typed mediaProjection) before getMediaProjection() on Android 14+.
        try {
          goForeground()
        } catch (t: Throwable) {
          failStart("Could not start the recording service: ${t.message}")
          return START_NOT_STICKY
        }
        val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
        val data: Intent? = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
        else @Suppress("DEPRECATION") intent.getParcelableExtra(EXTRA_RESULT_DATA)
        controlHandler.post { startSession(resultCode, data) }
      }
      ACTION_PAUSE -> controlHandler.post { pause() }
      ACTION_RESUME -> controlHandler.post { resume() }
      ACTION_STOP -> controlHandler.post { doStop(wifiOnly = true, reason = null, failed = false) }
      else -> {
        // Restarted by the system without a projection token: nothing can be resumed.
        if (GameOpsRuntime.service == null) stopSelf()
      }
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    if (!stopping && projection != null) doStop(wifiOnly = true, reason = "Service destroyed", failed = false)
    if (GameOpsRuntime.service === this) GameOpsRuntime.service = null
    control.quitSafely()
    io.shutdown()
    super.onDestroy()
  }

  // ---------------------------------------------------------------- start

  private fun startSession(resultCode: Int, data: Intent?) {
    val opts = GameOpsRuntime.options
    if (opts == null || data == null || resultCode != Activity.RESULT_OK) {
      failStart("Screen capture permission was not granted")
      return
    }
    try {
      val mpm = getSystemService(MediaProjectionManager::class.java)
      val mp = mpm.getMediaProjection(resultCode, data) ?: throw IllegalStateException("MediaProjection unavailable")
      projection = mp
      mp.registerCallback(projectionCallback, controlHandler)

      val (w, h, dpi) = realDisplay()
      displayW = w
      displayH = h
      val r = FrameRouter(this)
      router = r
      val input = r.start(w, h)
      r.detectorEnabled = opts.autoCapture || opts.checklist.any { it.expect != null }

      if (opts.recordVideo) {
        val dir = recordingsDir()
        if (dir.usableSpace < MIN_FREE_START) throw LowStorageException(dir.usableSpace)
        val (ew, eh) = VideoEncoder.chooseSize(maxOf(w, h), minOf(w, h), opts.quality)
        val file = File(dir, "rec-${opts.recordingId}-${stamp()}.mp4")
        val enc = VideoEncoder(file, ew, eh, VideoEncoder.bitrateFor(opts.quality), 30) { msg ->
          GameOpsRuntime.emitError(msg, true)
          controlHandler.post { doStop(wifiOnly = true, reason = msg, failed = true) }
        }
        encoder = enc
        r.setEncoderSurface(enc.inputSurface, ew, eh)
        GameOpsRuntime.videoPath = file.absolutePath
      }

      virtualDisplay = mp.createVirtualDisplay(
        "7xen-capture", w, h, dpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, input, null, controlHandler,
      ) ?: throw IllegalStateException("createVirtualDisplay returned null")

      watchRotation()
      captureDir = File(filesDir, "gameops/captures/${opts.matchId}").apply { mkdirs() }
      autoCapture = AutoCaptureController(DetectorBridge::distance)
      GameOpsRuntime.service = this
      GameOpsRuntime.main.post { setupOverlayAndRunner() }
      startStorageWatch()

      GameOpsRuntime.setState("LIVE")
      GameOpsRuntime.recordingEvent(
        "start",
        "${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE} · ${w}x$h · " +
          (encoder?.let { "${it.width}x${it.height} ${opts.quality}" } ?: "no video"),
        status = "LIVE",
      )
      updateNotification()
      GameOpsRuntime.startCallback?.invoke(null)
      GameOpsRuntime.startCallback = null
      if (opts.launchBgmi) GameOpsRuntime.main.postDelayed({ Permissions.launchBgmi(this) }, 400)
    } catch (t: Throwable) {
      Log.e(tag, "start failed", t)
      val msg = when (t) {
        is LowStorageException -> t.message!!
        is SecurityException -> "Screen capture permission was rejected by Android: ${t.message}"
        else -> "Could not start recording: ${t.message ?: t.javaClass.simpleName}"
      }
      teardown(keepVideo = false)
      failStart(msg)
    }
  }

  private fun setupOverlayAndRunner() {
    val opts = GameOpsRuntime.options ?: return
    val ov = OverlayController(this, object : OverlayController.Actions {
      override fun captureTeamList() = requestStill("SLOT_LIST", auto = false, cb = null)
      override fun captureResults() = requestStill("RESULTS", auto = false, cb = null)
      override fun togglePause() {
        controlHandler.post { if (GameOpsRuntime.state == "PAUSED") resume() else pause() }
      }
      override fun stop() {
        controlHandler.post { doStop(wifiOnly = true, reason = null, failed = false) }
      }
      override fun tickStep(stepId: String) {
        GameOpsRuntime.runner?.markDone(stepId)
      }
    })
    if (ov.show()) overlay = ov
    else GameOpsRuntime.emitError("\"Display over other apps\" is off — no floating bubble; use the notification to pause/stop", false)

    if (opts.checklist.isNotEmpty()) {
      var auto = opts.autoMode
      if (auto && !AutomationService.isEnabled(this)) {
        auto = false
        GameOpsRuntime.emitError("Auto mode needs the 7XEN accessibility service — running the checklist in assisted mode", false)
      }
      var lastDoneCount = -1
      val runner = RecipeRunner(opts.checklist, auto, GestureActions(this) { s -> overlay?.setSuspended(s) }, { SystemClock.elapsedRealtime() }) { r ->
        val doneCount = r.doneList().count { it.second }
        GameOpsRuntime.main.post { overlay?.refresh() }
        if (doneCount != lastDoneCount) {
          lastDoneCount = doneCount
          GameOpsRuntime.emitStatus()
          if (r.phase == RecipeRunner.Phase.DONE) GameOpsRuntime.recordingEvent("room_created", "checklist complete (${if (r.autoMode) "auto" else "assisted"})")
        }
      }
      GameOpsRuntime.runner = runner
      runner.start()
      val t = object : Runnable {
        override fun run() {
          if (stopping) return
          // timer tick (timeouts, waits); frame-based matching happens in onDetectorFrame
          runner.tick { null }
          controlHandler.postDelayed(this, 250)
        }
      }
      runnerTicker = t
      controlHandler.postDelayed(t, 250)
    }
  }

  private fun failStart(message: String) {
    GameOpsRuntime.setState("ERROR", message)
    GameOpsRuntime.startCallback?.invoke(IllegalStateException(message))
    GameOpsRuntime.startCallback = null
    GameOpsRuntime.recordingEvent("error", message, status = "FAILED", errorText = message)
    stopForegroundCompat()
    stopSelf()
  }

  // ---------------------------------------------------------------- pause / resume / stop

  fun pause() {
    if (GameOpsRuntime.state != "LIVE") return
    router?.setPaused(true)
    GameOpsRuntime.runner?.pause()
    GameOpsRuntime.setState("PAUSED")
    GameOpsRuntime.recordingEvent("pause", null)
    updateNotification()
  }

  fun resume() {
    if (GameOpsRuntime.state != "PAUSED") return
    router?.setPaused(false)
    GameOpsRuntime.runner?.resume()
    GameOpsRuntime.setState("LIVE")
    GameOpsRuntime.recordingEvent("resume", null)
    updateNotification()
  }

  /** Runs on the control thread. */
  fun doStop(wifiOnly: Boolean, reason: String?, failed: Boolean) {
    if (stopping) return
    stopping = true
    GameOpsRuntime.setState("STOPPING")
    val opts = GameOpsRuntime.options
    val durationSec = (GameOpsRuntime.elapsedMs() / 1000).toInt()
    val videoOk = teardown(keepVideo = true)
    val enc = encoder
    if (opts != null) {
      GameOpsRuntime.recordingEvent(
        "stop",
        reason ?: if (videoOk) "video ${(enc?.bytesWritten ?: 0) / (1024 * 1024)} MB" else "no video",
        status = if (failed) "FAILED" else "STOPPED",
        durationSec = durationSec,
        errorText = if (failed) reason else null,
      )
      val path = GameOpsRuntime.videoPath
      if (videoOk && path != null && enc != null) {
        VideoUploadWorker.enqueue(this, opts.recordingId, path, opts.apiBaseUrl, opts.token, enc.width, enc.height, wifiOnly)
      } else if (opts.recordVideo) {
        GameOpsRuntime.videoPath = null
      }
    }
    GameOpsRuntime.setState(if (failed) "ERROR" else "STOPPED", if (failed) reason else null)
    GameOpsRuntime.service = null
    stopForegroundCompat()
    stopSelf()
  }

  /** Releases capture resources. Returns true when a playable video file was produced. */
  private fun teardown(keepVideo: Boolean): Boolean {
    runnerTicker?.let { controlHandler.removeCallbacks(it) }
    storageTicker?.let { controlHandler.removeCallbacks(it) }
    GameOpsRuntime.runner?.pause()
    val ov = overlay
    overlay = null
    GameOpsRuntime.main.post { ov?.remove() }
    displayListener?.let { getSystemService(DisplayManager::class.java)?.unregisterDisplayListener(it) }
    displayListener = null
    try {
      router?.setEncoderSurface(null, 0, 0)
    } catch (_: Throwable) {
    }
    val ok = encoder?.stop() ?: false
    try {
      virtualDisplay?.release()
    } catch (_: Throwable) {
    }
    virtualDisplay = null
    try {
      projection?.unregisterCallback(projectionCallback)
      projection?.stop()
    } catch (_: Throwable) {
    }
    projection = null
    router?.release()
    router = null
    if (!keepVideo) GameOpsRuntime.videoPath?.let { File(it).delete() }
    return ok
  }

  // ---------------------------------------------------------------- stills

  /**
   * Grab a full-resolution still: hide the bubble, wait a frame, render the current texture into the full-res
   * ImageReader, write JPEG q90, queue the upload. [cb] receives the CaptureEvent (or an error message).
   */
  fun requestStill(kind: String, auto: Boolean, cb: ((CaptureEventModel?, String?) -> Unit)?) {
    val r = router
    val opts = GameOpsRuntime.options
    if (r == null || opts == null || stopping) {
      cb?.invoke(null, "No live session")
      return
    }
    val main = GameOpsRuntime.main
    main.post {
      val ov = overlay
      ov?.setSuspended(true)
      main.postDelayed({
        r.requestStill { bmp ->
          main.post { ov?.setSuspended(false) }
          if (bmp == null) {
            val msg = "No screen frame available yet — try again in a second"
            cb?.invoke(null, msg)
            if (!auto) GameOpsRuntime.emitError(msg, false)
            return@requestStill
          }
          io.execute { saveStill(bmp, kind, auto, opts.matchId, cb) }
        }
      }, if (ov?.isShowing == true) 180L else 0L)
    }
  }

  private fun saveStill(bmp: Bitmap, kind: String, auto: Boolean, matchId: String, cb: ((CaptureEventModel?, String?) -> Unit)?) {
    try {
      val dir = captureDir ?: File(filesDir, "gameops/captures/$matchId").apply { mkdirs() }
      if (dir.usableSpace < 20L * 1024 * 1024) throw LowStorageException(dir.usableSpace)
      val f = File(dir, "${stamp()}-${kind.lowercase()}${if (auto) "-auto" else ""}.jpg")
      FileOutputStream(f).use { bmp.compress(Bitmap.CompressFormat.JPEG, 90, it) }
      bmp.recycle()
      synchronized(GameOpsRuntime) {
        if (kind == "SLOT_LIST") GameOpsRuntime.slotList++ else GameOpsRuntime.results++
      }
      val opts = GameOpsRuntime.options
      if (opts != null) GameOpsRuntime.queue.enqueueScreenshot(opts.apiBaseUrl, opts.token, matchId, f.absolutePath, kind, auto)
      val ev = CaptureEventModel(kind, auto, f.absolutePath, null, false, null)
      GameOpsRuntime.emit(GameOpsRuntime.EV_CAPTURE, ev.toMap())
      GameOpsRuntime.emitStatus()
      GameOpsRuntime.main.post { overlay?.refresh() }
      updateNotification()
      cb?.invoke(ev, null)
    } catch (t: Throwable) {
      val msg = if (t is LowStorageException) t.message!! else "Could not save the screenshot: ${t.message}"
      GameOpsRuntime.emitError(msg, false)
      cb?.invoke(null, msg)
    }
  }

  // ---------------------------------------------------------------- detection (analysis thread)

  override fun onDetectorFrame(argb: IntArray, width: Int, height: Int) {
    if (stopping) return
    val opts = GameOpsRuntime.options ?: return
    val det = DetectorBridge.classify(argb, width, height)
    val vp = det.viewport
    GameOpsRuntime.latestFrame = FrameSnapshot(argb, width, height, vp, displayW, displayH, det.screen, System.currentTimeMillis())
    if (GameOpsRuntime.state != "LIVE") return

    val ac = autoCapture
    if (ac != null) {
      // hash the part that scrolls: detector's panel (results gold panel / team-list card grid) when given
      val panel = det.panel
      val frameRegion = when {
        panel != null -> pixelRectToFrame(panel, width, height)
        det.screen == "RESULTS" -> viewportRegionToFrame(RESULTS_PANEL_REGION, vp, width, height)
        else -> viewportRegionToFrame(FULL_REGION, vp, width, height)
      }
      val contentHash = DetectorBridge.dHash(argb, width, height, frameRegion)
      val kind = ac.onFrame(det.screen, det.confidence, contentHash, SystemClock.elapsedRealtime())
      val stable = ac.stableScreen
      if (stable != null && stable != stableScreen) {
        stableScreen = stable
        GameOpsRuntime.screen = stable
        GameOpsRuntime.emit(GameOpsRuntime.EV_SCREEN, mapOf("screen" to stable, "confidence" to det.confidence.toDouble()))
        GameOpsRuntime.emitStatus()
        if (stable != "OTHER") GameOpsRuntime.recordingEvent("screen", stable)
      }
      if (kind != null && opts.autoCapture) requestStill(kind, auto = true, cb = null)
    }

    GameOpsRuntime.runner?.let { runner ->
      val cache = HashMap<FingerprintSpec, Boolean>()
      runner.tick { fp ->
        cache.getOrPut(fp) {
          val h = DetectorBridge.dHash(argb, width, height, viewportRegionToFrame(fp.region, vp, width, height))
          DetectorBridge.distance(h, fp.hash) <= fp.maxDistance
        }
      }
    }
  }

  override fun onRouterError(message: String) {
    Log.w(tag, message)
  }

  // ---------------------------------------------------------------- rotation / display

  private fun watchRotation() {
    val dm = getSystemService(DisplayManager::class.java) ?: return
    val l = object : DisplayManager.DisplayListener {
      override fun onDisplayAdded(displayId: Int) = Unit
      override fun onDisplayRemoved(displayId: Int) = Unit
      override fun onDisplayChanged(displayId: Int) {
        if (displayId != Display.DEFAULT_DISPLAY) return
        val (w, h, _) = realDisplay()
        onSourceSize(w, h)
      }
    }
    dm.registerDisplayListener(l, controlHandler)
    displayListener = l
  }

  private fun onSourceSize(w: Int, h: Int) {
    if (w <= 0 || h <= 0 || (w == displayW && h == displayH)) return
    displayW = w
    displayH = h
    val (_, _, dpi) = realDisplay()
    try {
      virtualDisplay?.resize(w, h, dpi)
    } catch (t: Throwable) {
      Log.w(tag, "resize", t)
    }
    router?.resize(w, h)
  }

  @Suppress("DEPRECATION")
  private fun realDisplay(): Triple<Int, Int, Int> {
    val dm = DisplayMetrics()
    val d = getSystemService(DisplayManager::class.java).getDisplay(Display.DEFAULT_DISPLAY)
    d.getRealMetrics(dm)
    return Triple(dm.widthPixels, dm.heightPixels, dm.densityDpi)
  }

  // ---------------------------------------------------------------- storage

  private fun recordingsDir(): File {
    val ext = getExternalFilesDir(Environment.DIRECTORY_MOVIES)
    val dir = File(ext ?: filesDir, "7xen-recordings")
    dir.mkdirs()
    return dir
  }

  private fun startStorageWatch() {
    val t = object : Runnable {
      override fun run() {
        if (stopping) return
        val f = GameOpsRuntime.videoPath?.let { File(it).parentFile }
        if (f != null && f.usableSpace < MIN_FREE_RUNNING) {
          val msg = "Phone storage is almost full (${f.usableSpace / (1024 * 1024)} MB free) — recording stopped to keep the video safe"
          GameOpsRuntime.emitError(msg, true)
          doStop(wifiOnly = true, reason = msg, failed = false)
          return
        }
        controlHandler.postDelayed(this, 10_000)
      }
    }
    storageTicker = t
    controlHandler.postDelayed(t, 10_000)
  }

  // ---------------------------------------------------------------- notification

  private fun goForeground() {
    ensureChannel()
    val n = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
    } else {
      startForeground(NOTIF_ID, n)
    }
  }

  fun onStateChanged() = updateNotification()

  private fun updateNotification() {
    try {
      getSystemService(NotificationManager::class.java)?.notify(NOTIF_ID, buildNotification())
    } catch (_: Throwable) {
    }
  }

  private fun buildNotification(): Notification {
    val state = GameOpsRuntime.state
    val opts = GameOpsRuntime.options
    val paused = state == "PAUSED"
    val b = NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(if (paused) android.R.drawable.ic_media_pause else android.R.drawable.presence_video_online)
      .setContentTitle(opts?.title ?: "7XEN live match")
      .setContentText(
        "${OverlayController.stateLabel(state)} · Team list ${GameOpsRuntime.slotList} · Results ${GameOpsRuntime.results}",
      )
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
    if (state == "LIVE") {
      b.setUsesChronometer(true).setWhen(System.currentTimeMillis() - GameOpsRuntime.elapsedMs())
    }
    packageManager.getLaunchIntentForPackage(packageName)?.let {
      b.setContentIntent(PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
    }
    if (state == "LIVE" || state == "PAUSED") {
      b.addAction(0, if (paused) "Resume" else "Pause", servicePending(if (paused) ACTION_RESUME else ACTION_PAUSE, 1))
      b.addAction(0, "Stop", servicePending(ACTION_STOP, 2))
    }
    return b.build()
  }

  private fun servicePending(action: String, code: Int): PendingIntent =
    PendingIntent.getService(this, code, Intent(this, CaptureService::class.java).setAction(action), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val nm = getSystemService(NotificationManager::class.java)
      if (nm.getNotificationChannel(CHANNEL) == null) {
        nm.createNotificationChannel(NotificationChannel(CHANNEL, getString(R.string.gameops_channel_session), NotificationManager.IMPORTANCE_LOW))
      }
    }
  }

  private fun stopForegroundCompat() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE)
    else @Suppress("DEPRECATION") stopForeground(true)
  }

  private fun stamp() = SimpleDateFormat("yyyyMMdd-HHmmss-SSS", Locale.US).format(Date())

  class LowStorageException(free: Long) :
    Exception("Not enough free storage to record (${free / (1024 * 1024)} MB free) — free up space and try again")

  companion object {
    const val ACTION_START = "com.sevenxen.gameops.START"
    const val ACTION_PAUSE = "com.sevenxen.gameops.PAUSE"
    const val ACTION_RESUME = "com.sevenxen.gameops.RESUME"
    const val ACTION_STOP = "com.sevenxen.gameops.STOP"
    const val EXTRA_RESULT_CODE = "resultCode"
    const val EXTRA_RESULT_DATA = "resultData"
    private const val CHANNEL = "gameops_session"
    private const val NOTIF_ID = 0x7e1
    const val MIN_FREE_START = 1024L * 1024 * 1024 // 1 GB
    const val MIN_FREE_RUNNING = 300L * 1024 * 1024 // 300 MB

    /** Fallback when the detector gives no panel: right-hand results panel relative to the game viewport. */
    val RESULTS_PANEL_REGION = floatArrayOf(0.36f, 0.14f, 0.60f, 0.78f)
    val FULL_REGION = floatArrayOf(0f, 0f, 1f, 1f)

    fun start(ctx: Context, resultCode: Int, data: Intent) {
      val i = Intent(ctx, CaptureService::class.java)
        .setAction(ACTION_START)
        .putExtra(EXTRA_RESULT_CODE, resultCode)
        .putExtra(EXTRA_RESULT_DATA, data)
      ContextCompat.startForegroundService(ctx, i)
    }

    /** Runs [block] on the service's control thread and waits (≤ timeout). */
    fun <T> onControl(svc: CaptureService, timeoutMs: Long = 8000, block: CaptureService.() -> T): T? {
      val f = java.util.concurrent.FutureTask { svc.block() }
      svc.controlHandler.post(f)
      return try {
        f.get(timeoutMs, TimeUnit.MILLISECONDS)
      } catch (t: Throwable) {
        null
      }
    }
  }
}
