package com.sevenxen.gameops.overlay

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.sevenxen.gameops.GameOpsRuntime
import com.sevenxen.gameops.automation.RecipeRunner
import kotlin.math.abs

/**
 * Floating 7XEN bubble over BGMI (TYPE_APPLICATION_OVERLAY). Never takes focus from the game
 * (FLAG_NOT_FOCUSABLE — the panel has buttons only, no text input) and lets touches outside it through
 * (FLAG_NOT_TOUCH_MODAL). Tap the bubble to expand the panel: state + elapsed, checklist, capture / pause / stop.
 * All methods must be called on the main thread.
 */
class OverlayController(private val ctx: Context, private val actions: Actions) {
  interface Actions {
    fun captureTeamList()
    fun captureResults()
    fun togglePause()
    fun stop()
    fun tickStep(stepId: String)
  }

  private val wm = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
  private var root: LinearLayout? = null
  private lateinit var params: WindowManager.LayoutParams
  private lateinit var bubble: TextView
  private lateinit var panel: LinearLayout
  private lateinit var stateText: TextView
  private lateinit var infoText: TextView
  private lateinit var checklistBox: LinearLayout
  private lateinit var pauseBtn: Button
  private var expanded = false
  private var suspendCount = 0

  private val ticker = object : Runnable {
    override fun run() {
      if (root == null) return
      refresh()
      GameOpsRuntime.main.postDelayed(this, 1000)
    }
  }

  val isShowing: Boolean get() = root != null

