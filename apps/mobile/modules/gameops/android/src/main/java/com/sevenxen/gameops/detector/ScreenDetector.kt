package com.sevenxen.gameops.detector

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * On-device BGMI screen classifier (TEAM_LIST / RESULTS / OTHER) on ARGB frames.
 *
 * A port of the server-side cues (services/extractor/app/pipeline/{viewport,detect}.py, layout.yaml),
 * simplified for speed: one sparse pass over the frame (2x2 samples per cell) builds a coarse cell grid
 * (~160-200 cells wide) of per-cell mean grey and counts of lit / bright / gold / saturated samples; the screen
 * cues are searched on that grid and verified with a few sparse pixel probes. Card darkness uses the cell MEAN
 * grey (survives JPEG / video compression, unlike per-pixel thresholds).
 *
 *  - RESULTS: the gold/bronze right panel = the widest run of columns that are mostly gold, whose gold rows
 *    form >= 2 blocks separated by thin dark lines; plus the dark left panel (rank 1 / rank 2 with white
 *    names) to its left, where the rank-1 wings icon is a small gold blob.
 *  - TEAM_LIST: >= 3 near-black card rectangles of the same size (aspect ~1.9) laid out in a grid, each with
 *    bright text rows (names) and a coloured / bright slot number at the top-left.
 *  - viewport: the floating game window (iPad) = a pair of long horizontal borders with matching ends, else
 *    the whole frame (phones run BGMI full screen).
 *
 * Every size is relative to the frame / the detected panel, so any input resolution works; frames are
 * expected downscaled (~640 px wide). Not thread-safe internally, so [classify] is synchronized; the
 * work buffers are reused between calls (no per-frame allocations except the result).
 */
object ScreenDetector {
    // ------------------------------------------------------------------------------------------ tunables
    private const val GRID_W = 200 // target grid width in cells
    private const val LIT_MIN = 70
    private const val BRIGHT_MIN = 150 // grey >= this = white/grey text
    private const val SAT_MIN = 90 // (max-min)*255/max >= this and max >= 110 = a coloured slot digit

    // results (ratios of the gold panel width pw, from layout.yaml results:)
    private const val GOLD_COL_PEAK = 0.5f // panel columns hold >= this share of the goldest column
    private const val GOLD_MIN_W = 0.18f // gold panel at least this share of the frame width (phone 0.34)
    private const val GOLD_MAX_W = 0.62f
    private const val GOLD_ROW_FILL = 0.5f // a panel row is "gold" if >= this share of its pixels are gold
    private const val LEFT_X0 = -1.12f // left panel x-range relative to the gold panel (layout -1.147 .. -0.029)
    private const val LEFT_X1 = -0.05f
    private const val LEFT_H = 0.79f

    // team list cards
    private const val CARD_MIN_W = 0.13f // share of the frame width (phone 0.227, iPad window ~0.24)
    private const val CARD_MAX_W = 0.40f
    private const val CARD_ASPECT_LO = 1.45f // measured 1.93
    private const val CARD_ASPECT_HI = 2.6f
    private const val CARD_FILL = 0.55f
    // a card cell: mean grey below this (cell means survive JPEG; the blurred map between cards is ~28-40)
    private const val CARD_MEAN_MAX = 25
    private const val CARD_TOL = 0.15f

    /** Features of the last call (only filled when [debug] is true). */
    @Volatile
    var lastDebug: String = ""

    @Volatile
    var debug: Boolean = false

    // --------------------------------------------------------------------------------- reusable buffers
    private var cap = 0
    private var cGray = IntArray(0) // mean grey per cell
    // sample counts per cell:
    private var cBright = IntArray(0)
    private var cGold = IntArray(0)
    private var cColor = IntArray(0)
    private var cLit = IntArray(0) // grey >= LIT_MIN (any visible ink: grey or coloured digits, text)
    private var label = IntArray(0)
    private var queue = IntArray(0)
    private var colAcc = IntArray(0)
    private var rowAcc = IntArray(0)
    private var runA = IntArray(0)
    private var runB = IntArray(0)

    // candidate cards (cell coords) — fixed capacity
    private const val MAX_CANDS = 64
    private val candX0 = IntArray(MAX_CANDS)
    private val candY0 = IntArray(MAX_CANDS)
    private val candX1 = IntArray(MAX_CANDS)
    private val candY1 = IntArray(MAX_CANDS)
    private val candOk = BooleanArray(MAX_CANDS)

