# 7xen extractor

Local, free, offline service that reads BGMI screenshots and returns structured JSON:

* **SLOT_LIST** (lobby cards) → `teams[]`: slot number + player names
* **RESULTS** (end-of-match ranking) → `rows[]`: rank + player names + finishes (kills), and — when a roster
  is sent — the slot each row belongs to (`inferred_slot`)

FastAPI + OpenCV + PaddleOCR 3.x (recognition only, CPU). Contract: `app/schemas.py`. Architecture and the
training loop: `docs/phase2/ARCHITECTURE.md`. Measured accuracy: `eval/PIPELINE_BASELINE.md`.

## Run

```bash
cd services/extractor
uv sync                                    # Python 3.11 venv (paddlepaddle + paddleocr are large)
uv run uvicorn app.main:app --port 8090    # first start downloads the OCR models once (~30 MB)
```

Docker (models are baked into the image at build time; no network needed at runtime):

```bash
docker build -t 7xen-extractor services/extractor
docker run --rm -p 8090:8090 -v "$PWD/storage:/data/storage" 7xen-extractor
# or, with the whole stack:
docker-compose --profile full up -d --build
```

### Try it

```bash
curl localhost:8090/healthz
curl localhost:8090/v1/version
curl -F image=@eval/dataset/real/lobby-1.jpg -F kind=slot_list localhost:8090/v1/extract
curl -F image=@eval/dataset/real/result-2.jpg -F kind=results \
     -F 'roster={"slots":[{"slot":19,"players":["THxCASHHH","TFxVishavvvS7","THxBakiiJod","VAIBHAVBHAIYA"]}]}' \
     localhost:8090/v1/extract
curl -F images=@a.jpg -F images=@b.jpg -F kind=results localhost:8090/v1/extract/batch   # or one .zip
```

Errors are `{"error": {"code", "message"}}` with 400 (bad kind/roster/missing file), 413 (too large /
too many files), 415 (not PNG/JPEG/WebP — sniffed from bytes), 422 (undecodable). Every response has
`X-Request-ID` (yours is echoed back). Logs are JSON lines (structlog) carrying the request id.

From Python (training / eval) call the pipeline directly, no HTTP:

```python
from app.pipeline.orchestrator import extract_image   # also re-exported by app.api.extract
ex = extract_image(image_bytes, "results", roster)     # -> app.schemas.Extraction
```

It uses `app.bundle.active_bundle()` on every call (fine-tuned rec model, lexicon, char_fixes, layout
overrides), so a registry override changes what it runs.

## Configure (environment or `services/extractor/.env`)

| variable | default | meaning |
|---|---|---|
| `STORAGE_DIR` | `<repo>/storage` | shared with apps/api (training images by relative path) |
| `MODELS_DIR` | `services/extractor/models` | model versions (training registry) |
| `LAYOUT_PATH` | `app/config/layout.yaml` | screen layouts / thresholds |
| `OCR_REC_MODEL` | `PP-OCRv6_small_rec` | stock recogniser (see the baseline for why) |
| `OCR_REC_MODEL_DIR` | — | load the stock recogniser from a local directory instead |
| `OCR_ALT_REC_MODELS` | `["devanagari_PP-OCRv5_mobile_rec"]` | re-read names scoring < `OCR_ALT_BELOW` (0.75) |
| `OCR_THREADS` / `OCR_BATCH_SIZE` | 4 / 16 | CPU threads per predictor / strips per batch |
| `LOW_CONFIDENCE` | 0.85 | below this a value marks the extraction `needs_review` |
| `MAX_IMAGE_MB` / `MAX_BATCH_FILES` | 10 / 40 | upload limits |
| `VLM_ENABLED` | false | Ollama VLM fallback for low-confidence names |
| `OLLAMA_URL` / `VLM_MODEL` / `VLM_TIMEOUT_S` | `http://localhost:11434` / `qwen2.5vl:3b` / 30 | VLM settings |
| `DEBUG_CROPS` / `DEBUG_DIR` | false / `services/extractor/debug` | write overlay + every strip + raw reads per image |
| `LOG_LEVEL` / `LOG_JSON` | INFO / true | logging |

