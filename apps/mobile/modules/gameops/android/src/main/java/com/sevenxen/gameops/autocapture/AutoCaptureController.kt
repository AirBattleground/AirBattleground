package com.sevenxen.gameops.autocapture

/**
 * Decides when a detector frame should trigger a full-resolution still (pure logic, JVM-tested).
 *
 *  - The screen must be TEAM_LIST or RESULTS for [stableFrames] consecutive frames with confidence ≥ [minConfidence].
 *  - The content must have settled (content hash within [settleDistance] of the previous frame's) — so we don't
 *    capture mid-scroll.
 *  - It must be new. Results scroll positions look almost identical to a dHash (repeating gold blocks: 0–6 bits apart,
 *    measured on 181 real screenshots), so for RESULTS a capture needs MOVEMENT since the previous capture (a
 *    frame-to-frame jump > [settleDistance]) and is only dropped when its hash is within [dedupeDistanceResults]
 *    (default 0 = exact repeat). Over-capturing is safe — the server merges repeated ranks; missing a position isn't.
 *    TEAM_LIST keeps the looser [dedupeDistance].
 *  - At most [maxPerKind] captures per kind, and at least [minIntervalMs] between captures.
 *
 * contentHash = dHash of the region that changes when scrolling (results: right panel; team list: whole viewport).
 */
class AutoCaptureController(
  private val distance: (Long, Long) -> Int,
  val stableFrames: Int = 2,
  val minConfidence: Float = 0.6f,
  val settleDistance: Int = 3,
  val dedupeDistance: Int = 6,
  val dedupeDistanceResults: Int = 0,
  val maxPerKind: Map<String, Int> = mapOf(SLOT_LIST to 6, RESULTS to 20),
  val minIntervalMs: Long = 1200L,
) {
  companion object {
    const val SLOT_LIST = "SLOT_LIST"
    const val RESULTS = "RESULTS"

    fun kindForScreen(screen: String): String? = when (screen) {
      "TEAM_LIST" -> SLOT_LIST
      "RESULTS" -> RESULTS
      else -> null
    }
  }

  private var lastScreen: String? = null
  private var streak = 0
  private var lastContentHash: Long? = null
  private var lastCaptureAt = Long.MIN_VALUE / 2
  private val captured = HashMap<String, MutableList<Long>>()
  /** per kind: did the content move (scroll) since that kind's last capture? */
  private val movedSinceCapture = HashMap<String, Boolean>()

  /** Stable screen (seen ≥ stableFrames in a row), or null while it is still changing. */
  var stableScreen: String? = null
    private set

  fun count(kind: String): Int = captured[kind]?.size ?: 0

  /** Record a manual capture so auto-capture doesn't take the same picture again. */
  @Synchronized
  fun noteManualCapture(kind: String, contentHash: Long?) {
    if (contentHash != null) captured.getOrPut(kind) { mutableListOf() }.add(contentHash)
    movedSinceCapture[kind] = false
  }

  /** Returns the screenshot kind to capture now, or null. */
  @Synchronized
  fun onFrame(screen: String, confidence: Float, contentHash: Long?, nowMs: Long): String? {
    val effective = if (confidence >= minConfidence) screen else "OTHER"
    if (effective == lastScreen) streak++ else {
      lastScreen = effective
      streak = 1
    }
    if (streak >= stableFrames) stableScreen = effective
    val prevHash = lastContentHash
    lastContentHash = contentHash

    val kind = kindForScreen(effective) ?: return null
    if (contentHash != null && prevHash != null && distance(prevHash, contentHash) > settleDistance) {
      movedSinceCapture[kind] = true
      return null // still scrolling
    }
    if (streak < stableFrames || contentHash == null || prevHash == null) return null
    if (nowMs - lastCaptureAt < minIntervalMs) return null
    val list = captured.getOrPut(kind) { mutableListOf() }
    if (list.size >= (maxPerKind[kind] ?: 6)) return null
    if (kind == RESULTS) {
      // first view of the results always; afterwards only once it scrolled and settled somewhere not yet captured
      if (list.isNotEmpty() && movedSinceCapture[kind] != true) return null
      if (list.any { distance(it, contentHash) <= dedupeDistanceResults }) return null
    } else if (list.any { distance(it, contentHash) <= dedupeDistance }) return null
    list.add(contentHash)
    movedSinceCapture[kind] = false
    lastCaptureAt = nowMs
    return kind
  }
}
