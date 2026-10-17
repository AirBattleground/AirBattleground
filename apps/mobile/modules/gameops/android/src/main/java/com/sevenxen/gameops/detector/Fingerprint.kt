package com.sevenxen.gameops.detector

import kotlin.math.max
import kotlin.math.min

/**
 * Perceptual difference hash (dHash, 64 bit) of a frame region, for auto-capture dedupe
 * (e.g. "has the results panel scrolled since the last capture?").
 *
 * The region is split into 9x8 cells; each cell is the mean grey of up to 8x8 evenly spread samples; bit
 * (row r, col c) is set when cell (c) is darker than cell (c+1) by more than a small margin, so flat areas
 * (black panels) hash to stable zeros instead of JPEG-noise coin flips.
 */
object Fingerprint {
    private const val MARGIN = 5 // grey levels (x 64 samples, see below) a pair must differ by to set a bit

    /**
     * @param region x, y, w, h as fractions (0..1) of the [viewport] (x, y, w, h px) when given, else of
     *               the whole frame. E.g. Detection.panel converted to fractions of Detection.viewport.
     */
    @JvmOverloads
    fun dHash(argb: IntArray, width: Int, height: Int, region: FloatArray, viewport: IntArray? = null): Long {
        require(region.size >= 4) { "region = x, y, w, h fractions" }
        val bx = viewport?.get(0) ?: 0
        val by = viewport?.get(1) ?: 0
        val bw = viewport?.get(2) ?: width
        val bh = viewport?.get(3) ?: height
        val x0 = clamp((bx + region[0] * bw).toInt(), 0, width - 1)
        val y0 = clamp((by + region[1] * bh).toInt(), 0, height - 1)
        val x1 = clamp((bx + (region[0] + region[2]) * bw).toInt(), x0 + 1, width)
        val y1 = clamp((by + (region[1] + region[3]) * bh).toInt(), y0 + 1, height)
        val rw = x1 - x0
        val rh = y1 - y0
        var hash = 0L
        var bit = 0
        // cell means as sums over 8x8 samples (no division needed for comparisons); no allocations
        for (r in 0 until 8) {
            var prev = 0L
            for (c in 0 until 9) {
                var sum = 0L
                for (sy in 0 until 8) {
                    val y = y0 + ((r * 8 + sy) * 2 + 1) * rh / (8 * 8 * 2)
                    val base = min(y, height - 1) * width
                    for (sx in 0 until 8) {
                        val x = x0 + ((c * 8 + sx) * 2 + 1) * rw / (9 * 8 * 2)
                        val p = argb[base + min(x, width - 1)]
                        sum += (((p shr 16) and 0xff) * 77 + ((p shr 8) and 0xff) * 150 + (p and 0xff) * 29) shr 8
                    }
                }
                if (c > 0) {
                    if (prev + MARGIN * 64 < sum) hash = hash or (1L shl bit)
                    bit++
                }
                prev = sum
            }
        }
        return hash
    }

    /** Hamming distance (0..64). */
    fun distance(a: Long, b: Long): Int = java.lang.Long.bitCount(a xor b)

    fun toHex(h: Long): String {
        val s = java.lang.Long.toHexString(h)
        return "0".repeat(16 - s.length) + s
    }

    fun fromHex(s: String): Long = java.lang.Long.parseUnsignedLong(s.trim(), 16)

    private fun clamp(v: Int, lo: Int, hi: Int): Int = max(lo, min(hi, v))
}
