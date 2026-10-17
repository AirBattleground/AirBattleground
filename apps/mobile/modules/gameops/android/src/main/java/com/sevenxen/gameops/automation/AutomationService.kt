package com.sevenxen.gameops.automation

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Context
import android.graphics.Path
import android.os.Bundle
import android.provider.Settings
import android.text.TextUtils
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Accessibility service used ONLY for Auto mode (recipe taps) and Teach mode (re-injecting the manager's taps).
 * It does nothing on its own: no event processing, no content reading — gestures are dispatched only when a
 * GameOps session/teach session asks for them. Coordinates here are absolute screen pixels.
 */
class AutomationService : AccessibilityService() {
  override fun onServiceConnected() {
    super.onServiceConnected()
    instance = this
    Log.i(TAG, "connected")
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

  override fun onInterrupt() = Unit

  override fun onUnbind(intent: android.content.Intent?): Boolean {
    if (instance === this) instance = null
    return super.onUnbind(intent)
  }

  override fun onDestroy() {
    if (instance === this) instance = null
    super.onDestroy()
  }

  fun tap(x: Float, y: Float, durationMs: Long = 60, onDone: (Boolean) -> Unit) {
    val p = Path().apply { moveTo(x.coerceAtLeast(0f), y.coerceAtLeast(0f)) }
    dispatch(p, durationMs.coerceAtLeast(1), onDone)
  }

  fun swipe(x: Float, y: Float, x2: Float, y2: Float, durationMs: Long, onDone: (Boolean) -> Unit) {
    val p = Path().apply {
      moveTo(x.coerceAtLeast(0f), y.coerceAtLeast(0f))
      lineTo(x2.coerceAtLeast(0f), y2.coerceAtLeast(0f))
    }
    dispatch(p, durationMs.coerceIn(50, 3000), onDone)
  }

  private fun dispatch(path: Path, durationMs: Long, onDone: (Boolean) -> Unit) {
    val g = GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, durationMs)).build()
    val ok = try {
      dispatchGesture(g, object : GestureResultCallback() {
        override fun onCompleted(gestureDescription: GestureDescription?) = onDone(true)
        override fun onCancelled(gestureDescription: GestureDescription?) = onDone(false)
      }, null)
    } catch (t: Throwable) {
      Log.w(TAG, "dispatchGesture", t)
      false
    }
    if (!ok) onDone(false)
  }

  /**
   * Type into the focused input: ACTION_SET_TEXT on the focused editable node, else paste from the clipboard.
   * Games built on Unity/Unreal usually expose no nodes → false (the manager types it; the hint shows the value).
   */
  fun setText(text: String): Boolean {
    val node = try {
      rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
    } catch (_: Throwable) {
      null
    } ?: return false
    try {
      if (node.isEditable) {
        val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text) }
        if (node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) return true
      }
      val cm = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return false
      cm.setPrimaryClip(ClipData.newPlainText("7XEN room password", text))
      return node.performAction(AccessibilityNodeInfo.ACTION_PASTE)
    } catch (t: Throwable) {
      Log.w(TAG, "setText", t)
      return false
    }
  }

  companion object {
    private const val TAG = "GameOps.Automation"

    @Volatile
    var instance: AutomationService? = null
      private set

    fun isEnabled(ctx: Context): Boolean {
      val enabled = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
      val me = ComponentName(ctx, AutomationService::class.java)
      val splitter = TextUtils.SimpleStringSplitter(':')
      splitter.setString(enabled)
      for (s in splitter) {
        val cn = ComponentName.unflattenFromString(s) ?: continue
        if (cn == me) return true
      }
      return false
    }
  }
}
