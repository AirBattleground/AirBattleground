package com.sevenxen.gameops.automation

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.SystemClock
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import com.sevenxen.gameops.GameOpsRuntime
import com.sevenxen.gameops.detect.DetectorBridge
import com.sevenxen.gameops.detect.viewportRegionToFrame
import com.sevenxen.gameops.model.FingerprintSpec
import com.sevenxen.gameops.model.RecipeStepModel
import com.sevenxen.gameops.model.StepAction
import com.sevenxen.gameops.overlay.OverlayController
import kotlin.math.hypot

/**
 * Teach mode. Accessibility events / TYPE_VIEW_CLICKED carry no usable coordinates inside games, so we put a
 * transparent full-screen overlay over BGMI that records each touch (down → up = tap / long-press / swipe),
 * then makes itself untouchable and re-injects the same gesture with dispatchGesture so the game still gets it.
 * Each step stores the gesture relative to the game viewport and (when a session is live and frames are
 * available) a fingerprint of the screen just before the touch → the step's `expect`.
 *
 * A small chip ("Teaching · N steps · Finish") sits on top; Finish stops recording and brings the 7XEN app
 * back so the JS side can call stopTeachMode().
 */
class TeachSession(private val ctx: Context, val key: String) {
  private val wm = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
  private val steps = mutableListOf<RecipeStepModel>()
  private var recorder: View? = null
  private lateinit var recorderParams: WindowManager.LayoutParams
  private var chip: TextView? = null
  @Volatile
  var finished = false
    private set
  private var injecting = false

  private var downX = 0f
  private var downY = 0f
  private var downAt = 0L
  private var downFingerprint: FingerprintSpec? = null
  private var downViewport: FloatArray? = null

  val stepCount: Int get() = synchronized(steps) { steps.size }

  /** main thread */
  fun start() {
    recorderParams = WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.MATCH_PARENT,
      OverlayController.overlayType(),
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      // fully transparent: invisible in the recording and allowed by Android 12+ touch-occlusion rules when
      // we flip it to FLAG_NOT_TOUCHABLE for re-injection
      alpha = 0f
      if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
        layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
      }
    }
    val v = RecorderView(ctx)
    wm.addView(v, recorderParams)
    recorder = v

    val c = TextView(ctx).apply {
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
      setPadding(dp(12), dp(6), dp(12), dp(6))
      background = GradientDrawable().apply {
        cornerRadius = dp(16).toFloat()
        setColor(Color.parseColor("#E6C62828"))
      }
      setOnClickListener { finishAndReturn() }
    }
    val cp = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      OverlayController.overlayType(),
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
      y = dp(4)
    }
    wm.addView(c, cp)
    chip = c
    updateChip()
  }

  /** main thread; idempotent. Returns the TeachResult map. */
  fun finish(): Map<String, Any?> {
    if (!finished) {
      finished = true
      listOfNotNull(recorder, chip).forEach {
        try {
          wm.removeViewImmediate(it)
        } catch (_: Throwable) {
        }
      }
      recorder = null
      chip = null
    }
    return result()
  }

  fun result(): Map<String, Any?> {
    val (w, h) = ViewportMapping.screenSize(ctx)
    val list = synchronized(steps) { steps.map { it.toMap() } }
    return mapOf("steps" to list, "deviceProfile" to "${maxOf(w, h)}x${minOf(w, h)}")
  }

  private fun finishAndReturn() {
    finish()
    GameOpsRuntime.emitStatus()
    ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)?.let {
      it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
      try {
        ctx.startActivity(it)
      } catch (_: Throwable) {
      }
    }
  }

  private fun updateChip() {
    chip?.text = "● Teaching ${key} · ${stepCount} steps · Finish"
  }

  private fun onDown(ev: MotionEvent) {
    downX = ev.rawX
    downY = ev.rawY
    downAt = SystemClock.uptimeMillis()
    val (sw, sh) = ViewportMapping.screenSize(ctx)
    val snap = GameOpsRuntime.latestFrame?.takeIf { System.currentTimeMillis() - it.atMs < 3000 }
    downViewport = ViewportMapping.viewportOnScreen(snap, sw, sh)
    downFingerprint = snap?.let {
      val region = floatArrayOf(0f, 0f, 1f, 1f)
      val hash = DetectorBridge.dHash(it.argb, it.width, it.height, viewportRegionToFrame(region, it.viewport, it.width, it.height))
      FingerprintSpec(hash, region, 10)
    }
  }

  private fun onUp(ev: MotionEvent) {
    val vp = downViewport ?: return
    val upX = ev.rawX
    val upY = ev.rawY
    val dur = (SystemClock.uptimeMillis() - downAt).coerceIn(50, 3000)
    val moved = hypot((upX - downX).toDouble(), (upY - downY).toDouble()) > dp(16)
    val (rx, ry) = ViewportMapping.toViewport(downX, downY, vp)
    val n = stepCount + 1
    val action: StepAction = if (!moved && dur < 600) {
      StepAction.Tap(rx, ry)
    } else {
      val (rx2, ry2) = ViewportMapping.toViewport(upX, upY, vp)
      StepAction.Swipe(rx, ry, rx2, ry2, dur)
    }
    val label = when (action) {
      is StepAction.Tap -> "Step $n · tap"
      else -> if (moved) "Step $n · swipe" else "Step $n · long press"
    }
    synchronized(steps) {
      steps.add(RecipeStepModel("t$n", label, null, downFingerprint, action, 15000L))
    }
    updateChip()
    reinject(action, vp)
  }

  /** Let the game receive the touch: become untouchable, replay it, become touchable again. */
  private fun reinject(action: StepAction, vp: FloatArray) {
    val svc = AutomationService.instance
    if (svc == null) {
      GameOpsRuntime.emitError("Teach mode needs the 7XEN accessibility service to pass your taps to BGMI", false)
      return
    }
    injecting = true
    setTouchable(false)
    val done: (Boolean) -> Unit = { _ ->
      GameOpsRuntime.main.post {
        injecting = false
        if (!finished) setTouchable(true)
      }
    }
    GameOpsRuntime.main.postDelayed({
      when (action) {
        is StepAction.Tap -> {
          val (x, y) = ViewportMapping.toScreen(action.x, action.y, vp)
          svc.tap(x, y, 60, done)
        }
        is StepAction.Swipe -> {
          val (x, y) = ViewportMapping.toScreen(action.x, action.y, vp)
          val (x2, y2) = ViewportMapping.toScreen(action.x2, action.y2, vp)
          svc.swipe(x, y, x2, y2, action.durationMs, done)
        }
        else -> done(true)
      }
    }, 30)
  }

  private fun setTouchable(touchable: Boolean) {
    val r = recorder ?: return
    recorderParams.flags = if (touchable) recorderParams.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv()
    else recorderParams.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
    try {
      wm.updateViewLayout(r, recorderParams)
    } catch (_: Throwable) {
    }
  }

  private fun dp(v: Int) = (v * ctx.resources.displayMetrics.density).toInt()

  @SuppressLint("ViewConstructor")
  private inner class RecorderView(c: Context) : View(c) {
    init {
      setBackgroundColor(Color.TRANSPARENT)
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(ev: MotionEvent): Boolean {
      if (injecting || finished) return true
      when (ev.actionMasked) {
        MotionEvent.ACTION_DOWN -> onDown(ev)
        MotionEvent.ACTION_UP -> onUp(ev)
      }
      return true
    }
  }
}
