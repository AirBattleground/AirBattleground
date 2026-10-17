package com.sevenxen.gameops.upload

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.UUID

/**
 * Persistent FIFO of small uploads: screenshots (multipart to /api/manager/matches/:id/screenshots) and recording
 * events (PATCH /api/manager/recordings/:id). Stored as JSON in filesDir so nothing is lost if the process dies;
 * processed on one background thread with exponential backoff (2 s … 5 min), retried immediately when the network
 * comes back or retryNow() is called.
 */
class UploadQueue(context: Context, private val listener: Listener) {
  interface Listener {
    fun onScreenshotResult(entry: Entry, screenshotId: String?, error: String?, final: Boolean)
    fun onPendingChanged(pendingScreenshots: Int)
  }

  data class Entry(
    val id: String,
    val type: String, // "screenshot" | "event"
    val apiBaseUrl: String,
    val token: String,
    // screenshot
    val matchId: String? = null,
    val path: String? = null,
    val kind: String? = null,
    val source: String? = null,
    // event
    val recordingId: String? = null,
    val body: String? = null,
    var attempts: Int = 0,
    var nextAt: Long = 0L,
  ) {
    fun toJson(): JSONObject = JSONObject().apply {
      put("id", id); put("type", type); put("apiBaseUrl", apiBaseUrl); put("token", token)
      putOpt("matchId", matchId); putOpt("path", path); putOpt("kind", kind); putOpt("source", source)
      putOpt("recordingId", recordingId); putOpt("body", body)
      put("attempts", attempts); put("nextAt", nextAt)
    }

    companion object {
      fun fromJson(o: JSONObject) = Entry(
        id = o.getString("id"), type = o.getString("type"), apiBaseUrl = o.getString("apiBaseUrl"), token = o.getString("token"),
        matchId = o.optString("matchId").ifEmpty { null }, path = o.optString("path").ifEmpty { null },
        kind = o.optString("kind").ifEmpty { null }, source = o.optString("source").ifEmpty { null },
        recordingId = o.optString("recordingId").ifEmpty { null }, body = o.optString("body").ifEmpty { null },
        attempts = o.optInt("attempts"), nextAt = o.optLong("nextAt"),
      )
    }
  }

  private val file = File(context.filesDir, "gameops/upload-queue.json").apply { parentFile?.mkdirs() }
  private val thread = HandlerThread("gameops-uploads").apply { start() }
  private val handler = Handler(thread.looper)
  private val entries = mutableListOf<Entry>()
  private val lock = Any()
  private val tickRunnable = Runnable { processNext() }

