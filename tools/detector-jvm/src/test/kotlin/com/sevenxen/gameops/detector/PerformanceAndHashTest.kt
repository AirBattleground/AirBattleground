package com.sevenxen.gameops.detector

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class PerformanceAndHashTest {
    private val frames: List<Pair<Labelled, Frame>> by lazy {
        TestImages.labelled().map { it to TestImages.load640(it.file) }
    }

    @Test
    fun timingPerFrame() {
        val fs = frames.map { it.second }
        repeat(5) { fs.forEach { f -> ScreenDetector.classify(f.argb, f.w, f.h) } } // JIT warm-up
        // thread CPU time (the build machine may be loaded; wall time is reported too)
        val mx = java.lang.management.ManagementFactory.getThreadMXBean()
        val times = ArrayList<Double>()
        val w0 = System.nanoTime()
        repeat(10) {
            for (f in fs) {
                val t0 = mx.currentThreadCpuTime
                ScreenDetector.classify(f.argb, f.w, f.h)
                times += (mx.currentThreadCpuTime - t0) / 1e6
            }
        }
        val wallMean = (System.nanoTime() - w0) / 1e6 / times.size
        val blank = TestImages.solid(640, 288, 0)
        val b0 = mx.currentThreadCpuTime
        repeat(200) { ScreenDetector.classify(blank.argb, blank.w, blank.h) }
        val blankMs = (mx.currentThreadCpuTime - b0) / 1e6 / 200
        times.sort()
        val mean = times.average()
        val p50 = times[times.size / 2]; val p95 = times[(times.size * 95) / 100]; val mxT = times.last()
        // dHash of a region
        val h0 = System.nanoTime()
        var sink = 0L
        repeat(10) { for (f in fs) sink = sink xor Fingerprint.dHash(f.argb, f.w, f.h, floatArrayOf(0f, 0f, 1f, 1f)) }
        val hashMs = (System.nanoTime() - h0) / 1e6 / (10 * fs.size)
        println(
            "== timing on this JVM (640 px wide frames, ${times.size} runs, thread CPU): classify mean %.2f ms, p50 %.2f, p95 %.2f, max %.2f (wall mean %.2f); black 640x288 frame %.2f ms; dHash %.3f ms (sink %d)"
                .format(mean, p50, p95, mxT, wallMean, blankMs, hashMs, sink and 1),
        )
        assertTrue(p95 < 15.0, "p95 ${"%.2f".format(p95)} ms")
    }

    @Test
    fun robustToScaleAndJpeg() {
        // the phone may hand frames at other widths; the cues are scale-free
        val kinds = mapOf("SLOT_LIST" to Detection.TEAM_LIST, "RESULTS" to Detection.RESULTS)
        for (w in listOf(480, 960)) {
            var ok = 0
            val bad = ArrayList<String>()
            for ((lab, _) in frames) {
                val f = TestImages.downscale(TestImages.argbOf(TestImages.read(lab.file)), w)
                val d = ScreenDetector.classify(f.argb, f.w, f.h)
                if (d.screen == kinds[lab.kind]) ok++ else bad += lab.name
            }
            println("== width $w px: $ok/${frames.size} ${if (bad.isEmpty()) "" else "misses: $bad"}")
            assertTrue(ok >= frames.size * 0.98)
        }
        for ((q, need) in listOf(0.7f to 0.98, 0.5f to 0.95)) {
            var ok = 0
            val bad = ArrayList<String>()
            ScreenDetector.debug = true
            for ((lab, f) in frames) {
                val j = TestImages.jpegRoundTrip(f, q)
                val d = ScreenDetector.classify(j.argb, j.w, j.h)
                if (d.screen == kinds[lab.kind]) ok++ else bad += "${lab.name} ${lab.kind}->${d.screen} ${ScreenDetector.lastDebug.substringBefore(" win=")}"
            }
            ScreenDetector.debug = false
            println("== 640 px re-encoded JPEG q${(q * 100).toInt()}: $ok/${frames.size}")
            bad.forEach { println("     miss $it") }
            assertTrue(ok >= frames.size * need)
        }
    }

    @Test
    fun dHashStability() {
        val full = floatArrayOf(0f, 0f, 1f, 1f)
        val same = ArrayList<Int>()
        val samePanel = ArrayList<Int>()
        val hashes = ArrayList<Pair<Labelled, Long>>()
        val panelHashes = ArrayList<Pair<Labelled, Long>>()
        val rankHashes = ArrayList<Pair<Labelled, Long>>()
        val sameRank = ArrayList<Int>()
        for ((lab, f) in frames) {
            val d = ScreenDetector.classify(f.argb, f.w, f.h)
            val j = TestImages.jpegRoundTrip(f, 0.7f)
            val a = Fingerprint.dHash(f.argb, f.w, f.h, full, d.viewport)
            val b = Fingerprint.dHash(j.argb, j.w, j.h, full, d.viewport)
            same += Fingerprint.distance(a, b)
            hashes += lab to a
            val p = d.panel!!
            val v = d.viewport
            val region = floatArrayOf(
                (p[0] - v[0]).toFloat() / v[2], (p[1] - v[1]).toFloat() / v[3], p[2].toFloat() / v[2], p[3].toFloat() / v[3],
            )
            val pa = Fingerprint.dHash(f.argb, f.w, f.h, region, v)
            val pb = Fingerprint.dHash(j.argb, j.w, j.h, region, v)
            samePanel += Fingerprint.distance(pa, pb)
            panelHashes += lab to pa
            // results: the rank-number column of the gold panel (changes with every scroll step)
            val rr = floatArrayOf(region[0], region[1], region[2] * 0.2f, region[3])
            val ra = Fingerprint.dHash(f.argb, f.w, f.h, rr, v)
            sameRank += Fingerprint.distance(ra, Fingerprint.dHash(j.argb, j.w, j.h, rr, v))
            if (lab.kind == "RESULTS") rankHashes += lab to ra
            assertEquals(a, Fingerprint.fromHex(Fingerprint.toHex(a)))
        }
        same.sort(); samePanel.sort()
        println("== dHash, same frame re-encoded JPEG q70: viewport max ${same.last()} (median ${same[same.size / 2]}), panel max ${samePanel.last()} (median ${samePanel[samePanel.size / 2]})")

        fun pairStats(hs: List<Pair<Labelled, Long>>, label: String) {
            val diff = ArrayList<Int>()
            val sameGroupKind = ArrayList<Int>()
            val crossKind = ArrayList<Int>()
            for (i in hs.indices) for (j in i + 1 until hs.size) {
                val dd = Fingerprint.distance(hs[i].second, hs[j].second)
                if (hs[i].first.group == hs[j].first.group && hs[i].first.kind == hs[j].first.kind) sameGroupKind += dd else diff += dd
                if (hs[i].first.kind != hs[j].first.kind) crossKind += dd
            }
            crossKind.sort()
            if (crossKind.isNotEmpty()) println(
                "   $label: TEAM_LIST vs RESULTS ${crossKind.size} pairs: median %d, >=20 %.1f%%, min %d"
                    .format(crossKind[crossKind.size / 2], 100.0 * crossKind.count { it >= 20 } / crossKind.size, crossKind.first()),
            )
            diff.sort(); sameGroupKind.sort()
            fun share(l: List<Int>, t: Int) = 100.0 * l.count { it >= t } / l.size
            println(
                "   $label: different matches/kinds ${diff.size} pairs: median %d, >=20 %.1f%%, min %d | same match+kind (other scroll positions) %d pairs: median %d, >=10 %.1f%%, min %d"
                    .format(diff[diff.size / 2], share(diff, 20), diff.first(), sameGroupKind.size,
                        sameGroupKind[sameGroupKind.size / 2], share(sameGroupKind, 10), sameGroupKind.first()),
            )
        }
        pairStats(hashes, "viewport hash")
        pairStats(panelHashes, "panel hash   ")
        pairStats(rankHashes, "results rank-column hash")
        sameRank.sort()
        println("   rank-column hash, same frame re-encoded q70: max ${sameRank.last()} (median ${sameRank[sameRank.size / 2]})")
        assertTrue(same.last() <= 6, "viewport hash unstable under JPEG q70: max ${same.last()}")
        assertTrue(samePanel.last() <= 6, "panel hash unstable under JPEG q70: max ${samePanel.last()}")
    }
}
