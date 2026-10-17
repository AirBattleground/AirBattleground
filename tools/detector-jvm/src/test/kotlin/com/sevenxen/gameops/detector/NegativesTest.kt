package com.sevenxen.gameops.detector

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File
import kotlin.math.max
import kotlin.math.min
import kotlin.random.Random

/** Frames that must classify as OTHER. */
class NegativesTest {
    private companion object { const val LIGHTBOX = "ocr-lightbox-1440.jpg" }
    private val res = File(javaClass.getResource("/negatives")!!.toURI())

    private fun check(name: String, fr: Frame, bad: MutableList<String>) {
        val f = TestImages.downscale(fr)
        val d = ScreenDetector.classify(f.argb, f.w, f.h)
        if (d.screen != Detection.OTHER) bad += "$name -> $d ${ScreenDetector.lastDebug}"
    }

    private fun runAll(cases: Sequence<Pair<String, Frame>>): Int {
        ScreenDetector.debug = true
        val bad = ArrayList<String>()
        var n = 0
        for ((name, fr) in cases) { check(name, fr, bad); n++ }
        ScreenDetector.debug = false
        println("   $n frames, false positives: ${bad.size}")
        bad.forEach { println("     FP $it") }
        assertEquals(0, bad.size, "false positives: $bad")
        return n
    }

    @Test
    fun webAppScreenshotsAndLoginArt() {
        println("== negatives: 7xen web/admin screenshots + login artwork (whole page, and 20:9 / 4:3 windows of it)")
        // ocr-lightbox-1440 shows a real team-list screenshot at ~95% of the page: that one is a positive (below)
        val files = (res.resolve("web").listFiles()!!.toList() + res.resolve("login").listFiles()!!.toList())
            .filter { it.name != LIGHTBOX }.sorted()
        runAll(
            files.asSequence().flatMap { f ->
                val fr = TestImages.argbOf(TestImages.read(f))
                val out = mutableListOf(f.name to fr)
                // the page as a landscape phone would show it: top 20:9 and 4:3 windows
                for ((tag, ratio) in listOf("20x9" to 9.0 / 20, "4x3" to 0.75)) {
                    val h = min(fr.h, (fr.w * ratio).toInt())
                    out += "${f.name}[$tag]" to fr.crop(0, 0, fr.w, h)
                }
                out.asSequence()
            },
        )
    }

    @Test
    fun fullSizeScreenshotInAWebLightboxIsATeamList() {
        // the web portal's lightbox showing a team-list screenshot almost full size: detected, and the viewport
        // finder returns the lightbox (letterbox case) rather than the page
        val fr = TestImages.downscale(TestImages.argbOf(TestImages.read(res.resolve("web/$LIGHTBOX"))))
        val d = ScreenDetector.classify(fr.argb, fr.w, fr.h)
        println("== $LIGHTBOX (${fr.w}x${fr.h}) -> $d")
        assertEquals(Detection.TEAM_LIST, d.screen)
        assertTrue(d.viewport[0] > 0 && d.viewport[1] > 0 && d.viewport[2] < fr.w, "viewport = the lightbox")
    }

    @Test
    fun syntheticFrames() {
        println("== negatives: synthetic (noise, solid colours, gradients, fake card grids without text, gold blocks)")
        val rnd = Random(7)
        val cases = ArrayList<Pair<String, Frame>>()
        for ((w, h) in listOf(640 to 288, 640 to 480)) {
            cases += "noise ${w}x$h" to Frame(IntArray(w * h) { (0xff shl 24) or rnd.nextInt(0x1000000) }, w, h)
            cases += "dark-noise ${w}x$h" to Frame(IntArray(w * h) {
                val v = rnd.nextInt(40); (0xff shl 24) or (v shl 16) or (v shl 8) or v
            }, w, h)
            for (c in listOf(0x000000, 0xffffff, 0x1e1e1e, 0x808080, 0xc8a028, 0x8a6a20, 0xd4af37, 0x101820, 0xff0000)) {
                cases += "solid #%06x ${w}x$h".format(c) to TestImages.solid(w, h, c)
            }
            cases += "h-gradient black->gold" to Frame(IntArray(w * h) { i ->
                val t = (i % w) * 255 / w
                (0xff shl 24) or ((t * 200 / 255) shl 16) or ((t * 160 / 255) shl 8) or (t * 40 / 255)
            }, w, h)
            cases += "v-gradient gold->black" to Frame(IntArray(w * h) { i ->
                val t = 255 - (i / w) * 255 / h
                (0xff shl 24) or ((t * 200 / 255) shl 16) or ((t * 160 / 255) shl 8) or (t * 40 / 255)
            }, w, h)
            cases += "3x3 dark cards, no text" to cardGrid(w, h, text = false)
            cases += "gold stripes, no left panel" to goldStripes(w, h)
        }
        runAll(cases.asSequence())
    }

