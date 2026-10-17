package com.sevenxen.gameops

import android.Manifest
import android.app.Activity
import android.content.Context
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.os.Build
import com.sevenxen.gameops.automation.AutomationService
import com.sevenxen.gameops.automation.TeachSession
import com.sevenxen.gameops.capture.CaptureService
import com.sevenxen.gameops.model.ContractException
import com.sevenxen.gameops.model.StartOptions
import com.sevenxen.gameops.upload.VideoUploadWorker
import expo.modules.interfaces.permissions.PermissionsResponseListener
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Expo module "GameOps" — implements apps/mobile/modules/gameops/src/GameOps.types.ts. */
class GameOpsModule : Module() {
  private val ctx: Context
    get() = requireNotNull(appContext.reactContext?.applicationContext) { "React context is not available" }

  override fun definition() = ModuleDefinition {
    Name("GameOps")

    Events(*GameOpsRuntime.EVENTS)

    OnCreate {
      GameOpsRuntime.init(ctx)
      GameOpsRuntime.emitter = { name, body -> sendEvent(name, body) }
    }

    OnDestroy {
      GameOpsRuntime.emitter = null
    }

    // ------------------------------------------------------------ permissions

    AsyncFunction("getPermissions") { Permissions.all(ctx) }

    AsyncFunction("requestOverlayPermission") { ctx.startActivity(Permissions.overlaySettingsIntent(ctx)) }

    AsyncFunction("openAccessibilitySettings") { ctx.startActivity(Permissions.accessibilitySettingsIntent()) }

    AsyncFunction("requestIgnoreBatteryOptimizations") {
      if (!Permissions.batteryOptimizationIgnored(ctx)) {
        try {
          ctx.startActivity(Permissions.batteryIntent(ctx))
        } catch (_: Throwable) {
          ctx.startActivity(
            android.content.Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK),
          )
        }
      }
    }

    AsyncFunction("requestNotificationPermission") { promise: Promise ->
      if (Build.VERSION.SDK_INT < 33 || Permissions.notifications(ctx)) {
        promise.resolve(Permissions.notifications(ctx))
        return@AsyncFunction
      }
      val perms = appContext.permissions
      if (perms == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      perms.askForPermissions(
        PermissionsResponseListener { result ->
          promise.resolve(result[Manifest.permission.POST_NOTIFICATIONS]?.status == PermissionsStatus.GRANTED)
        },
        Manifest.permission.POST_NOTIFICATIONS,
      )
    }

    AsyncFunction("launchBgmi") { Permissions.launchBgmi(ctx) }

    // ------------------------------------------------------------ session

    AsyncFunction("startSession") { options: Map<String, Any?>, promise: Promise ->
      val busy = GameOpsRuntime.state in setOf("STARTING", "LIVE", "PAUSED", "STOPPING")
      if (busy && GameOpsRuntime.service != null) {
        promise.reject("SESSION_ACTIVE", "A live session is already running — stop it first", null)
        return@AsyncFunction
      }
      val opts = try {
        StartOptions.fromMap(options)
      } catch (e: ContractException) {
        promise.reject(e.code, e.message, e)
        return@AsyncFunction
      }
      val activity: Activity = appContext.currentActivity ?: run {
        promise.reject("NO_ACTIVITY", "Open the 7XEN app to start a session", null)
        return@AsyncFunction
      }
      if (opts.recordVideo) {
        val dir = ctx.getExternalFilesDir(null) ?: ctx.filesDir
        if (dir.usableSpace < CaptureService.MIN_FREE_START) {
          promise.reject("LOW_STORAGE", "Not enough free storage to record (${dir.usableSpace / (1024 * 1024)} MB free, need 1 GB)", null)
          return@AsyncFunction
        }
      }
      GameOpsRuntime.beginSession(opts)
      GameOpsRuntime.startCallback = { err ->
        if (err == null) promise.resolve(GameOpsRuntime.statusMap())
        else promise.reject(if (err.message?.contains("permission", true) == true) "PERMISSION_DENIED" else "START_FAILED", err.message, err)
      }
      GameOpsRuntime.emitStatus()
      val mpm = ctx.getSystemService(MediaProjectionManager::class.java)
      // Full-screen capture (not single-app): detection + checklist need BGMI, and the manager may switch apps.
      val intent = if (Build.VERSION.SDK_INT >= 34) mpm.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
      else mpm.createScreenCaptureIntent()
      GameOpsRuntime.main.post {
        try {
          activity.startActivityForResult(intent, REQ_PROJECTION)
        } catch (t: Throwable) {
          failPendingStart("PERMISSION_DENIED", "Could not open the screen-capture dialog: ${t.message}")
        }
      }
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != REQ_PROJECTION) return@OnActivityResult
      val data = payload.data
      if (payload.resultCode != Activity.RESULT_OK || data == null) {
        failPendingStart("PERMISSION_DENIED", "Screen capture permission was denied")
        return@OnActivityResult
      }
      try {
        CaptureService.start(ctx, payload.resultCode, data)
      } catch (t: Throwable) {
        // e.g. ForegroundServiceStartNotAllowedException if the app went to background meanwhile
        failPendingStart("START_FAILED", "Could not start the recording service: ${t.message}")
      }
    }