    // grid geometry of the current frame
    private var s = 1 // cell size in px
    private var gw = 0 // grid size in cells
    private var gh = 0
    private var spc = 1 // samples per cell

    private fun ensure(cells: Int, w: Int, h: Int) {
        if (cells > cap) {
            cap = cells
            cGray = IntArray(cells); cBright = IntArray(cells)
            cGold = IntArray(cells); cColor = IntArray(cells); cLit = IntArray(cells); label = IntArray(cells); queue = IntArray(cells)
        }
        val m = max(w, h) + 2
        if (colAcc.size < m) {
            colAcc = IntArray(m); rowAcc = IntArray(m); runA = IntArray(m); runB = IntArray(m)
        }
    }

    // ------------------------------------------------------------------------------------- pixel cues
    @Suppress("NOTHING_TO_INLINE")
    private inline fun grey(p: Int): Int =
        (((p shr 16) and 0xff) * 77 + ((p shr 8) and 0xff) * 150 + (p and 0xff) * 29) shr 8

    /** OpenCV HSV gold: H 8..35 (16..70 deg), S >= 70, V >= 40 (layout.yaml right_panel.gold_*). */
    @Suppress("NOTHING_TO_INLINE")
    private inline fun isGold(p: Int): Boolean {
        val r = (p shr 16) and 0xff
        val g = (p shr 8) and 0xff
        val b = p and 0xff
        val mx = max(r, max(g, b))
        if (mx < 40) return false
        val mn = min(r, min(g, b))
        val d = mx - mn
        if (d * 255 < 70 * mx || d == 0) return false
        return if (mx == r) {
            g >= b && 15 * (g - b) >= 4 * d
        } else if (mx == g) {
            b <= r && 6 * (r - b) >= 5 * d
        } else {
            false
        }
    }

    // ------------------------------------------------------------------------------------------- API
    @Synchronized
    fun classify(argb: IntArray, width: Int, height: Int): Detection {
        require(width > 0 && height > 0 && argb.size >= width * height) { "bad frame ${width}x$height" }
        val full = intArrayOf(0, 0, width, height)
        if (width < 32 || height < 32) return Detection(Detection.OTHER, 1f, full, null)
        // BGMI is landscape-only (phone 20:9, iPad window ~4:3): a portrait frame is never a game screen
        if (height * 10 > width * 9) return Detection(Detection.OTHER, 1f, full, null)

        buildGrid(argb, width, height)

        val res = detectResults(argb, width, height)
        val team = if (res == null) detectTeamList(argb, width) else { teamWhy = ""; null }

        // the game window must hold the content anchor (results: gold panel + left panel; team list: cards)
        val win = when {
            res != null -> findWindow(
                ((res[0] - 1.12f * res[2]) / s).toInt(), res[1] / s, (res[0] + res[2]) / s, (res[1] + res[3]) / s,
            )
            team != null -> findWindow(team[0] / s, team[1] / s, (team[0] + team[2]) / s, (team[1] + team[3]) / s)
            else -> findWindow(-1, -1, -1, -1)
        }
        var vp = full
        if (win != null) {
            val wx0 = win[0] * s + s / 2
            val wy0 = win[1] * s + s / 2
            val wx1 = min(width, win[2] * s + s / 2)
            val wy1 = min(height, win[3] * s + s / 2)
            vp = intArrayOf(wx0, wy0, wx1 - wx0, wy1 - wy0)
        }
        val out = when {
            res != null -> Detection(Detection.RESULTS, resConf, vp, res)
            team != null -> Detection(Detection.TEAM_LIST, teamConf, vp, team)
            else -> Detection(Detection.OTHER, 0.9f, vp, null)
        }
        if (debug) lastDebug = "res[$resWhy] team[$teamWhy] win=${win?.contentToString()} $winWhy"
        return out
    }

