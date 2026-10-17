package com.sevenxen.gameops.upload

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.sevenxen.gameops.GameOpsRuntime
import com.sevenxen.gameops.R
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.util.concurrent.TimeUnit

/** OkHttp implementation of the tus-like protocol (packages/shared/src/phase4.ts). */
class HttpUploadTransport(
  private val apiBaseUrl: String,
  private val token: String,
  private val recordingId: String,
  private val width: Int?,
  private val height: Int?,
) : UploadTransport {
  private val url get() = "$apiBaseUrl/api/manager/recordings/$recordingId/upload"

  private fun req(u: String = url) = Request.Builder().url(u).header("Authorization", "Bearer $token")

  override fun create(sizeBytes: Long): UploadState {
    val body = JSONObject().put("sizeBytes", sizeBytes).put("mimeType", "video/mp4")
    if (width != null && width > 0) body.put("width", width)
    if (height != null && height > 0) body.put("height", height)
    Http.client.newCall(req().post(body.toString().toRequestBody(JSON)).build()).execute().use { res ->
      val text = res.body?.string()
      Http.ensureOk(res, text)
      return parseState(text)
    }
  }

  override fun head(): Long {
    Http.client.newCall(req().head().build()).execute().use { res ->
      Http.ensureOk(res, null)
      return res.header("Upload-Offset")?.toLongOrNull() ?: throw IOException("HEAD without Upload-Offset")
    }
  }

  override fun patch(offset: Long, data: ByteArray, length: Int): PatchResult {
    val r = req()
      .header("Upload-Offset", offset.toString())
      .patch(data.toRequestBody(OCTET, 0, length))
      .build()
    Http.client.newCall(r).execute().use { res ->
      val text = res.body?.string()
      if (res.code == 409) {
        val real = res.header("Upload-Offset")?.toLongOrNull() ?: findOffset(text)
        return PatchResult.OffsetMismatch(real)
      }
      Http.ensureOk(res, text)
      return PatchResult.Ok(parseState(text))
    }
  }

  override fun complete() {
    Http.client.newCall(req("$url/complete").post(ByteArray(0).toRequestBody(JSON)).build()).execute().use { res ->
      Http.ensureOk(res, res.body?.string())
    }
  }

  private fun parseState(text: String?): UploadState {
    val o = JSONObject(text ?: "{}")
    return UploadState(o.optLong("offset"), o.optLong("sizeBytes"), o.optLong("chunkSize"), o.optBoolean("complete"))
  }

  /** 409 body: { error: { code: "OFFSET_MISMATCH", message, fields?/offset? } } — look for an offset anywhere. */
  private fun findOffset(text: String?): Long? = try {
    val o = JSONObject(text ?: "{}")
    val err = o.optJSONObject("error")
    listOfNotNull(o, err, err?.optJSONObject("fields"), err?.optJSONObject("details"))
      .firstNotNullOfOrNull { j -> if (j.has("offset")) j.optString("offset").toLongOrNull() else null }
  } catch (_: Exception) {
    null
  }

  companion object {
    private val JSON = "application/json".toMediaType()
    private val OCTET = "application/octet-stream".toMediaType()
  }
}

/**
 * WorkManager worker: resumable upload of one recording's MP4. Survives app restarts (WorkManager persists the
 * request; the server tells us the offset to resume from). Long uploads run as a dataSync foreground service.
 */
class VideoUploadWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  override fun doWork(): Result {
    val recordingId = inputData.getString(K_RECORDING) ?: return Result.failure()
    val path = inputData.getString(K_PATH) ?: return Result.failure()
    val base = inputData.getString(K_BASE) ?: return Result.failure()
    val token = inputData.getString(K_TOKEN) ?: return Result.failure()
    val width = inputData.getInt(K_WIDTH, 0).takeIf { it > 0 }
    val height = inputData.getInt(K_HEIGHT, 0).takeIf { it > 0 }
    val file = File(path)
    if (!file.exists() || file.length() == 0L) {
      emit(recordingId, 0, 0, "FAILED", "Video file is missing: $path")
      forget(applicationContext, recordingId)
      return Result.failure()
    }
    val size = file.length()
    if (size > 50L * 1024 * 1024) {
      try {
        setForegroundAsync(foregroundInfo(0, size)).get()
      } catch (t: Throwable) {
        Log.w(TAG, "could not start foreground for upload (continuing in background)", t)
      }
    }
    var lastNotified = 0L
    return try {
      RandomAccessFile(file, "r").use { raf ->
        val core = ResumableUploadCore(
          HttpUploadTransport(base, token, recordingId, width, height),
          size,
          read = { off, buf, bo, len -> raf.seek(off); raf.read(buf, bo, len) },
          progress = { up, total ->
            emit(recordingId, up, total, "UPLOADING", null)
            setProgressAsync(Data.Builder().putLong("uploaded", up).putLong("total", total).build())
            val now = System.currentTimeMillis()
            if (size > 50L * 1024 * 1024 && now - lastNotified > 2000) {
              lastNotified = now
              try {
                setForegroundAsync(foregroundInfo(up, total))
              } catch (_: Throwable) {
              }
            }
          },
          isStopped = { isStopped },
        )
        when (core.run()) {
          ResumableUploadCore.Outcome.DONE -> {
            emit(recordingId, size, size, "DONE", null)
            forget(applicationContext, recordingId)
            // the server has the full file now — free the phone's storage
            file.delete()
            Result.success()
          }
          ResumableUploadCore.Outcome.STOPPED -> Result.retry()
        }
      }
    } catch (e: HttpStatusException) {
      if (e.status == 507) {
        // STORAGE_FULL on the server: surface it and back off (WorkManager exponential backoff, not a hot loop)
        emit(recordingId, 0, size, "QUEUED", "7XEN server storage is full — the upload will retry later (${e.message})")
        GameOpsRuntime.emitError("7XEN server storage is full — video upload paused, will retry", false)
        return Result.retry()
      }
      if (e.retryable && runAttemptCount < 20) {
        emit(recordingId, 0, size, "QUEUED", e.message)
        Result.retry()
      } else {
        emit(recordingId, 0, size, "FAILED", e.message)
        Result.failure()
      }
    } catch (e: IOException) {
      emit(recordingId, 0, size, "QUEUED", "Network: ${e.message}")
      Result.retry()
    } catch (t: Throwable) {
      Log.e(TAG, "upload failed", t)
      emit(recordingId, 0, size, "FAILED", t.message ?: t.javaClass.simpleName)
      Result.failure()
    }
  }

  override fun getForegroundInfo(): ForegroundInfo = foregroundInfo(0, 0)

  private fun foregroundInfo(up: Long, total: Long): ForegroundInfo {
    val ctx = applicationContext
    ensureChannel(ctx)
    val pct = if (total > 0) (up * 100 / total).toInt() else 0
    val n: Notification = NotificationCompat.Builder(ctx, CHANNEL)
      .setSmallIcon(android.R.drawable.stat_sys_upload)
      .setContentTitle("Uploading match video")
      .setContentText(if (total > 0) "$pct% · ${up / (1024 * 1024)} / ${total / (1024 * 1024)} MB" else "Starting…")
      .setProgress(100, pct, total == 0L)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .build()
    val id = NOTIF_BASE + ((inputData.getString(K_RECORDING)?.hashCode() ?: 0) and 0xffff)
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ForegroundInfo(id, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    else ForegroundInfo(id, n)
  }

  private fun emit(recordingId: String, up: Long, total: Long, state: String, error: String?) {
    GameOpsRuntime.emitUploadProgress(recordingId, up, total, state, error)
  }

  companion object {
    private const val TAG = "GameOps.VideoUpload"
    private const val CHANNEL = "gameops_upload"
    private const val NOTIF_BASE = 0x7e10000
    const val K_RECORDING = "recordingId"
    const val K_PATH = "path"
    const val K_BASE = "apiBaseUrl"
    const val K_TOKEN = "token"
    const val K_WIDTH = "width"
    const val K_HEIGHT = "height"
    const val K_WIFI = "wifiOnly"

    private fun ensureChannel(ctx: Context) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
          nm.createNotificationChannel(NotificationChannel(CHANNEL, ctx.getString(R.string.gameops_channel_upload), NotificationManager.IMPORTANCE_LOW))
        }
      }
    }

    private fun pendingFile(ctx: Context) = File(ctx.filesDir, "gameops/pending-videos.json").apply { parentFile?.mkdirs() }

    /** Pending uploads are also remembered in a file so retryUploads() can re-enqueue FAILED ones. */
    @Synchronized
    private fun readPending(ctx: Context): JSONObject = try {
      JSONObject(pendingFile(ctx).takeIf { it.exists() }?.readText() ?: "{}")
    } catch (_: Exception) {
      JSONObject()
    }

    @Synchronized
    private fun writePending(ctx: Context, o: JSONObject) {
      try {
        pendingFile(ctx).writeText(o.toString())
      } catch (_: Exception) {
      }
    }

    @Synchronized
    fun forget(ctx: Context, recordingId: String) {
      val o = readPending(ctx)
      o.remove(recordingId)
      writePending(ctx, o)
    }

    fun enqueue(ctx: Context, recordingId: String, path: String, apiBaseUrl: String, token: String, width: Int, height: Int, wifiOnly: Boolean) {
      val data = Data.Builder()
        .putString(K_RECORDING, recordingId).putString(K_PATH, path).putString(K_BASE, apiBaseUrl).putString(K_TOKEN, token)
        .putInt(K_WIDTH, width).putInt(K_HEIGHT, height).putBoolean(K_WIFI, wifiOnly)
        .build()
      synchronized(this) {
        val o = readPending(ctx)
        o.put(recordingId, JSONObject().apply {
          put(K_PATH, path); put(K_BASE, apiBaseUrl); put(K_TOKEN, token); put(K_WIDTH, width); put(K_HEIGHT, height); put(K_WIFI, wifiOnly)
        })
        writePending(ctx, o)
      }
      val req = OneTimeWorkRequestBuilder<VideoUploadWorker>()
        .setInputData(data)
        .setConstraints(Constraints.Builder().setRequiredNetworkType(if (wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED).build())
        .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
        .addTag(TAG_ALL)
        .build()
      WorkManager.getInstance(ctx).enqueueUniqueWork(workName(recordingId), ExistingWorkPolicy.KEEP, req)
      val size = File(path).length()
      val waiting = wifiOnly && !isUnmetered(ctx)
      GameOpsRuntime.emitUploadProgress(recordingId, 0, size, if (waiting) "WAITING_FOR_WIFI" else "QUEUED", null)
    }

    /** Re-enqueue every remembered upload (KEEP leaves running/enqueued ones alone, restarts failed ones). */
    fun retryAll(ctx: Context) {
      val o = readPending(ctx)
      val keys = o.keys().asSequence().toList()
      for (id in keys) {
        val j = o.optJSONObject(id) ?: continue
        if (!File(j.optString(K_PATH)).exists()) {
          forget(ctx, id)
          continue
        }
        enqueue(ctx, id, j.optString(K_PATH), j.optString(K_BASE), j.optString(K_TOKEN), j.optInt(K_WIDTH), j.optInt(K_HEIGHT), j.optBoolean(K_WIFI, true))
      }
    }

    fun pendingCount(ctx: Context): Int = readPending(ctx).length()

    fun workName(recordingId: String) = "gameops-video-$recordingId"
    private const val TAG_ALL = "gameops-video"

    fun isUnmetered(ctx: Context): Boolean {
      val cm = ctx.getSystemService(ConnectivityManager::class.java) ?: return false
      val caps = cm.getNetworkCapabilities(cm.activeNetwork ?: return false) ?: return false
      return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
    }
  }
}