  init {
    load()
    try {
      val cm = context.getSystemService(ConnectivityManager::class.java)
      cm?.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = retryNow()
      })
    } catch (t: Throwable) {
      Log.w(TAG, "network callback unavailable", t)
    }
    schedule(0)
  }

  val pendingScreenshots: Int get() = synchronized(lock) { entries.count { it.type == "screenshot" } }

  fun enqueueScreenshot(apiBaseUrl: String, token: String, matchId: String, path: String, kind: String, auto: Boolean): Entry {
    val e = Entry(UUID.randomUUID().toString(), "screenshot", apiBaseUrl, token, matchId = matchId, path = path, kind = kind, source = if (auto) "APP_AUTO" else "APP_MANUAL")
    add(e)
    return e
  }

  /** PATCH /api/manager/recordings/:id with a RecordingEventInput body. */
  fun enqueueRecordingPatch(apiBaseUrl: String, token: String, recordingId: String, body: JSONObject) {
    add(Entry(UUID.randomUUID().toString(), "event", apiBaseUrl, token, recordingId = recordingId, body = body.toString()))
  }

  fun retryNow() {
    synchronized(lock) { entries.forEach { it.nextAt = 0 } }
    schedule(0)
  }

  private fun add(e: Entry) {
    synchronized(lock) {
      entries.add(e)
      save()
    }
    listener.onPendingChanged(pendingScreenshots)
    schedule(0)
  }

  private fun schedule(delayMs: Long) {
    handler.removeCallbacks(tickRunnable)
    handler.postDelayed(tickRunnable, delayMs)
  }

  private fun processNext() {
    val now = System.currentTimeMillis()
    val e = synchronized(lock) { entries.filter { it.nextAt <= now }.minByOrNull { it.nextAt } } ?: run {
      val next = synchronized(lock) { entries.minOfOrNull { it.nextAt } }
      if (next != null) schedule((next - now).coerceAtLeast(500))
      return
    }
    try {
      when (e.type) {
        "screenshot" -> {
          val id = uploadScreenshot(e)
          remove(e)
          listener.onScreenshotResult(e, id, null, true)
        }
        "event" -> {
          patchRecording(e)
          remove(e)
        }
        else -> remove(e)
      }
    } catch (t: Throwable) {
      val retryable = when (t) {
        is HttpStatusException -> t.retryable
        is IOException -> true
        else -> false
      }
      val msg = t.message ?: t.javaClass.simpleName
      if (retryable && e.attempts < MAX_ATTEMPTS) {
        synchronized(lock) {
          e.attempts++
          e.nextAt = System.currentTimeMillis() + backoffMs(e.attempts)
          save()
        }
        if (e.type == "screenshot") listener.onScreenshotResult(e, null, msg, false)
      } else {
        Log.w(TAG, "dropping ${e.type} ${e.id}: $msg")
        remove(e)
        if (e.type == "screenshot") listener.onScreenshotResult(e, null, msg, true)
      }
    }
    schedule(0)
  }

  private fun remove(e: Entry) {
    synchronized(lock) {
      entries.removeAll { it.id == e.id }
      save()
    }
    listener.onPendingChanged(pendingScreenshots)
  }

  private fun uploadScreenshot(e: Entry): String? {
    val f = File(e.path ?: "")
    if (!f.exists()) throw IllegalStateException("Screenshot file is gone: ${e.path}")
    val body = MultipartBody.Builder().setType(MultipartBody.FORM)
      .addFormDataPart("kind", e.kind ?: "RESULTS")
      .addFormDataPart("source", e.source ?: "APP_MANUAL")
      .addFormDataPart("files", f.name, f.asRequestBody("image/jpeg".toMediaType()))
      .build()
    val req = Request.Builder()
      .url("${e.apiBaseUrl}/api/manager/matches/${e.matchId}/screenshots")
      .header("Authorization", "Bearer ${e.token}")
      .post(body)
      .build()
    Http.client.newCall(req).execute().use { res ->
      val text = res.body?.string()
      Http.ensureOk(res, text)
      // { items: ScreenshotRow[], skipped } — skipped = server already had this exact image (sha256)
      return try {
        JSONObject(text ?: "{}").optJSONArray("items")?.optJSONObject(0)?.optString("id")?.ifEmpty { null }
      } catch (_: Exception) {
        null
      }
    }
  }

  private fun patchRecording(e: Entry) {
    val req = Request.Builder()
      .url("${e.apiBaseUrl}/api/manager/recordings/${e.recordingId}")
      .header("Authorization", "Bearer ${e.token}")
      .patch((e.body ?: "{}").toRequestBody("application/json".toMediaType()))
      .build()
    Http.client.newCall(req).execute().use { res -> Http.ensureOk(res, res.body?.string()) }
  }

  private fun load() {
    try {
      if (!file.exists()) return
      val arr = JSONArray(file.readText())
      synchronized(lock) {
        for (i in 0 until arr.length()) entries.add(Entry.fromJson(arr.getJSONObject(i)).apply { nextAt = 0 })
      }
    } catch (t: Throwable) {
      Log.w(TAG, "queue file unreadable, starting empty", t)
    }
  }

  /** caller holds lock */
  private fun save() {
    try {
      val arr = JSONArray()
      entries.forEach { arr.put(it.toJson()) }
      val tmp = File(file.parentFile, file.name + ".tmp")
      tmp.writeText(arr.toString())
      if (!tmp.renameTo(file)) file.writeText(arr.toString())
    } catch (t: Throwable) {
      Log.w(TAG, "could not persist upload queue", t)
    }
  }

  companion object {
    private const val TAG = "GameOps.UploadQueue"
    private const val MAX_ATTEMPTS = 30

    fun backoffMs(attempt: Int): Long = (2000L shl (attempt - 1).coerceIn(0, 8)).coerceAtMost(5 * 60_000L)
  }
}
