# detector-jvm — JVM test harness for the on-device screen detector

The 7XEN Manager app classifies the frames it taps from MediaProjection (≈640 px wide, 1–2 fps) to find the
in-game **team list** and **results** screens. The detector is pure Kotlin (no `android.*` imports) and lives in
the app module:

```
apps/mobile/modules/gameops/android/src/main/java/com/sevenxen/gameops/detector/
  Detection.kt       data class Detection(screen, confidence, viewport, panel)
  ScreenDetector.kt  object ScreenDetector { fun classify(argb: IntArray, width: Int, height: Int): Detection }
  Fingerprint.kt     object Fingerprint { dHash / distance / toHex / fromHex }
```

This Gradle project compiles **those same source files** (`sourceSets.main.kotlin.srcDir(...)`) and runs
JUnit 5 tests over the labelled screenshots in `services/extractor/eval/dataset/` (181 images:
phone 1600×720/717, iPad 1600×1199 and 2732×2048 with BGMI full screen or in a floating window).

## Run

```bash
cd tools/detector-jvm
export JAVA_HOME=~/.local/share/7xen-android/jdk17
./gradlew test                      # all tests (≈3 min; most of it is JPEG decode of the full-res dataset)
./gradlew test --tests '*DatasetTest*' -Dverbose=1   # print every frame's features
./gradlew test --tests '*ViewportTest*' -Doverlay=1  # write frames with viewport/panel boxes to build/overlays/
```

Test output (accuracy tables, confusion, timings, hash statistics) is printed to the console.

## How it decides (port of services/extractor detect.py / viewport.py cues, simplified)

One sparse pass builds a cell grid (cell = 4 px on a 640 px frame, 2×2 samples per cell) holding the mean grey
and counts of lit / bright / gold / saturated samples. Then:

* **RESULTS** — the widest run of mostly-gold columns (OpenCV-HSV gold H 8–35, S ≥ 70, V ≥ 40, same as
  `layout.yaml`), 18–62 % of the frame width; its gold row profile (pixel resolution) must form ≥ 2 blocks with
  ≥ 1 thin dark separator, panel height 0.5–2.2× its width, gold fill ≥ 45 %; and the **dark left panel** placed
  from the gold panel (x −1.12…−0.05 pw, height 0.79 pw) must be dark (mean < 75), not gold, with 0.4–30 %
  white text. The rank‑1 wings icon (gold blob) raises confidence.
* **TEAM_LIST** — connected components of cells with mean grey < 25 (card black; cell means survive JPEG
  and video compression), card-shaped (13–40 % of frame width, aspect 1.45–2.6, filled incl. text holes),
  ≥ 3 of the same size; ≥ 2/3 of them have ≥ 2 bright text rows, ≥ 1/2 a lit/coloured slot number at the
  top-left, and ≥ 2 grid neighbour relations (same row with a small gap or same column).
* **viewport** — every rectangle built from strong horizontal-edge rows × vertical-edge columns is scored by
  how much of its 4 sides lie on an edge (each ≥ 55 %, mean ≥ 75 %); the best-covered large one that holds
  the content anchor wins, and it is split at an interior full-height edge (Stage Manager puts windows side by
  side). Nothing found / ≥ 90 % of the frame → the whole frame (phones).
* Portrait frames (h > 0.9 w) are OTHER (BGMI is landscape-only). **LOBBY is not emitted** (no labelled data).

`Detection.panel` = the gold right panel (RESULTS) or the card-grid bbox (TEAM_LIST), in frame pixels.
For scroll dedupe hash it with `Fingerprint.dHash(argb, w, h, region, viewport)`, where `region` is the panel as
fractions of `viewport` (or call the 4-arg overload with fractions of the whole frame).

## Measured (2026-10-17, this machine, JDK 17)

| Test | Result |
|---|---|
| Labelled screenshots → 640 px wide (SLOT_LIST→TEAM_LIST, RESULTS→RESULTS) | **181/181 (100 %)**, every group 100 %; confusion: 22 SLOT_LIST→TEAM_LIST, 159 RESULTS→RESULTS |
| Same at 480 px / 960 px wide | 181/181 / 181/181 |
| 640 px frames re-encoded JPEG q70 / q50 | 181/181 / 181/181 |
| Negatives: 136 web/admin screenshots + 2 login artworks (whole page + 20:9 + 4:3 crops) | 411 frames, **0 false positives** |
| Negatives: synthetic (noise, solid colours, gold/black gradients, 3×3 dark cards without text, gold stripes) | 30 frames, 0 FP |
| Negatives: dataset frames cut/rotated (rot90, left-panel only, gold-panel only, mirrored, top strip, digits strip, header, bottom sliver) | 883 frames, 0 FP |
| Web lightbox showing a team-list screenshot at ~95 % of the page (`ocr-lightbox-1440`) | TEAM_LIST, viewport = the lightbox (treated as a positive, not a negative) |
| classify latency, 640 px frames, thread CPU on this JVM | mean **0.97 ms**, p50 1.03, p95 1.21, max 1.44 (black frame 0.53 ms) |
| dHash latency | 0.03 ms |
| dHash, same frame vs JPEG q70 re-encode | viewport region max **3** (median 0); gold/cards panel region max **6** (median 1) |
| dHash, TEAM_LIST vs RESULTS frames | viewport: median 27, ≥ 20 in 98.8 % (min 14); panel: median 22 |
| dHash, two RESULTS frames of different matches | viewport median 7 (≥ 20 in 23 %) — all results screens share one layout |
| dHash, same match, other scroll position | viewport median 1, panel median 6, rank-column median 3 |
| Viewport vs server `find_window` | IoU ≥ 0.9 on 138/181; the 43 others are mostly server misses (it returns the card grid or a partial box); we find a window on 18 frames where the server returns full, all visually checked as real floating windows |

Timing note: the machine was shared with other builds (load ≈ 14 on 8 cores at one point; a plain
184k-pixel grey loop took 1.1 ms then), so CPU time is reported. The detector does ≈ 1 full-frame-pass worth of
work, so on a mid-range phone (ART, roughly 3–5× slower than desktop HotSpot) expect ≈ 3–5 ms per 640 px frame,
well under the 15 ms budget. Per-frame allocations: only the returned `Detection` and its two small arrays
(work buffers are reused; `classify` is `@Synchronized`).

## Known limitations

* **No gameplay / lobby / BGMI menu frames** in the dataset, so false positives on real in-game footage are
  untested (the negatives are web pages, art, synthetic and cut dataset frames). Validate on a recorded match.
* **dHash is weak for scroll dedupe**: results screens are periodic (3 gold blocks), so two scroll positions of
  the same list often differ by only 0–6 bits even on the panel. Use a low threshold (≤ 2–3 on the panel) plus
  "stable for N frames", and rely on the server merge (`apps/api/src/services/merge.ts`) for duplicates.
* A team list scrolled so that fewer than 3 cards are visible, or with fewer than ~2 bright name rows per card,
  is not detected (all labelled team lists show 5–9 cards).
* Viewport edges are cell-quantised (±4 px on a 640 px frame); on iPad, a narrow side app (toolbar strip)
  touching the game window may be included.
* A full-size BGMI screenshot displayed by another app (gallery, our web lightbox) is detected like the game.