    // ------------------------------------------------------------------------------------------- grid
    private fun buildGrid(argb: IntArray, width: Int, height: Int) {
        s = max(1, (width + GRID_W - 1) / GRID_W)
        gw = width / s
        gh = height / s
        ensure(gw * gh, width, height)
        val ps = max(1, s / 2) // sample stride inside a cell: 2x2 samples per cell (3x3 when s = 3)
        val off = (s - ((s - 1) / ps) * ps) / 2
        var k = 0
        for (gy in 0 until gh) {
            for (gx in 0 until gw) {
                var n = 0; var sum = 0; var lit = 0; var bright = 0; var gold = 0; var col = 0
                var y = gy * s + off
                val yEnd = gy * s + s
                while (y < yEnd) {
                    var i = y * width + gx * s + off
                    val iEnd = y * width + gx * s + s
                    while (i < iEnd) {
                        val p = argb[i]
                        val r = (p shr 16) and 0xff
                        val g = (p shr 8) and 0xff
                        val b = p and 0xff
                        val gr = (r * 77 + g * 150 + b * 29) shr 8
                        sum += gr
                        if (gr >= LIT_MIN) { lit++; if (gr >= BRIGHT_MIN) bright++ }
                        val mx = max(r, max(g, b))
                        if (mx >= 40) {
                            val d = mx - min(r, min(g, b))
                            if (mx >= 110 && d * 255 >= SAT_MIN * mx) col++
                            if (isGold(p)) gold++
                        }
                        n++
                        i += ps
                    }
                    y += ps
                }
                cGray[k] = sum / n; cBright[k] = bright; cGold[k] = gold; cColor[k] = col; cLit[k] = lit
                k++
            }
        }
        val per = (s + ps - 1 - off) / ps
        spc = max(1, per * per)
    }

    // ---------------------------------------------------------------------------------------- results
    private var resConf = 0f
    private var resWhy = ""

    /** Returns the gold panel (x, y, w, h px) when the frame is a results screen, else null. */
    private fun detectResults(argb: IntArray, width: Int, height: Int): IntArray? {
        resWhy = ""
        // 1. columns that are mostly gold (grid)
        var maxCol = 0
        for (x in 0 until gw) {
            var a = 0
            var k = x
            for (y in 0 until gh) { a += cGold[k]; k += gw }
            colAcc[x] = a
            if (a > maxCol) maxCol = a
        }
        if (maxCol < 0.15f * gh * spc) { if (debug) resWhy = "nogold"; return null }
        val thr = GOLD_COL_PEAK * maxCol
        var bestA = -1; var bestB = -1; var bestSum = 0L
        var x = 0
        while (x < gw) {
            if (colAcc[x] >= thr) {
                var e = x
                var sum = 0L
                while (e < gw && colAcc[e] >= thr) { sum += colAcc[e]; e++ }
                if (sum > bestSum) { bestSum = sum; bestA = x; bestB = e }
                x = e
            } else x++
        }
        if (bestA < 0) { if (debug) resWhy = "nocols"; return null }
        val px0 = bestA * s
        val px1 = min(width, bestB * s)
        val pw = px1 - px0
        if (pw < GOLD_MIN_W * width || pw > GOLD_MAX_W * width) { if (debug) resWhy = "pw=${pw.toFloat() / width}"; return null }

        // 2. gold row profile at pixel resolution inside the panel columns (sparse columns)
        val m0 = px0 + pw / 20
        val m1 = px1 - pw / 20
        val cs = max(1, (m1 - m0) / 48)
        var nRuns = 0
        var y = 0
        var runStart = -1
        while (y <= height) {
            var isRow = false
            if (y < height) {
                var g = 0; var n = 0
                var i = y * width + m0
                val e = y * width + m1
                while (i < e) { if (isGold(argb[i])) g++; n++; i += cs }
                isRow = g >= GOLD_ROW_FILL * n
            }
            if (isRow && runStart < 0) runStart = y
            if (!isRow && runStart >= 0) {
                if (y - runStart >= 0.04f * pw && nRuns < runA.size) { runA[nRuns] = runStart; runB[nRuns] = y; nRuns++ }
                runStart = -1
            }
            y++
        }
        if (nRuns == 0) { if (debug) resWhy = "norows"; return null }
        // merge runs split by texture (gaps far thinner than a separator do not exist: keep as is), count blocks
        var blocks = 0
        var seps = 0
        for (r in 0 until nRuns) {
            if (runB[r] - runA[r] >= 0.15f * pw) blocks++
            if (r > 0) {
                val gap = runA[r] - runB[r - 1]
                if (gap <= 0.07f * pw && gap >= 1) seps++
            }
        }
        val py0 = runA[0]
        val py1 = runB[nRuns - 1]
        val ph = py1 - py0
        if (blocks < 2 || seps < 1) { if (debug) resWhy = "blocks=$blocks seps=$seps"; return null }
        if (ph < 0.5f * pw || ph > 2.2f * pw) { if (debug) resWhy = "ph/pw=${ph.toFloat() / pw}"; return null }
        // gold fill of the panel box (grid)
        val gx0 = bestA; val gx1 = bestB
        val gy0 = py0 / s; val gy1 = max(gy0 + 1, py1 / s)
        val fill = gridShare(cGold, gx0, gy0, gx1, gy1)
        if (fill < 0.45f) { if (debug) resWhy = "fill=$fill"; return null }

        // 3. the dark left panel with names (rank 1 above rank 2)
        val lx0 = max(0, ((px0 + LEFT_X0 * pw) / s).toInt())
        val lx1 = ((px0 + LEFT_X1 * pw) / s).toInt()
        val ly0 = gy0
        val ly1 = min(gh, ((py0 + LEFT_H * pw) / s).toInt())
        if ((lx1 - lx0) * s < 0.75f * pw || ly1 - ly0 < 2) { if (debug) resWhy = "noleft"; return null }
        var lg = 0L; var n = 0
        for (yy in ly0 until ly1) { var k = yy * gw + lx0; for (xx in lx0 until lx1) { lg += cGray[k]; k++; n++ } }
        val lMean = lg.toFloat() / n
        val lGold = gridShare(cGold, lx0, ly0, lx1, ly1)
        val lBright = gridShare(cBright, lx0, ly0, lx1, ly1)
        // wings: gold blob at the left end of the rank-1 block
        val wx0 = max(0, ((px0 - 1.16f * pw) / s).toInt())
        val wx1 = max(wx0 + 1, ((px0 - 0.93f * pw) / s).toInt())
        val wy0 = ((py0 + 0.05f * pw) / s).toInt()
        val wy1 = min(gh, ((py0 + 0.36f * pw) / s).toInt())
        val wings = if (wy1 > wy0) gridShare(cGold, wx0, wy0, wx1, wy1) else 0f
        if (debug) resWhy = "pw=${"%.2f".format(pw.toFloat() / width)} ph/pw=${"%.2f".format(ph.toFloat() / pw)} " +
            "blocks=$blocks seps=$seps fill=${"%.2f".format(fill)} left(mean=${"%.0f".format(lMean)} " +
            "gold=${"%.3f".format(lGold)} bright=${"%.3f".format(lBright)}) wings=${"%.3f".format(wings)}"
        val leftOk = lMean < 75f && lGold < 0.2f && lBright in 0.004f..0.3f
        if (!leftOk) { if (debug) resWhy = "LEFT $resWhy"; return null }
        resConf = min(1f, 0.7f + (if (wings >= 0.03f) 0.2f else 0f) + (if (seps >= 2) 0.1f else 0f))
        return intArrayOf(px0, py0, pw, ph)
    }

