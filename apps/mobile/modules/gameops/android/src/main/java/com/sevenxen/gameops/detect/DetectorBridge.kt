package com.sevenxen.gameops.detect

import com.sevenxen.gameops.detector.Fingerprint
import com.sevenxen.gameops.detector.ScreenDetector

/**
 * Result of classifying one downscaled frame. viewport = game area inside the frame (x, y, w, h) in frame px;
 * panel = the part that scrolls (RESULTS: gold right panel, TEAM_LIST: card grid) in frame px, or null.
 */
class FrameDetection(val screen: String, val confidence: Float, val viewport: IntArray, val panel: IntArray? = null)

interface Detector {
  fun classify(argb: IntArray, width: Int, height: Int): FrameDetection
  /** 64-bit dHash of [region] = [x, y, w, h] fractions of the given image. */
  fun dHash(argb: IntArray, width: Int, height: Int, region: FloatArray): Long
  fun distance(a: Long, b: Long): Int
}

/**
 * Thin adapter over the Detection workstream's pure-Kotlin detector (`com.sevenxen.gameops.detector`:
 * ScreenDetector + Fingerprint). Failures never break a session: a throwing classify() → OTHER.
 */
object DetectorBridge : Detector {
  override fun classify(argb: IntArray, width: Int, height: Int): FrameDetection = try {
    val d = ScreenDetector.classify(argb, width, height)
    val vp = d.viewport.takeIf { it.size >= 4 && it[2] > 0 && it[3] > 0 } ?: intArrayOf(0, 0, width, height)
    FrameDetection(d.screen, d.confidence, vp, d.panel?.takeIf { it.size >= 4 && it[2] > 0 && it[3] > 0 })
  } catch (t: Throwable) {
    FrameDetection("OTHER", 0f, intArrayOf(0, 0, width, height))
  }

  override fun dHash(argb: IntArray, width: Int, height: Int, region: FloatArray): Long = try {
    Fingerprint.dHash(argb, width, height, region)
  } catch (_: Throwable) {
    0L
  }

  override fun distance(a: Long, b: Long): Int = Fingerprint.distance(a, b)
}

/** Converts a region relative to the game viewport into fractions of the whole frame. */
fun viewportRegionToFrame(region: FloatArray, viewport: IntArray, frameW: Int, frameH: Int): FloatArray = floatArrayOf(
  (viewport[0] + region[0] * viewport[2]) / frameW,
  (viewport[1] + region[1] * viewport[3]) / frameH,
  region[2] * viewport[2] / frameW,
  region[3] * viewport[3] / frameH,
)

/** A frame-pixel rectangle (x, y, w, h) as fractions of the frame. */
fun pixelRectToFrame(rect: IntArray, frameW: Int, frameH: Int): FloatArray =
  floatArrayOf(rect[0].toFloat() / frameW, rect[1].toFloat() / frameH, rect[2].toFloat() / frameW, rect[3].toFloat() / frameH)
