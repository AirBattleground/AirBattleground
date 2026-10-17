package com.sevenxen.gameops.detector

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Every labelled BGMI screenshot, downscaled to 640 px wide like the phone frame tap. */
class DatasetTest {
    private val expected = mapOf("SLOT_LIST" to Detection.TEAM_LIST, "RESULTS" to Detection.RESULTS)

    @Test
    fun labelledScreenshotsAreDetected() {
        val items = TestImages.labelled()
        assertEquals(181, items.size, "labelled screenshots in services/extractor/eval/dataset")
        ScreenDetector.debug = true
        val perGroup = LinkedHashMap<String, IntArray>() // ok, total
        val confusion = LinkedHashMap<String, Int>()
        val failures = ArrayList<String>()
        var ok = 0
        for (it in items) {
            val fr = TestImages.load640(it.file)
            val d = ScreenDetector.classify(fr.argb, fr.w, fr.h)
            val want = expected.getValue(it.kind)
            val g = perGroup.getOrPut(it.group) { IntArray(2) }
            g[1]++
            confusion.merge("${it.kind} -> ${d.screen}", 1, Int::plus)
            if (d.screen == want) {
                ok++; g[0]++
            } else {
                failures += "${it.name} (${it.kind}) -> $d  ${ScreenDetector.lastDebug}"
            }
            if (System.getProperty("verbose") != null) println("${it.name} ${it.kind} -> $d ${ScreenDetector.lastDebug}")
        }
        ScreenDetector.debug = false
        println("== per-group accuracy (640 px wide frames)")
        for ((g, v) in perGroup) println("  %-5s %2d/%2d".format(g, v[0], v[1]))
        println("== confusion")
        for ((k, v) in confusion) println("  %-26s %d".format(k, v))
        println("== failures (${failures.size})")
        failures.forEach { println("  $it") }
        val acc = ok.toDouble() / items.size
        println("== accuracy %d/%d = %.1f%%".format(ok, items.size, acc * 100))
        assertTrue(acc >= 0.99, "accuracy ${"%.3f".format(acc)} < 0.99")
    }
}