    AsyncFunction("pauseSession") {
      GameOpsRuntime.service?.let { svc -> CaptureService.onControl(svc) { pause() } }
      GameOpsRuntime.statusMap()
    }

    AsyncFunction("resumeSession") {
      GameOpsRuntime.service?.let { svc -> CaptureService.onControl(svc) { resume() } }
      GameOpsRuntime.statusMap()
    }

    AsyncFunction("stopSession") { options: Map<String, Any?>? ->
      val wifiOnly = options?.get("wifiOnly") as? Boolean ?: true
      val svc = GameOpsRuntime.service
      if (svc != null) {
        CaptureService.onControl(svc, 15_000) { doStop(wifiOnly, null, false) }
      } else if (GameOpsRuntime.state == "STARTING") {
        failPendingStart("CANCELLED", "Session cancelled")
      }
      GameOpsRuntime.statusMap()
    }

    AsyncFunction("getStatus") { GameOpsRuntime.statusMap() }

    AsyncFunction("captureNow") { kind: String, promise: Promise ->
      if (kind != "SLOT_LIST" && kind != "RESULTS") {
        promise.reject("INVALID_KIND", "kind must be SLOT_LIST or RESULTS", null)
        return@AsyncFunction
      }
      val svc = GameOpsRuntime.service
      if (svc == null) {
        promise.reject("NO_SESSION", "Start a live session first", null)
        return@AsyncFunction
      }
      svc.requestStill(kind, auto = false) { ev, err ->
        if (ev != null) promise.resolve(ev.toMap()) else promise.reject("CAPTURE_FAILED", err ?: "Capture failed", null)
      }
    }

    AsyncFunction("retryUploads") {
      GameOpsRuntime.queue.retryNow()
      VideoUploadWorker.retryAll(ctx)
    }

    // ------------------------------------------------------------ teach mode

    AsyncFunction("startTeachMode") { key: String, promise: Promise ->
      if (!Permissions.overlay(ctx)) {
        promise.reject("OVERLAY_REQUIRED", "Allow \"Display over other apps\" for teach mode", null)
        return@AsyncFunction
      }
      if (!AutomationService.isEnabled(ctx) || AutomationService.instance == null) {
        promise.reject("ACCESSIBILITY_REQUIRED", "Turn on the 7XEN accessibility service — teach mode passes your taps to BGMI through it", null)
        return@AsyncFunction
      }
      GameOpsRuntime.main.post {
        try {
          GameOpsRuntime.teach?.finish()
          val t = TeachSession(ctx, key)
          t.start()
          GameOpsRuntime.teach = t
          if (GameOpsRuntime.service == null) {
            GameOpsRuntime.emitError("Teach mode without a live session records taps only (no screen fingerprints)", false)
          }
          promise.resolve(null)
        } catch (t: Throwable) {
          promise.reject("TEACH_FAILED", "Could not start teach mode: ${t.message}", t)
        }
      }
    }

    AsyncFunction("stopTeachMode") { promise: Promise ->
      GameOpsRuntime.main.post {
        val t = GameOpsRuntime.teach
        if (t == null) {
          promise.reject("NO_TEACH", "Teach mode is not running", null)
          return@post
        }
        GameOpsRuntime.teach = null
        promise.resolve(t.finish())
      }
    }
  }

  private fun failPendingStart(code: String, message: String) {
    GameOpsRuntime.setState("IDLE", message)
    val cb = GameOpsRuntime.startCallback
    GameOpsRuntime.startCallback = null
    cb?.invoke(IllegalStateException(if (code == "PERMISSION_DENIED") "Screen capture permission: $message" else message))
  }

  companion object {
    private const val REQ_PROJECTION = 0x7e5
  }
}
