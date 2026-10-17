package com.sevenxen.gameops

import com.sevenxen.gameops.automation.RecipeActions
import com.sevenxen.gameops.automation.RecipeRunner
import com.sevenxen.gameops.automation.RecipeRunner.Phase
import com.sevenxen.gameops.model.FingerprintSpec
import com.sevenxen.gameops.model.RecipeStepModel
import com.sevenxen.gameops.model.StepAction
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RecipeRunnerTest {
  private var now = 0L

  private class FakeActions(var gestureOk: Boolean = true, var textOk: Boolean = false, var async: Boolean = false) : RecipeActions {
    val log = mutableListOf<String>()
    var pending: ((Boolean) -> Unit)? = null
    override fun tap(x: Float, y: Float, onDone: (Boolean) -> Unit) {
      log += "tap $x,$y"
      if (async) pending = onDone else onDone(gestureOk)
    }
    override fun swipe(x: Float, y: Float, x2: Float, y2: Float, durationMs: Long, onDone: (Boolean) -> Unit) {
      log += "swipe $x,$y->$x2,$y2/$durationMs"
      if (async) pending = onDone else onDone(gestureOk)
    }
    override fun inputText(field: String): Boolean { log += "input $field"; return textOk }
    override fun readText(field: String, region: FloatArray) { log += "read $field" }
  }

  private fun fp(h: Long) = FingerprintSpec(h, floatArrayOf(0f, 0f, 1f, 1f), 8)
  private fun step(id: String, action: StepAction, expect: FingerprintSpec? = null, timeout: Long = 5000) =
    RecipeStepModel(id, "label $id", null, expect, action, timeout)

  /** visible screen = this hash; matcher compares exact hash */
  private var screen: Long? = null
  private val matcher: (FingerprintSpec) -> Boolean? = { f -> screen?.let { it == f.hash } }

  private fun runner(steps: List<RecipeStepModel>, auto: Boolean, a: RecipeActions) =
    RecipeRunner(steps, auto, a, { now }, settleMs = 500)

  @Test
  fun autoModeWaitsForScreenThenTapsAndSettles() {
    val a = FakeActions()
    val r = runner(listOf(step("a", StepAction.Tap(0.1f, 0.2f), fp(1)), step("b", StepAction.Tap(0.5f, 0.5f), fp(2))), true, a)
    r.start()
    r.tick(matcher)
    assertEquals(Phase.WAITING_SCREEN, r.phase)
    assertTrue(a.log.isEmpty())

    screen = 1
    r.tick(matcher)
    assertEquals(listOf("tap 0.1,0.2"), a.log)
    assertEquals(Phase.SETTLING, r.phase)
    now += 499; r.tick(matcher)
    assertEquals(0, r.index)
    now += 1; r.tick(matcher)
    assertEquals(1, r.index)
    assertTrue(r.isDone(0))

    screen = 2
    r.tick(matcher)
    now += 500; r.tick(matcher)
    assertEquals(Phase.DONE, r.phase)
    assertEquals(listOf("tap 0.1,0.2", "tap 0.5,0.5"), a.log)
  }

  @Test
  fun autoModeTimeoutFallsBackToManual() {
    val a = FakeActions()
    val r = runner(listOf(step("a", StepAction.Tap(0.1f, 0.1f), fp(1), timeout = 1000), step("b", StepAction.Wait(300))), true, a)
    r.start()
    screen = 99
    now += 999; r.tick(matcher)
    assertEquals(Phase.WAITING_SCREEN, r.phase)
    now += 1; r.tick(matcher)
    assertEquals(Phase.NEEDS_MANUAL, r.phase)
    assertNotNull(r.message)
    r.markDone("a")
    assertEquals(1, r.index)
    assertEquals(Phase.WAITING_SCREEN, r.phase)
    r.tick(matcher) // no expect → perform wait
    assertEquals(Phase.WAITING, r.phase)
    now += 300; r.tick(matcher)
    assertEquals(Phase.DONE, r.phase)
    assertTrue(a.log.isEmpty())
  }

  @Test
  fun cancelledGestureNeedsManual() {
    val a = FakeActions(gestureOk = false)
    val r = runner(listOf(step("a", StepAction.Swipe(0f, 0f, 1f, 1f, 400))), true, a)
    r.start(); r.tick(matcher)
    assertEquals(Phase.NEEDS_MANUAL, r.phase)
    r.completeCurrent()
    assertEquals(Phase.DONE, r.phase)
  }

  @Test
  fun inputTextFallsBackToManualWhenGameHasNoNodes() {
    val a = FakeActions(textOk = false)
    val r = runner(listOf(step("pw", StepAction.InputText("roomPassword")), step("ok", StepAction.Manual)), true, a)
    r.start(); r.tick(matcher)
    assertEquals(Phase.NEEDS_MANUAL, r.phase)
    assertTrue(r.message!!.contains("room password"))
    r.markDone("pw")
    r.tick(matcher)
    assertEquals(Phase.NEEDS_MANUAL, r.phase) // manual step
    assertEquals(1, r.index)

    val b = FakeActions(textOk = true)
    val r2 = runner(listOf(step("pw", StepAction.InputText("roomPassword"))), true, b)
    r2.start(); r2.tick(matcher)
    assertEquals(Phase.SETTLING, r2.phase)
    now += 500; r2.tick(matcher)
    assertEquals(Phase.DONE, r2.phase)
  }

  @Test
  fun readTextEmitsAndContinues() {
    val a = FakeActions()
    val r = runner(listOf(step("id", StepAction.ReadText("roomId", floatArrayOf(0f, 0f, .5f, .1f)))), true, a)
    r.start(); r.tick(matcher)
    assertEquals(listOf("read roomId"), a.log)
    assertEquals(Phase.DONE, r.phase)
  }

  @Test
  fun assistedModeTicksOnScreenAndNeverTaps() {
    val a = FakeActions()
    val steps = listOf(
      step("custom", StepAction.Tap(.1f, .1f), fp(1)),
      step("create", StepAction.Tap(.2f, .2f), fp(2)),
      step("map", StepAction.Tap(.3f, .3f), fp(3)),
      step("pw", StepAction.InputText("roomPassword")),
    )
    val r = runner(steps, false, a)
    r.start()
    screen = 1; r.tick(matcher)
    assertTrue(r.isDone(0)); assertEquals(1, r.index)
    // the manager went fast: the map screen is visible → create + map ticked
    screen = 3; r.tick(matcher)
    assertTrue(r.isDone(1)); assertTrue(r.isDone(2)); assertEquals(3, r.index)
    r.tick(matcher)
    assertEquals(Phase.NEEDS_MANUAL, r.phase) // no fingerprint → manager ticks it
    r.markDone("pw")
    assertEquals(Phase.DONE, r.phase)
    assertTrue(a.log.isEmpty())
  }

  @Test
  fun pauseIgnoresLateGestureAndResumeRetries() {
    val a = FakeActions(async = true)
    val r = runner(listOf(step("a", StepAction.Tap(.5f, .5f))), true, a)
    r.start(); r.tick(matcher)
    assertEquals(Phase.ACTING, r.phase)
    val late = a.pending!!
    r.pause()
    late(true)
    assertEquals(Phase.PAUSED, r.phase)
    r.resume()
    assertEquals(Phase.WAITING_SCREEN, r.phase)
    r.tick(matcher)
    assertEquals(2, a.log.size)
    a.pending!!(true)
    now += 500; r.tick(matcher)
    assertEquals(Phase.DONE, r.phase)
  }

  @Test
  fun doneListReflectsState() {
    val r = runner(listOf(step("a", StepAction.Manual), step("b", StepAction.Manual)), false, FakeActions())
    r.start()
    r.markDone("b")
    assertEquals(listOf("a" to true, "b" to true), r.doneList())
    assertEquals(Phase.DONE, r.phase)
  }
}
