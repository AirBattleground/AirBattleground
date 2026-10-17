package com.sevenxen.gameops.detector

/**
 * Result of [ScreenDetector.classify].
 *
 * @property screen     "TEAM_LIST" | "RESULTS" | "LOBBY" | "OTHER"
 * @property confidence 0..1 (OTHER: confidence that it is none of the known screens)
 * @property viewport   x, y, w, h of the game area in input-frame pixels (the whole frame when BGMI is full screen)
 * @property panel      x, y, w, h in input-frame pixels: RESULTS -> the gold right panel (scrolls; hash it for
 *                      dedupe), TEAM_LIST -> bounding box of the card grid. null for LOBBY / OTHER.
 *
 * Pure Kotlin (no android.* imports): compiled for the app and for the JVM test harness in tools/detector-jvm.
 */
data class Detection(
    val screen: String,
    val confidence: Float,
    val viewport: IntArray,
    val panel: IntArray?,
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is Detection) return false
        return screen == other.screen && confidence == other.confidence &&
            viewport.contentEquals(other.viewport) &&
            (panel?.contentEquals(other.panel ?: return false) ?: (other.panel == null))
    }

    override fun hashCode(): Int {
        var h = screen.hashCode()
        h = 31 * h + confidence.hashCode()
        h = 31 * h + viewport.contentHashCode()
        h = 31 * h + (panel?.contentHashCode() ?: 0)
        return h
    }

    override fun toString(): String =
        "Detection($screen, conf=${"%.2f".format(confidence)}, viewport=${viewport.contentToString()}, " +
            "panel=${panel?.contentToString()})"

    companion object {
        const val TEAM_LIST = "TEAM_LIST"
        const val RESULTS = "RESULTS"
        const val LOBBY = "LOBBY"
        const val OTHER = "OTHER"
    }
}