    @Test
    fun datasetCropsThatCutTheKeyRegions() {
        println("== negatives: dataset frames cut / rotated so the key regions are gone")
        val cases = TestImages.labelled().asSequence().flatMap { lab ->
            val fr = TestImages.load640(lab.file)
            val d = ScreenDetector.classify(fr.argb, fr.w, fr.h)
            val p = d.panel ?: return@flatMap emptySequence()
            val out = ArrayList<Pair<String, Frame>>()
            out += "${lab.name}[rot90]" to fr.rotate90()
            if (d.screen == Detection.RESULTS) {
                // only the left panel (no gold), only the gold panel (no left panel), mirrored
                out += "${lab.name}[left-only]" to fr.crop(0, 0, max(8, p[0] - 2), fr.h)
                val x = max(0, p[0] - p[2] / 4)
                out += "${lab.name}[gold-only]" to fr.crop(x, 0, fr.w - x, fr.h)
                out += "${lab.name}[mirrored]" to fr.flipH()
                // top strip above the panel middle (blocks cut)
                out += "${lab.name}[top-strip]" to fr.crop(0, 0, fr.w, max(8, p[1] + p[3] / 5))
            } else {
                // slot digits strip only; header only; middle column only
                out += "${lab.name}[digits-strip]" to fr.crop(p[0], 0, max(8, p[2] / 10), fr.h)
                out += "${lab.name}[header]" to fr.crop(0, 0, fr.w, max(8, p[1] + p[3] / 12))
                out += "${lab.name}[bottom-sliver]" to fr.crop(0, p[1] + p[3] * 9 / 10, fr.w, fr.h - (p[1] + p[3] * 9 / 10))
            }
            out.asSequence()
        }
        runAll(cases)
    }

    private fun cardGrid(w: Int, h: Int, text: Boolean): Frame {
        val px = IntArray(w * h) { (0xff shl 24) or 0x2a2e30 }
        val cw = (0.23 * w).toInt(); val ch = (cw / 1.93).toInt()
        for (r in 0 until 3) for (c in 0 until 3) {
            val x0 = (0.12 * w).toInt() + c * (cw + w / 60); val y0 = (0.12 * h).toInt() + r * (ch + h / 50)
            for (y in y0 until min(h, y0 + ch)) for (x in x0 until min(w, x0 + cw)) px[y * w + x] = (0xff shl 24) or 0x0c0c0e
            if (text) for (y in y0 + 5 until y0 + 9) for (x in x0 + 20 until x0 + 60) px[y * w + x] = -1
        }
        return Frame(px, w, h)
    }

    private fun goldStripes(w: Int, h: Int): Frame {
        val px = IntArray(w * h) { (0xff shl 24) or 0x101010 }
        val x0 = w / 2; val x1 = w * 9 / 10
        for (y in h / 6 until h * 5 / 6) {
            if ((y / (h / 8)) % 2 == 0 && y % (h / 8) < 3) continue
            for (x in x0 until x1) px[y * w + x] = (0xff shl 24) or 0xb08a2a
        }
        return Frame(px, w, h)
    }

    @Test
    fun syntheticPositiveSanity() {
        // the fake grid WITH text and digits is not required to pass; this only documents what the rule needs
        val d = ScreenDetector.classify(cardGrid(640, 288, text = true).argb, 640, 288)
        println("== synthetic card grid with one text row per card -> ${d.screen} (needs >= 2 text rows + a slot digit)")
        assertTrue(d.screen == Detection.OTHER || d.screen == Detection.TEAM_LIST)
    }
}