  fun canShow(): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx)

  fun show(): Boolean {
    if (root != null) return true
    if (!canShow()) return false
    val r = buildViews()
    params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      overlayType(),
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = dp(8)
      y = dp(120)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
      }
    }
    return try {
      wm.addView(r, params)
      root = r
      refresh()
      GameOpsRuntime.main.postDelayed(ticker, 1000)
      true
    } catch (t: Throwable) {
      GameOpsRuntime.emitError("Could not show the floating bubble: ${t.message}", false)
      false
    }
  }

  fun remove() {
    GameOpsRuntime.main.removeCallbacks(ticker)
    root?.let {
      try {
        wm.removeViewImmediate(it)
      } catch (_: Throwable) {
      }
    }
    root = null
  }

  /**
   * Temporarily make the bubble invisible + untouchable (window alpha 0): while a still is captured (so it isn't
   * in the screenshot) and while an automated gesture is injected (so the tap reaches the game, and Android 12+
   * untrusted-touch occlusion rules don't block it). Nested calls are counted.
   */
  fun setSuspended(suspended: Boolean) {
    val r = root ?: return
    suspendCount = (suspendCount + if (suspended) 1 else -1).coerceAtLeast(0)
    val hide = suspendCount > 0
    params.alpha = if (hide) 0f else 1f
    params.flags = if (hide) params.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
    else params.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv()
    try {
      wm.updateViewLayout(r, params)
    } catch (_: Throwable) {
    }
  }

  fun refresh() {
    if (root == null) return
    val st = GameOpsRuntime.statusMap()
    val state = st["state"] as? String ?: "IDLE"
    val elapsed = ((st["elapsedMs"] as? Double) ?: 0.0).toLong() / 1000
    val dotColor = when (state) {
      "LIVE" -> Color.parseColor("#E53935")
      "PAUSED" -> Color.parseColor("#FBC02D")
      "ERROR" -> Color.parseColor("#8E24AA")
      else -> Color.GRAY
    }
    (bubble.background as? GradientDrawable)?.setStroke(dp(3), dotColor)
    val title = GameOpsRuntime.options?.title ?: "7XEN"
    stateText.text = "$title\n${stateLabel(state)} · ${fmt(elapsed)}"
    @Suppress("UNCHECKED_CAST")
    val caps = st["captures"] as? Map<String, Any?>
    val screen = st["screen"] as? String
    infoText.text = buildString {
      append("Team list ${caps?.get("slotList") ?: 0} · Results ${caps?.get("results") ?: 0}")
      val pending = caps?.get("pendingUploads") as? Int ?: 0
      if (pending > 0) append(" · ↑$pending uploading")
      if (screen != null) append("\nScreen: ${screenLabel(screen)}")
    }
    pauseBtn.text = if (state == "PAUSED") "Resume" else "Pause"
    if (expanded) renderChecklist()
  }

  // ---------------------------------------------------------------- views

  @SuppressLint("ClickableViewAccessibility", "SetTextI18n")
  private fun buildViews(): LinearLayout {
    val r = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
    bubble = TextView(ctx).apply {
      text = "7X"
      setTextColor(Color.WHITE)
      typeface = Typeface.DEFAULT_BOLD
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
      gravity = Gravity.CENTER
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.parseColor("#E6111318"))
        setStroke(dp(3), Color.GRAY)
      }
      layoutParams = LinearLayout.LayoutParams(dp(52), dp(52))
      contentDescription = "7XEN session controls"
    }
    val slop = ViewConfiguration.get(ctx).scaledTouchSlop
    var downX = 0f
    var downY = 0f
    var startX = 0
    var startY = 0
    var dragging = false
    bubble.setOnTouchListener { _, ev ->
      when (ev.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          downX = ev.rawX; downY = ev.rawY; startX = params.x; startY = params.y; dragging = false
          true
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = ev.rawX - downX
          val dy = ev.rawY - downY
          if (!dragging && (abs(dx) > slop || abs(dy) > slop)) dragging = true
          if (dragging) {
            params.x = (startX + dx).toInt()
            params.y = (startY + dy).toInt()
            try {
              wm.updateViewLayout(r, params)
            } catch (_: Throwable) {
            }
          }
          true
        }
        MotionEvent.ACTION_UP -> {
          if (!dragging) toggle()
          true
        }
        else -> false
      }
    }
    r.addView(bubble)

    panel = LinearLayout(ctx).apply {
      orientation = LinearLayout.VERTICAL
      visibility = View.GONE
      setPadding(dp(12), dp(10), dp(12), dp(10))
      background = GradientDrawable().apply {
        cornerRadius = dp(14).toFloat()
        setColor(Color.parseColor("#F0111318"))
      }
      layoutParams = LinearLayout.LayoutParams(dp(260), LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(6) }
    }
    stateText = label(14f, bold = true)
    infoText = label(12f).apply { setTextColor(Color.parseColor("#B0BEC5")) }
    panel.addView(stateText)
    panel.addView(infoText)

    checklistBox = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
    val scroll = ScrollView(ctx).apply {
      addView(checklistBox)
      layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) }
      isVerticalScrollBarEnabled = true
    }
    panel.addView(scroll)

    val row1 = buttonRow(button("Team list") { actions.captureTeamList() }, button("Results") { actions.captureResults() })
    pauseBtn = button("Pause") { actions.togglePause() }
    val row2 = buttonRow(pauseBtn, button("Stop", danger = true) { actions.stop() })
    panel.addView(row1)
    panel.addView(row2)
    r.addView(panel)
    return r
  }

  private fun toggle() {
    expanded = !expanded
    panel.visibility = if (expanded) View.VISIBLE else View.GONE
    refresh()
  }

  private fun renderChecklist() {
    checklistBox.removeAllViews()
    val runner: RecipeRunner? = GameOpsRuntime.runner
    val steps = runner?.steps ?: GameOpsRuntime.options?.checklist ?: emptyList()
    if (steps.isEmpty()) {
      checklistBox.addView(label(12f).apply { text = "No checklist for this match"; setTextColor(Color.GRAY) })
      return
    }
    val mode = if (runner?.autoMode == true) "Auto mode" else "Assisted"
    checklistBox.addView(label(11f).apply { text = "Room checklist · $mode"; setTextColor(Color.parseColor("#90A4AE")) })
    steps.forEachIndexed { i, s ->
      val done = runner?.isDone(i) == true
      val current = runner != null && runner.index == i && runner.phase != RecipeRunner.Phase.DONE
      val row = label(13f, bold = current).apply {
        text = (if (done) "✓ " else if (current) "▶ " else "○ ") + s.label
        setTextColor(if (done) Color.parseColor("#66BB6A") else if (current) Color.WHITE else Color.parseColor("#CFD8DC"))
        setPadding(0, dp(4), 0, dp(4))
        if (!done) setOnClickListener { actions.tickStep(s.id) }
      }
      checklistBox.addView(row)
      if (current) {
        val msg = runner?.message ?: s.hint
        if (!msg.isNullOrBlank()) {
          checklistBox.addView(label(11f).apply {
            text = msg + if (runner?.phase == RecipeRunner.Phase.NEEDS_MANUAL) "  (tap the step to tick it)" else ""
            setTextColor(Color.parseColor("#FFB74D"))
            setPadding(dp(16), 0, 0, dp(4))
          })
        }
      }
    }
  }

  private fun label(sp: Float, bold: Boolean = false) = TextView(ctx).apply {
    setTextColor(Color.WHITE)
    setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
    if (bold) typeface = Typeface.DEFAULT_BOLD
  }

  private fun button(text: String, danger: Boolean = false, onClick: () -> Unit) = Button(ctx).apply {
    this.text = text
    isAllCaps = false
    setTextColor(Color.WHITE)
    setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
    minHeight = dp(36)
    minimumHeight = dp(36)
    background = GradientDrawable().apply {
      cornerRadius = dp(8).toFloat()
      setColor(Color.parseColor(if (danger) "#C62828" else "#37474F"))
    }
    setOnClickListener { onClick() }
    layoutParams = LinearLayout.LayoutParams(0, dp(38), 1f).apply { setMargins(dp(3), dp(6), dp(3), 0) }
  }

  private fun buttonRow(vararg b: View) = LinearLayout(ctx).apply {
    orientation = LinearLayout.HORIZONTAL
    b.forEach { addView(it) }
  }

  private fun dp(v: Int) = (v * ctx.resources.displayMetrics.density).toInt()

  companion object {
    @Suppress("DEPRECATION")
    fun overlayType(): Int = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    else WindowManager.LayoutParams.TYPE_PHONE

    fun fmt(sec: Long) = "%d:%02d:%02d".format(sec / 3600, (sec / 60) % 60, sec % 60).removePrefix("0:")

    fun stateLabel(s: String) = when (s) {
      "LIVE" -> "● Recording"
      "PAUSED" -> "❚❚ Paused"
      "STARTING" -> "Starting…"
      "STOPPING" -> "Stopping…"
      "STOPPED" -> "Stopped"
      "ERROR" -> "Error"
      else -> s
    }

    fun screenLabel(s: String) = when (s) {
      "TEAM_LIST" -> "team list"
      "RESULTS" -> "results"
      "LOBBY" -> "lobby"
      else -> "other"
    }
  }
}