    /** Share of samples flagged in [arr] over the cell box [x0,x1)x[y0,y1). */
    private fun gridShare(arr: IntArray, x0: Int, y0: Int, x1: Int, y1: Int): Float {
        val a0 = max(0, x0); val a1 = min(gw, x1); val b0 = max(0, y0); val b1 = min(gh, y1)
        if (a1 <= a0 || b1 <= b0) return 0f
        var sum = 0L
        for (y in b0 until b1) { var k = y * gw + a0; for (x in a0 until a1) { sum += arr[k]; k++ } }
        return sum.toFloat() / ((a1 - a0) * (b1 - b0) * spc)
    }

    // -------------------------------------------------------------------------------------- team list
    private var teamConf = 0f
    private var teamWhy = ""
    private val compDbg = StringBuilder()

    /** Returns the card grid bbox (x, y, w, h px) when the frame is a team list, else null. */
    private fun detectTeamList(argb: IntArray, width: Int): IntArray? {
        teamWhy = ""
        if (debug) compDbg.setLength(0)
        val cells = gw * gh
        // label 0 = not dark, -1 = dark unvisited, >0 component id
        for (k in 0 until cells) label[k] = if (cGray[k] < CARD_MEAN_MAX) -1 else 0
        var nCand = 0
        var comp = 0
        val minW = CARD_MIN_W * gw
        val maxW = CARD_MAX_W * gw
        for (start in 0 until cells) {
            if (label[start] != -1) continue
            comp++
            var qh = 0; var qt = 0
            queue[qt++] = start; label[start] = comp
            var x0 = gw; var y0 = gh; var x1 = -1; var y1 = -1; var area = 0
            while (qh < qt) {
                val k = queue[qh++]
                val x = k % gw; val y = k / gw
                area++
                if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
                if (x > 0 && label[k - 1] == -1) { label[k - 1] = comp; queue[qt++] = k - 1 }
                if (x < gw - 1 && label[k + 1] == -1) { label[k + 1] = comp; queue[qt++] = k + 1 }
                if (y > 0 && label[k - gw] == -1) { label[k - gw] = comp; queue[qt++] = k - gw }
                if (y < gh - 1 && label[k + gw] == -1) { label[k + gw] = comp; queue[qt++] = k + gw }
            }
            val bw = x1 - x0 + 1; val bh = y1 - y0 + 1
            if (debug && bw >= minW / 2 && bh >= 4) compDbg.append("(${bw}x$bh a=$area)")
            if (bw < minW || bw > maxW) continue
            val asp = bw.toFloat() / bh
            if (asp < CARD_ASPECT_LO || asp > CARD_ASPECT_HI) continue
            // count the holes (text) inside the bbox as part of the card: card cells + non-card cells holding ink
            // (text glyphs); other dark components or plain map background count against the fill
            var inside = 0
            for (yy in y0..y1) {
                var k = yy * gw + x0
                for (xx in x0..x1) {
                    val l = label[k]
                    if (l == comp || (l == 0 && cLit[k] > 0)) inside++
                    k++
                }
            }
            if (inside < CARD_FILL * bw * bh || area < 0.45f * bw * bh) continue
            if (nCand < MAX_CANDS) {
                candX0[nCand] = x0; candY0[nCand] = y0; candX1[nCand] = x1 + 1; candY1[nCand] = y1 + 1; nCand++
            }
        }
        if (nCand < 3) { if (debug) teamWhy = "cands=$nCand $compDbg"; return null }

        // largest group of same-size candidates
        var bestRef = -1; var bestN = 0
        for (i in 0 until nCand) {
            val w = candX1[i] - candX0[i]; val h = candY1[i] - candY0[i]
            var n = 0
            for (j in 0 until nCand) {
                if (abs(candX1[j] - candX0[j] - w) <= CARD_TOL * w && abs(candY1[j] - candY0[j] - h) <= CARD_TOL * h) n++
            }
            if (n > bestN) { bestN = n; bestRef = i }
        }
        if (bestN < 3) { if (debug) teamWhy = "group=$bestN cands=$nCand"; return null }
        val rw = candX1[bestRef] - candX0[bestRef]
        val rh = candY1[bestRef] - candY0[bestRef]

        // per card: bright text rows in the names area and a slot digit at the top-left
        var withText = 0; var withDigit = 0; var n = 0
        var bx0 = Int.MAX_VALUE; var by0 = Int.MAX_VALUE; var bx1 = 0; var by1 = 0
        for (j in 0 until nCand) {
            candOk[j] = false
            val w = candX1[j] - candX0[j]; val h = candY1[j] - candY0[j]
            if (abs(w - rw) > CARD_TOL * rw || abs(h - rh) > CARD_TOL * rh) continue
            n++
            candOk[j] = true
            val nx0 = candX0[j] + (0.15f * w).toInt(); val nx1 = candX0[j] + (0.7f * w).toInt()
            val textRows = textRows(nx0, candY0[j], nx1, candY1[j])
            if (textRows >= 2) withText++
            val dx0 = candX0[j]; val dx1 = candX0[j] + max(1, (0.16f * w).roundToInt())
            val dy0 = candY0[j]; val dy1 = candY0[j] + max(1, (0.32f * h).roundToInt())
            val dig = gridShare(cColor, dx0, dy0, dx1, dy1) + gridShare(cLit, dx0, dy0, dx1, dy1)
            if (dig >= 0.04f) withDigit++
            bx0 = min(bx0, candX0[j]); by0 = min(by0, candY0[j]); bx1 = max(bx1, candX1[j]); by1 = max(by1, candY1[j])
        }
        // grid arrangement: neighbours in the same row separated by a small gap, or columns aligned
        var pairs = 0
        for (i in 0 until nCand) {
            if (!candOk[i]) continue
            for (j in 0 until nCand) {
                if (i == j || !candOk[j]) continue
                val sameRow = abs(candY0[i] - candY0[j]) <= 0.25f * rh
                val gap = candX0[j] - candX1[i]
                if (sameRow && gap >= 0 && gap <= 0.3f * rw) pairs++
                val sameCol = abs(candX0[i] - candX0[j]) <= 0.12f * rw
                val vgap = candY0[j] - candY1[i]
                if (sameCol && vgap >= 0 && vgap <= 0.45f * rh) pairs++
            }
        }
        if (debug) teamWhy = "cards=$n text=$withText digit=$withDigit pairs=$pairs w=${"%.2f".format(rw.toFloat() / gw)} " +
            "asp=${"%.2f".format(rw.toFloat() / rh)}"
        if (withText * 3 < n * 2 || withDigit * 2 < n || pairs < 2) { if (debug) teamWhy = "REJ $teamWhy"; return null }
        teamConf = min(1f, 0.6f + 0.05f * n)
        val px0 = bx0 * s; val py0 = by0 * s
        return intArrayOf(px0, py0, min(width - px0, (bx1 - bx0) * s), (by1 - by0) * s)
    }