Models live in the PaddleX cache (`PADDLE_PDX_CACHE_HOME`, default `~/.paddlex`). Pre-fetch them with
`uv run python -m app.pipeline.ocr_paddle --download`; at runtime `PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True`
is set so nothing is fetched.

## How it reads a screenshot (`app/pipeline/`)

0. `viewport.py` — find the game frame: the whole image for full-screen shots, or the floating BGMI window on
   iPad (long paired horizontal borders, refined with vertical edges; rejected unless it contains the game
   content). The frame is cropped and resized so the HUD has its canonical size, measured from the content
   itself (gold results-panel width → 544 px, slot-card width → 363 px), so 20:9 phones, 4:3 iPads, windows of
   any size and 2732x2048 screenshots all reach the same pixel geometry. The debug output draws the viewport.
1. `detect.py` — SLOT_LIST: near-black cards → threshold + contours, filtered by shape and grouped by size,
   row-major, up to 9 (falls back to the grid). RESULTS: the gold right panel is found by colour, split into
   blocks at the dark separators; every other length (block height, the pinned left panel with rank 1 /
   rank 2) is a fraction of the gold panel width. Blocks at the panel edge are classified as *cut* (dropped
   if mostly hidden, otherwise only fully visible rows are read) or *complete but short* (teams with fewer
   players — their rank digit is centred).
2. `crop.py` — slot/rank digit box, 4 name rows, 4 finishes rows per card/block (fractions of the box).
3. `preprocess.py` — tighten each strip to its text (ink = min(B,G,R): white text vs dark *or* gold
   backgrounds; HSV value + Otsu for coloured slot digits), detect empty rows, pad, hand the original colour
   pixels to the recogniser (measured far better than binarised input).
4. `ocr_paddle.py` — one batched recognition call per image; low-confidence names get a second opinion;
   `ocr_vlm.py` optionally asks a local VLM.
5. `postprocess.py` — NFC, edge-noise strip, bundle `char_fixes`, digit lookalikes for slot/rank,
   `"N finishes"`/`"1 finish"` parsing (singular ⇒ 1), sequence checks (slots ascending, ranks consecutive,
   single gaps filled from neighbours at confidence 0.6).
6. `roster.py` — rapidfuzz WRatio + Levenshtein on lookalike-folded names against the roster and the bundle
   lexicon; results rows vote their `inferred_slot`, then names are assigned one-to-one inside that slot,
   leftovers by elimination (flagged for review).

## Add or adjust a layout

All geometry and thresholds are in `app/config/layout.yaml` — the code has no pixel constants.

* Detection runs on the *normalised* image (see `viewport:`): RESULTS geometry is a fraction of the gold panel
  width, SLOT_LIST cards are found by shape; the grid fallback uses offsets from the image centre in layout
  units (`unit_px`).
* Everything inside a card/block is a fraction of that box (`row_centers`, `row_height`, `x0..x1`).
* To support a new screen: take a sample, run with `DEBUG_CROPS=true`, open
  `debug/<image-id>-<kind>/overlay.png`, adjust the ratios until boxes sit on the text, then bump
  `layout_version` and run `uv run python -m app.pipeline.bench` + `uv run pytest -m slow tests/test_pipeline_integration.py`.
* A trained model bundle may override any key (its `layout` is deep-merged over the file), so per-device
  tuning can ship without code changes.

## Test and measure

```bash
uv run pytest -m "not slow"                       # fast unit + API contract tests
uv run pytest -m slow tests/test_pipeline_integration.py tests/test_pipeline_ipad.py   # full OCR on real images
uv run python -m app.pipeline.bench               # rewrites eval/PIPELINE_BASELINE.md (real/ + testingss/)
uv run python -m app.pipeline.bench --dataset eval/dataset/testingss --groups g10,g16 --misses   # any labels dir
uv run ruff check app tests && uv run mypy app/pipeline app/api/extract.py app/config app/settings.py app/logging.py
```
