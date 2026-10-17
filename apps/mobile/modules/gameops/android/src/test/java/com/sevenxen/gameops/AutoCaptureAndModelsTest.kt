package com.sevenxen.gameops

import com.sevenxen.gameops.autocapture.AutoCaptureController
import com.sevenxen.gameops.detect.DetectorBridge
import com.sevenxen.gameops.detect.viewportRegionToFrame
import com.sevenxen.gameops.model.RecipeStepModel
import com.sevenxen.gameops.model.StartOptions
import com.sevenxen.gameops.model.StepAction
import com.sevenxen.gameops.model.hashToHex
import com.sevenxen.gameops.model.hexToHash
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AutoCaptureAndModelsTest {
  private val dist: (Long, Long) -> Int = { a, b -> java.lang.Long.bitCount(a xor b) }

  @Test
  fun capturesOnlyWhenStableSettledAndNew() {
    val c = AutoCaptureController(dist, minIntervalMs = 0)
    var t = 0L
    // first frame: not stable yet
    assertNull(c.onFrame("RESULTS", 0.9f, 0xFFL, t++))
    // second identical frame: stable + settled → capture
    assertEquals("RESULTS", c.onFrame("RESULTS", 0.9f, 0xFFL, t++))
    // same content again → dedupe
    assertNull(c.onFrame("RESULTS", 0.9f, 0xFFL, t++))
    // scrolling: content changes a lot → not settled
    assertNull(c.onFrame("RESULTS", 0.9f, 0xFFFF_0000L, t++))
    // settled at new position → capture
    assertEquals("RESULTS", c.onFrame("RESULTS", 0.9f, 0xFFFF_0000L, t++))
    assertEquals(2, c.count("RESULTS"))
  }

  @Test
  fun resultsScrollPositionsOnlyAFewBitsApartAreEachCaptured() {
    // measured on real screenshots: two scroll positions of the results differ by only ~0–6 bits
    val c = AutoCaptureController(dist, minIntervalMs = 0)
    var t = 0L
    val pos1 = 0x0F0FL
    val pos2 = pos1 xor 0b111L          // 3 bits away from pos1
    val pos3 = pos2 xor 0b1100_0000L    // 2 bits away from pos2
    c.onFrame("RESULTS", 0.9f, pos1, t++)
    assertEquals("RESULTS", c.onFrame("RESULTS", 0.9f, pos1, t++))
    // scrolling = a big frame-to-frame jump, then it settles at pos2
    assertNull(c.onFrame("RESULTS", 0.9f, pos1 xor 0xFFFF_0000L, t++))
    assertNull(c.onFrame("RESULTS", 0.9f, pos2, t++))
    assertEquals("RESULTS", c.onFrame("RESULTS", 0.9f, pos2, t++))
    assertNull(c.onFrame("RESULTS", 0.9f, pos2 xor 0xFF00_0000L, t++))
    assertNull(c.onFrame("RESULTS", 0.9f, pos3, t++))
    assertEquals("RESULTS", c.onFrame("RESULTS", 0.9f, pos3, t++))
    assertEquals(3, c.count("RESULTS"))
  }

  @Test
  fun staticResultsWithTinyFlickerIsNotRecapturedWithoutAScroll() {
    val c = AutoCaptureController(dist, minIntervalMs = 0)
    var t = 0L
    c.onFrame("RESULTS", 0.9f, 0x0F0FL, t++)
    assertEquals("RESULTS", c.onFrame("RESULTS", 0.9f, 0x0F0FL, t++))
    // shimmer: 1-bit wobble, never a real scroll
    repeat(20) { i -> assertNull(c.onFrame("RESULTS", 0.9f, if (i % 2 == 0) 0x0F0EL else 0x0F0FL, t++)) }
    assertEquals(1, c.count("RESULTS"))
  }

  @Test
  fun lowConfidenceAndOtherScreensNeverCapture() {
    val c = AutoCaptureController(dist, minIntervalMs = 0)
    repeat(5) { assertNull(c.onFrame("RESULTS", 0.2f, 1L, it.toLong())) }
    repeat(5) { assertNull(c.onFrame("LOBBY", 0.9f, 1L, it.toLong())) }
    assertEquals("LOBBY", c.stableScreen)
  }

  @Test
  fun teamListMapsToSlotListAndRespectsCap() {
    val c = AutoCaptureController(dist, maxPerKind = mapOf("SLOT_LIST" to 2), minIntervalMs = 0)
    val hashes = listOf(0L, 0xFFFFL, 0xFFFF_0000L, -1L)
    var caps = 0
    var t = 0L
    for (h in hashes) {
      c.onFrame("TEAM_LIST", 1f, h, t++)
      if (c.onFrame("TEAM_LIST", 1f, h, t++) == "SLOT_LIST") caps++
    }
    assertEquals(2, caps)
  }

  @Test
  fun minIntervalBetweenCaptures() {
    val c = AutoCaptureController(dist, minIntervalMs = 1000)
    c.onFrame("RESULTS", 1f, 0L, 0)
    assertEquals("RESULTS", c.onFrame("RESULTS", 1f, 0L, 100))
    c.onFrame("RESULTS", 1f, -1L, 200)
    assertNull(c.onFrame("RESULTS", 1f, -1L, 300))
    assertEquals("RESULTS", c.onFrame("RESULTS", 1f, -1L, 1200))
  }

  @Test
  fun hexRoundTripIncludingHighBit() {
    for (h in listOf(0L, 1L, -1L, Long.MIN_VALUE, 0x0123456789abcdefL)) {
      val hex = hashToHex(h)
      assertEquals(16, hex.length)
      assertEquals(h, hexToHash(hex))
    }
  }

  @Test
  fun parsesStartOptionsAndRecipeSteps() {
    val opts = StartOptions.fromMap(
      mapOf(
        "apiBaseUrl" to "http://192.168.0.199/", "token" to "t", "matchId" to "m", "recordingId" to "r", "title" to "X",
        "checklist" to listOf(
          mapOf(
            "id" to "s1", "label" to "Open Custom Room", "hint" to "top right",
            "expect" to mapOf("hash" to "ffffffffffffffff", "region" to listOf(0.0, 0.0, 1.0, 0.5), "maxDistance" to 6.0),
            "action" to mapOf("type" to "tap", "x" to 0.9, "y" to 0.1), "timeoutMs" to 20000.0,
          ),
          mapOf("id" to "s2", "label" to "Swipe", "action" to mapOf("type" to "swipe", "x" to 0.1, "y" to 0.5, "x2" to 0.1, "y2" to 0.2)),
        ),
        "autoMode" to true, "recordVideo" to true, "quality" to "1080p", "autoCapture" to true, "launchBgmi" to false,
      ),
    )
    assertEquals("http://192.168.0.199", opts.apiBaseUrl)
    assertEquals(2, opts.checklist.size)
    val s1 = opts.checklist[0]
    assertEquals(-1L, s1.expect!!.hash)
    assertEquals(6, s1.expect!!.maxDistance)
    assertEquals(StepAction.Tap(0.9f, 0.1f), s1.action)
    assertEquals(20000L, s1.timeoutMs)
    assertEquals(400L, (opts.checklist[1].action as StepAction.Swipe).durationMs)
    // round trip
    val again = RecipeStepModel.fromMap(s1.toMap())
    assertEquals(s1, again)
  }

  @Test
  fun viewportRegionMapping() {
    val r = viewportRegionToFrame(floatArrayOf(0.5f, 0.5f, 0.5f, 0.5f), intArrayOf(100, 0, 400, 300), 600, 300)
    assertArrayEquals(floatArrayOf(300f / 600, 150f / 300, 200f / 600, 150f / 300), r, 1e-6f)
  }

  @Test
  fun bridgeHashDiscriminates() {
    val w = 64
    val h = 32
    val gradient = IntArray(w * h) { i -> val x = i % w; val v = x * 4; (0xff shl 24) or (v shl 16) or (v shl 8) or v }
    val flipped = IntArray(w * h) { i -> val x = w - 1 - i % w; val v = x * 4; (0xff shl 24) or (v shl 16) or (v shl 8) or v }
    val a = DetectorBridge.dHash(gradient, w, h, floatArrayOf(0f, 0f, 1f, 1f))
    val b = DetectorBridge.dHash(flipped, w, h, floatArrayOf(0f, 0f, 1f, 1f))
    assertEquals(a, DetectorBridge.dHash(gradient, w, h, floatArrayOf(0f, 0f, 1f, 1f)))
    assertNotEquals(a, b)
    assertEquals(64, DetectorBridge.distance(a, b))
    // a blank frame never classifies as a capture screen
    val blank = IntArray(320 * 180) { 0xff000000.toInt() }
    val d = DetectorBridge.classify(blank, 320, 180)
    assertEquals(null, AutoCaptureController.kindForScreen(d.screen))
  }
}
