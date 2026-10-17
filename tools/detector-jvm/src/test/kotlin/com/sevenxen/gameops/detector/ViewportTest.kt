package com.sevenxen.gameops.detector

import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import kotlin.math.max
import kotlin.math.min

/**
 * The game viewport vs the server-side finder (services/extractor viewport.find_window on full-res images,
 * src/test/resources/server_viewports.txt). The server is not ground truth (it misses some floating windows),
 * so this reports agreement and only asserts that a found window always holds the detected panel.
 */
class ViewportTest {
    private fun iou(a: IntArray, b: IntArray): Double {
        val x0 = max(a[0], b[0]); val y0 = max(a[1], b[1])
        val x1 = min(a[0] + a[2], b[0] + b[2]); val y1 = min(a[1] + a[3], b[1] + b[3])
        val inter = max(0, x1 - x0).toDouble() * max(0, y1 - y0)
        return inter / (a[2].toDouble() * a[3] + b[2].toDouble() * b[3] - inter)
    }

    private fun overlay(fr: Frame, d: Detection, out: java.io.File) {
        val img = fr.toImage()
        val g = img.createGraphics()
        g.stroke = java.awt.BasicStroke(2f)
        g.color = java.awt.Color.RED
        g.drawRect(d.viewport[0], d.viewport[1], d.viewport[2] - 1, d.viewport[3] - 1)
        d.panel?.let { g.color = java.awt.Color.CYAN; g.drawRect(it[0], it[1], it[2] - 1, it[3] - 1) }
        g.drawString(d.screen, d.viewport[0] + 6, d.viewport[1] + 14)
        g.dispose()
        out.parentFile.mkdirs()
        javax.imageio.ImageIO.write(img, "png", out)
    }

    @Test
    fun viewportAgreesWithServer() {
        val ref = javaClass.getResource("/server_viewports.txt")!!.readText().lines()
            .filter { it.isNotBlank() && !it.startsWith("#") }
            .associate { l -> val p = l.split(" "); p[0] to p }
        var agree = 0; var n = 0; var winBoth = 0; var winServerOnly = 0; var winOursOnly = 0
        val lines = ArrayList<String>()
        for (it in TestImages.labelled()) {
            val key = if (it.group == "real") "real/${it.file.name}" else it.name
            val r = ref[key] ?: continue
            val fr = TestImages.load640(it.file)
            val d = ScreenDetector.classify(fr.argb, fr.w, fr.h)
            val sc = r[1].toDouble() / fr.w
            val ours = IntArray(4) { i -> (d.viewport[i] * sc).toInt() }
            val serverFull = r[3] == "full"
            val server = if (serverFull) intArrayOf(0, 0, r[1].toInt(), r[2].toInt())
            else intArrayOf(r[3].toInt(), r[4].toInt(), r[5].toInt() - r[3].toInt(), r[6].toInt() - r[4].toInt())
            val oursFull = d.viewport[2] == fr.w && d.viewport[3] == fr.h && d.viewport[0] == 0
            val v = iou(ours, server)
            n++
            if (v >= 0.9) agree++
            if (!serverFull && !oursFull) winBoth++
            if (!serverFull && oursFull) winServerOnly++
            if (serverFull && !oursFull) winOursOnly++
            if (v < 0.9) lines += "  $key iou=${"%.2f".format(v)} ours=${ours.contentToString()} server=${server.contentToString()}"
            System.getProperty("overlay")?.let { dir -> overlay(fr, d, java.io.File(dir, key.replace('/', '_') + ".png")) }
            d.panel?.let { p ->
                assertTrue(
                    p[0] >= d.viewport[0] - 8 && p[0] + p[2] <= d.viewport[0] + d.viewport[2] + 8,
                    "$key: panel outside viewport $d",
                )
            }
        }
        println("== viewport vs server: IoU>=0.9 on $agree/$n; window found by both=$winBoth, server only=$winServerOnly, ours only=$winOursOnly")
        lines.forEach { println(it) }
    }
}