    /** Number of separate bands of rows holding bright text inside a cell box. */
    private fun textRows(x0: Int, y0: Int, x1: Int, y1: Int): Int {
        var bands = 0
        var inBand = false
        val minHits = max(1, (x1 - x0) / 25)
        for (y in y0 until y1) {
            var k = y * gw + x0
            var hits = 0
            for (x in x0 until x1) { if (cBright[k] > 0) hits++; k++ }
            val on = hits >= minHits
            if (on && !inBand) bands++
            inBand = on
        }
        return bands
    }

    // --------------------------------------------------------------------------------------- viewport
    private var winWhy = ""
    private var prefH = IntArray(0) // per row prefix sums of the (vertically dilated) horizontal-edge map
    private var prefV = IntArray(0) // per column prefix sums of the (horizontally dilated) vertical-edge map
    private const val WIN_MIN_SIDE = 0.55f // every side of the window lies on an edge for >= this share
    private const val WIN_MIN_MEAN = 0.75f
    private val candR = IntArray(20)
    private val candC = IntArray(20)

    /**
     * The floating game window (iPad / freeform / letterbox), as cell box x0,y0,x1,y1, or null = full frame.
     * viewport.py pairs long horizontal border runs; here (coarser grid) every rectangle built from strong
     * edge rows x strong edge columns is scored by how much of its 4 sides lie on an edge, and the largest
     * well-covered one that holds the content anchor (cell box ax0..ay1, ax0 < 0 = none) wins.
     */
    private fun findWindow(ax0: Int, ay0: Int, ax1: Int, ay1: Int): IntArray? {
        winWhy = ""
        val edgeMin = 18
        if (prefH.size < (gw + 1) * gh || prefV.size < (gh + 1) * gw) {
            prefH = IntArray((gw + 1) * gh + 1); prefV = IntArray((gh + 1) * gw + 1)
        }
        val hRaw = label // scratch (team-list labels are no longer needed)
        val vRaw = queue
        for (y in 0 until gh) {
            for (x in 0 until gw) {
                val k = y * gw + x
                hRaw[k] = if (y in 1 until gh - 1 && abs(cGray[k + gw] - cGray[k - gw]) >= edgeMin) 1 else 0
                vRaw[k] = if (x in 1 until gw - 1 && abs(cGray[k + 1] - cGray[k - 1]) >= edgeMin) 1 else 0
            }
        }
        for (y in 0 until gh) {
            var acc = 0
            val base = y * (gw + 1)
            prefH[base] = 0
            for (x in 0 until gw) {
                val k = y * gw + x
                val on = hRaw[k] == 1 || (y > 0 && hRaw[k - gw] == 1) || (y < gh - 1 && hRaw[k + gw] == 1)
                if (on) acc++
                prefH[base + x + 1] = acc
            }
        }
        for (x in 0 until gw) {
            var acc = 0
            val base = x * (gh + 1)
            prefV[base] = 0
            for (y in 0 until gh) {
                val k = y * gw + x
                val on = vRaw[k] == 1 || (x > 0 && vRaw[k - 1] == 1) || (x < gw - 1 && vRaw[k + 1] == 1)
                if (on) acc++
                prefV[base + y + 1] = acc
            }
        }
        val nR = pickLines(gh, gw, true, (0.25f * gw).toInt())
        val nC = pickLines(gw, gh, false, (0.2f * gh).toInt())
        if (debug) winWhy = "rows=${candR.copyOf(nR).contentToString()} cols=${candC.copyOf(nC).contentToString()}"
        if (nR < 2 || nC < 2) return null
        val hasAnchor = ax0 >= 0 || ax1 > 0
        val anchorArea = if (hasAnchor) (ax1 - ax0) * (ay1 - ay0) else 0
        val minArea = 0.3f * gw * gh
        var bestArea = 0
        var bestScore = 0f
        var bx0 = 0; var by0 = 0; var bx1 = 0; var by1 = 0
        for (i in 0 until nR) for (j in 0 until nR) {
            val t = candR[i]; val b = candR[j]
            if (b - t < 0.4f * gh) continue
            if (hasAnchor && (t > ay0 + 1 || b < ay1 - 1)) continue
            for (p in 0 until nC) for (q in 0 until nC) {
                val l = candC[p]; val r = candC[q]
                val w = r - l
                if (w < 0.4f * gw) continue
                val area = w * (b - t)
                if (area <= bestScore || area < minArea) continue
                val asp = w.toFloat() / (b - t)
                if (asp < 1.15f || asp > 2.5f) continue
                if (hasAnchor && (l > ax0 + 1 || r < ax1 - 1 || area < 1.3f * anchorArea)) continue
                val top = (prefH[t * (gw + 1) + r] - prefH[t * (gw + 1) + l]).toFloat() / w
                val bot = (prefH[b * (gw + 1) + r] - prefH[b * (gw + 1) + l]).toFloat() / w
                val lef = (prefV[l * (gh + 1) + b] - prefV[l * (gh + 1) + t]).toFloat() / (b - t)
                val rig = (prefV[r * (gh + 1) + b] - prefV[r * (gh + 1) + t]).toFloat() / (b - t)
                val mn = min(min(top, bot), min(lef, rig))
                if (mn < WIN_MIN_SIDE) continue
                val mean = (top + bot + lef + rig) / 4
                if (mean < WIN_MIN_MEAN) continue
                val m2 = mean * mean
                val score = area * m2 * m2 // prefer the best-covered rectangle; area breaks near-ties
                if (score <= bestScore) continue
                bestScore = score; bestArea = area; bx0 = l; by0 = t; bx1 = r; by1 = b
            }
        }
        if (bestArea == 0) return null
        // two windows side by side (Stage Manager aligns their tops/bottoms) also form a covered rectangle:
        // split at an interior vertical edge running the full height and keep the part holding the anchor
        if (hasAnchor) {
            for (p in 0 until nC) {
                val c = candC[p]
                if (c <= bx0 + (bx1 - bx0) / 10 || c >= bx1 - (bx1 - bx0) / 10) continue
                val cov = (prefV[c * (gh + 1) + by1] - prefV[c * (gh + 1) + by0]).toFloat() / (by1 - by0)
                if (cov < 0.7f) continue
                if (ax1 <= c + 1 && c - bx0 >= 0.4f * gw) bx1 = c else if (ax0 >= c - 1 && bx1 - c >= 0.4f * gw) bx0 = c
            }
        }
        if ((bx1 - bx0) * (by1 - by0) >= 0.9f * gw * gh) return null
        if (debug) winWhy += " box=[$bx0,$by0,$bx1,$by1]"
        return intArrayOf(bx0, by0, bx1, by1)
    }

    /** Local maxima of the per-line edge count (rows: prefH totals, cols: prefV totals) >= minCount. */
    private fun pickLines(n: Int, len: Int, rows: Boolean, minCount: Int): Int {
        val out = if (rows) candR else candC
        var m = 0
        fun count(i: Int): Int =
            if (i < 0 || i >= n) -1
            else if (rows) prefH[i * (gw + 1) + gw] else prefV[i * (gh + 1) + gh]
        for (i in 1 until n - 1) {
            val c = count(i)
            if (c < minCount || c < count(i - 1) || c <= count(i + 1)) continue
            if (m < out.size) out[m++] = i
            else {
                // replace the weakest
                var wi = 0
                for (k in 1 until m) if (count(out[k]) < count(out[wi])) wi = k
                if (count(out[wi]) < c) out[wi] = i
            }
        }
        return m
    }
}
