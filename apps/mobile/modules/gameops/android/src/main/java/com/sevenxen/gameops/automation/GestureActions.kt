package com.sevenxen.gameops.automation

import android.content.Context
import android.hardware.display.DisplayManager
import android.util.DisplayMetrics
import android.view.Display
import com.sevenxen.gameops.FrameSnapshot
import com.sevenxen.gameops.GameOpsRuntime

/** Maps game-viewport-relative coordinates (recipes) ↔ absolute screen pixels (gestures / touches). */
object ViewportMapping {
  /** viewport in screen px: x, y, w, h */
  fun viewportOnScreen(snap: FrameSnapshot?, screenW: Int, screenH: Int): FloatArray {
    if (snap == null || snap.width <= 0 || snap.height <= 0) return floatArrayOf(0f, 0f, screenW.toFloat(), screenH.toFloat())
    // frames are the captured display scaled down; if the display rotated since, fall back to the screen
    val dw = snap.displayW.takeIf { it > 0 } ?: screenW
    val dh = snap.displayH.takeIf { it > 0 } ?: screenH
    if ((dw > dh) != (screenW > screenH)) return floatArrayOf(0f, 0f, screenW.toFloat(), screenH.toFloat())
    val sx = screenW.toFloat() / snap.width
    val sy = screenH.toFloat() / snap.height
    val v = snap.viewport
    return floatArrayOf(v[0] * sx, v[1] * sy, v[2] * sx, v[3] * sy)
  }

  fun toScreen(rx: Float, ry: Float, vp: FloatArray): Pair<Float, Float> = (vp[0] + rx * vp[2]) to (vp[1] + ry * vp[3])

  fun toViewport(px: Float, py: Float, vp: FloatArray): Pair<Float, Float> =
    ((px - vp[0]) / vp[2]).coerceIn(0f, 1f) to ((py - vp[1]) / vp[3]).coerceIn(0f, 1f)

  @Suppress("DEPRECATION")
  fun screenSize(ctx: Context): Pair<Int, Int> {
    val dm = DisplayMetrics()
    val d = ctx.getSystemService(DisplayManager::class.java)?.getDisplay(Display.DEFAULT_DISPLAY)
    d?.getRealMetrics(dm) ?: return ctx.resources.displayMetrics.let { it.widthPixels to it.heightPixels }
    return dm.widthPixels to dm.heightPixels
  }
}

/**
 * RecipeActions backed by the AccessibilityService. The floating bubble is suspended (alpha 0, untouchable)
 * around each injected gesture so the tap lands in the game.
 */
class GestureActions(
  private val ctx: Context,
  private val suspendOverlay: (Boolean) -> Unit,
) : RecipeActions {
  private val main get() = GameOpsRuntime.main

  override fun tap(x: Float, y: Float, onDone: (Boolean) -> Unit) {
    val svc = AutomationService.instance ?: return onDone(false)
    val (px, py) = map(x, y)
    inject(onDone) { cb -> svc.tap(px, py, 60, cb) }
  }

  override fun swipe(x: Float, y: Float, x2: Float, y2: Float, durationMs: Long, onDone: (Boolean) -> Unit) {
    val svc = AutomationService.instance ?: return onDone(false)
    val (px, py) = map(x, y)
    val (px2, py2) = map(x2, y2)
    inject(onDone) { cb -> svc.swipe(px, py, px2, py2, durationMs, cb) }
  }

  override fun inputText(field: String): Boolean {
    val svc = AutomationService.instance ?: return false
    val value = when (field) {
      "roomPassword" -> GameOpsRuntime.options?.roomPassword
      else -> null
    } ?: return false
    return svc.setText(value)
  }

  override fun readText(field: String, region: FloatArray) {
    // On-device OCR is out of scope for now: tell the app to ask the manager to type the room ID/password.
    GameOpsRuntime.emit(GameOpsRuntime.EV_ROOM, mapOf("roomId" to null, "password" to null))
  }

  private fun inject(onDone: (Boolean) -> Unit, gesture: ((Boolean) -> Unit) -> Unit) {
    main.post {
      suspendOverlay(true)
      main.postDelayed({
        gesture { ok ->
          main.post { suspendOverlay(false) }
          onDone(ok)
        }
      }, 60)
    }
  }

  private fun map(x: Float, y: Float): Pair<Float, Float> {
    val (sw, sh) = ViewportMapping.screenSize(ctx)
    val vp = ViewportMapping.viewportOnScreen(GameOpsRuntime.latestFrame, sw, sh)
    return ViewportMapping.toScreen(x, y, vp)
  }
}
