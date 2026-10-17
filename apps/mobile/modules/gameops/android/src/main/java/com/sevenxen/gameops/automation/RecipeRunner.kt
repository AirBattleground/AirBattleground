package com.sevenxen.gameops.automation

import com.sevenxen.gameops.model.FingerprintSpec
import com.sevenxen.gameops.model.RecipeStepModel
import com.sevenxen.gameops.model.StepAction

/**
 * What the runner can do to the outside world. Coordinates are relative (0..1) to the game viewport;
 * the Android implementation maps them to screen pixels and calls AccessibilityService.dispatchGesture.
 */
interface RecipeActions {
  /** Inject a tap; call [onDone] (any thread) with true when the gesture completed. */
  fun tap(x: Float, y: Float, onDone: (Boolean) -> Unit)
  fun swipe(x: Float, y: Float, x2: Float, y2: Float, durationMs: Long, onDone: (Boolean) -> Unit)
  /** Type [field] (roomPassword) into the focused field. false = could not (game UI), manager types it. */
  fun inputText(field: String): Boolean
  /** On-device OCR is out of scope: implementation emits onRoomInfo(nulls) so the manager types it in the app. */
  fun readText(field: String, region: FloatArray)
}

/**
 * Checklist / recipe state machine. Driven by [tick] (every detector frame ≈2 fps and a ~250 ms timer) with a
 * matcher that says whether a fingerprint is visible in the latest frame (null = no frame available).
 *
 * Assisted mode (autoMode = false): never touches the game. A step is ticked when its `expect` screen is seen
 * (seeing a later step's screen ticks everything before it); `wait` steps tick after their delay; steps without
 * a fingerprint wait for the manager to tick them in the bubble ([markDone]).
 *
 * Auto mode: per step → wait for `expect` (until timeoutMs) → perform the action → settle → next.
 * Anything that cannot be done automatically (timeout, gesture cancelled, text input not possible, `manual`)
 * switches to NEEDS_MANUAL with a message; the manager does it and ticks it, and the runner continues.
 */
class RecipeRunner(
  val steps: List<RecipeStepModel>,
  val autoMode: Boolean,
  private val actions: RecipeActions,
  private val clock: () -> Long,
  private val settleMs: Long = 700L,
  private val onChange: (RecipeRunner) -> Unit = {},
) {
  enum class Phase { IDLE, WAITING_SCREEN, ACTING, SETTLING, WAITING, NEEDS_MANUAL, PAUSED, DONE }

  private val lock = Any()
  private val done = BooleanArray(steps.size)

  var index = 0
    private set
  var phase = Phase.IDLE
    private set
  var message: String? = null
    private set

  private var phaseStartedAt = 0L
  private var pausedFrom: Phase? = null
  /** bumps whenever we leave ACTING so late gesture callbacks for an old step are ignored */
  private var actionToken = 0

  val currentStep: RecipeStepModel? get() = steps.getOrNull(index)

  fun isDone(i: Int) = synchronized(lock) { done.getOrElse(i) { false } }

  fun doneList(): List<Pair<String, Boolean>> = synchronized(lock) { steps.mapIndexed { i, s -> s.id to done[i] } }

  fun start() = synchronized(lock) {
    if (phase != Phase.IDLE) return
    enterStep(0)
  }

  fun pause() = synchronized(lock) {
    if (phase == Phase.PAUSED || phase == Phase.DONE || phase == Phase.IDLE) return
    pausedFrom = phase
    actionToken++
    setPhase(Phase.PAUSED, null)
  }

  fun resume() = synchronized(lock) {
    if (phase != Phase.PAUSED) return
    val from = pausedFrom ?: Phase.WAITING_SCREEN
    pausedFrom = null
    // An interrupted action is retried from its screen check.
    setPhase(if (from == Phase.ACTING || from == Phase.SETTLING) Phase.WAITING_SCREEN else from, message)
  }

  /** Manager ticked a step in the bubble (or the JS app). Ticking a later step ticks those before it. */
  fun markDone(stepId: String) = synchronized(lock) {
    val i = steps.indexOfFirst { it.id == stepId }
    if (i < 0 || done[i]) return
    if (i < index) {
      done[i] = true
      notifyChange()
      return
    }
    for (k in index..i) done[k] = true
    actionToken++
    enterStep(i + 1)
  }

  /** Manager says "skip / I did it" for the current step. */
  fun completeCurrent() = synchronized(lock) { currentStep?.let { markDone(it.id) } }

  fun tick(matcher: (FingerprintSpec) -> Boolean?) {
    synchronized(lock) {
      val step = currentStep ?: return
      val now = clock()
      when (phase) {
        Phase.IDLE, Phase.PAUSED, Phase.DONE, Phase.ACTING -> Unit
        Phase.SETTLING -> if (now - phaseStartedAt >= settleMs) completeStep()
        Phase.WAITING -> {
          val ms = (step.action as? StepAction.Wait)?.ms ?: 0L
          if (now - phaseStartedAt >= ms) completeStep()
        }
        Phase.WAITING_SCREEN -> if (autoMode) tickAuto(step, now, matcher) else tickAssisted(step, now, matcher)
        Phase.NEEDS_MANUAL -> {
          // Assisted: even while waiting for the manager, seeing a later screen moves the checklist on.
          if (!autoMode) scanAhead(matcher)
        }
      }
    }
  }

  private fun tickAssisted(step: RecipeStepModel, now: Long, matcher: (FingerprintSpec) -> Boolean?) {
    if (scanAhead(matcher)) return
    val expect = step.expect
    if (expect != null) {
      if (matcher(expect) == true) completeStep()
      return
    }
    when (val a = step.action) {
      is StepAction.Wait -> if (now - phaseStartedAt >= a.ms) completeStep()
      is StepAction.ReadText -> {
        actions.readText(a.field, a.region)
        setPhase(Phase.NEEDS_MANUAL, "Type the ${fieldLabel(a.field)} in the 7XEN app, then tick this step")
      }
      else -> setPhase(Phase.NEEDS_MANUAL, step.hint ?: "Do this step, then tick it")
    }
  }

  /** Assisted only: if a LATER step's screen is visible, everything before it is done. */
  private fun scanAhead(matcher: (FingerprintSpec) -> Boolean?): Boolean {
    for (j in steps.size - 1 downTo index + 1) {
      val e = steps[j].expect ?: continue
      if (matcher(e) == true) {
        for (k in index..j) done[k] = true
        enterStep(j + 1)
        return true
      }
    }
    return false
  }

  private fun tickAuto(step: RecipeStepModel, now: Long, matcher: (FingerprintSpec) -> Boolean?) {
    val expect = step.expect
    if (expect != null && matcher(expect) != true) {
      if (now - phaseStartedAt >= step.timeoutMs) {
        setPhase(Phase.NEEDS_MANUAL, "Screen not recognised — do \"${step.label}\" yourself, then tick it")
      }
      return
    }
    perform(step)
  }

  private fun perform(step: RecipeStepModel) {
    val token = ++actionToken
    val gestureDone: (Boolean) -> Unit = { ok ->
      synchronized(lock) {
        if (token == actionToken && phase == Phase.ACTING) {
          if (ok) setPhase(Phase.SETTLING, null)
          else setPhase(Phase.NEEDS_MANUAL, "The tap was cancelled — do \"${step.label}\" yourself, then tick it")
        }
      }
    }
    when (val a = step.action) {
      is StepAction.Tap -> {
        setPhase(Phase.ACTING, null)
        actions.tap(a.x, a.y, gestureDone)
      }
      is StepAction.Swipe -> {
        setPhase(Phase.ACTING, null)
        actions.swipe(a.x, a.y, a.x2, a.y2, a.durationMs, gestureDone)
      }
      is StepAction.Wait -> setPhase(Phase.WAITING, null)
      is StepAction.InputText -> {
        if (actions.inputText(a.field)) setPhase(Phase.SETTLING, null)
        else setPhase(Phase.NEEDS_MANUAL, "Type the ${fieldLabel(a.field)} yourself, then tick this step")
      }
      is StepAction.ReadText -> {
        actions.readText(a.field, a.region)
        completeStep()
      }
      StepAction.Manual -> setPhase(Phase.NEEDS_MANUAL, step.hint ?: "Do \"${step.label}\" yourself, then tick it")
    }
  }

  private fun completeStep() {
    if (index < steps.size) done[index] = true
    actionToken++
    enterStep(index + 1)
  }

  private fun enterStep(i: Int) {
    index = i.coerceAtMost(steps.size)
    while (index < steps.size && done[index]) index++
    if (index >= steps.size) setPhase(Phase.DONE, null) else setPhase(Phase.WAITING_SCREEN, null)
  }

  private fun setPhase(p: Phase, msg: String?) {
    phase = p
    message = msg
    phaseStartedAt = clock()
    notifyChange()
  }

  private fun notifyChange() {
    try {
      onChange(this)
    } catch (_: Throwable) {
    }
  }

  private fun fieldLabel(field: String) = when (field) {
    "roomPassword" -> "room password"
    "roomId" -> "room ID"
    else -> field
  }
}
