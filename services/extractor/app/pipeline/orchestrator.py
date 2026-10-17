"""End-to-end extraction: bytes -> Extraction (app.schemas). Pure function, no HTTP.

    from app.pipeline.orchestrator import extract_image
    extraction = extract_image(image_bytes, "results", roster)   # roster: app.schemas.Roster | None

The active model bundle (`app.bundle.active_bundle()`) is consulted on every call:
  * bundle.rec_model_dir -> that recognition model reads the NAME strips (digits stay on the stock model)
  * bundle.layout        -> deep-merged over config/layout.yaml
  * bundle.char_fixes    -> applied to names after OCR
  * bundle.lexicon       -> fuzzy snapping like a roster (stricter threshold)
"""

from __future__ import annotations

import hashlib
import time
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, TypeVar

import cv2
import numpy as np

from app.bundle import ModelBundle, active_bundle
from app.config import load_layout
from app.logging import get_logger
from app.pipeline import postprocess as pp
from app.pipeline.crop import Strip, cut_strips
from app.pipeline.detect import PARTIAL_NOTE, Detection, Image, detect, draw_overlay
from app.pipeline.ocr_paddle import PaddleRecognizer, RecResult, get_recognizer
from app.pipeline.preprocess import Prepared, gold_ratio, prepare
from app.pipeline.roster import Match, Matcher
from app.pipeline.viewport import Viewport, draw_viewport, normalise
from app.schemas import Extraction, Kind, PlayerOut, ResultRowOut, Roster, TeamOut
from app.settings import Settings, get_settings

log = get_logger(__name__)
T = TypeVar("T")

# confidence assigned to values implied by screen position / neighbours rather than read
POSITIONAL_CONFIDENCE = 0.6
# finishes whose number was implied by the wording ("finishes" with the digit dropped) or inconsistent
IMPLIED_KILLS_FACTOR = 0.7


class ImageDecodeError(ValueError):
    """The bytes are not a decodable image."""


def decode_image(data: bytes) -> Image:
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None or img.size == 0:
        raise ImageDecodeError("could not decode image")
    return np.asarray(img, dtype=np.uint8)


def image_id_for(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]


@dataclass
class _Read:
    strip: Strip
    prep: Prepared
    text: str = ""
    score: float = 0.0
    source: str = "paddle"


@dataclass
class _Timer:
    timings: dict[str, float] = field(default_factory=dict)

    def run(self, name: str, fn: Callable[[], T]) -> T:
        t0 = time.perf_counter()
        try:
            return fn()
        finally:
            self.timings[name] = round((time.perf_counter() - t0) * 1000, 1)


def _recognizers(settings: Settings, bundle: ModelBundle) -> tuple[PaddleRecognizer, PaddleRecognizer]:
    """(names recogniser, digits recogniser)."""
    stock = get_recognizer(
        settings.ocr_rec_model, settings.ocr_rec_model_dir, settings.ocr_threads, settings.ocr_batch_size
    )
    if bundle.rec_model_dir is not None:
        if not bundle.rec_model_dir.exists():
            _bad_bundle_model(bundle, "rec_model_dir does not exist")
            return stock, stock
        try:
            names = get_recognizer(
                settings.ocr_rec_model, bundle.rec_model_dir, settings.ocr_threads, settings.ocr_batch_size
            )
        except Exception as e:  # a broken trained model must not take extraction down
            _bad_bundle_model(bundle, f"{type(e).__name__}: {e}")
            return stock, stock
        return names, stock
    return stock, stock


_warned_bundles: set[str] = set()


def _bad_bundle_model(bundle: ModelBundle, why: str) -> None:
    if bundle.version not in _warned_bundles:
        _warned_bundles.add(bundle.version)
        log.error(
            "bundle_rec_model_unusable", version=bundle.version, path=str(bundle.rec_model_dir), error=why
        )


def warmup() -> None:
    """Load the OCR models (startup)."""
    s = get_settings()
    names, digits = _recognizers(s, active_bundle())
    blank = np.full((48, 96, 3), 255, dtype=np.uint8)
    names.recognize([blank])
    digits.recognize([blank])


def _ocr(reads: list[_Read], settings: Settings, bundle: ModelBundle, warnings: list[str]) -> None:
    names_rec, digits_rec = _recognizers(settings, bundle)
    name_reads = [r for r in reads if r.strip.role == "name" and r.prep.image is not None]
    digit_reads = [
        r for r in reads if r.strip.role in ("slot", "rank", "finishes") and r.prep.image is not None
    ]
    if names_rec is digits_rec:
        allr = name_reads + digit_reads
        for r, res in zip(
            allr, names_rec.recognize([r.prep.image for r in allr if r.prep.image is not None]), strict=True
        ):
            r.text, r.score = res.text, res.score
    else:
        for group, rec in ((name_reads, names_rec), (digit_reads, digits_rec)):
            for r, res in zip(
                group, rec.recognize([r.prep.image for r in group if r.prep.image is not None]), strict=True
            ):
                r.text, r.score = res.text, res.score
    # second opinion for low-confidence names (e.g. Devanagari): keep it only if clearly more confident
    low = [r for r in name_reads if r.score < settings.ocr_alt_below]
    for alt in settings.ocr_alt_rec_models if low else ():
        try:
            rec = get_recognizer(alt, None, settings.ocr_threads, settings.ocr_batch_size)
            results: list[RecResult] = rec.recognize([r.prep.image for r in low if r.prep.image is not None])
        except Exception as e:  # missing alt model must not break extraction
            warnings.append(f"alternate OCR model {alt} unavailable")
            log.warning("alt_model_failed", model=alt, error=str(e))
            continue
        for r, res in zip(low, results, strict=True):
            if res.text.strip() and res.score > r.score + settings.ocr_alt_margin:
                r.text, r.score, r.source = res.text, res.score, f"paddle:{alt}"
    if settings.vlm_enabled:
        from app.pipeline.ocr_vlm import VlmClient

        client = VlmClient(settings.ollama_url, settings.vlm_model, settings.vlm_timeout_s)
        for r in name_reads:
            if r.score < settings.low_confidence and r.prep.image is not None:
                v = client.read(r.strip.image)
                if v and v.text:
                    r.text, r.score, r.source = v.text, max(r.score, v.score), "vlm"


def _player(text: str, score: float, source: str, m: Match | None) -> PlayerOut:
    if m is None:
        conf = score
    elif m.by_elimination:  # a guess from the lineup, not a reading: always surface it for review
        conf = min(score, POSITIONAL_CONFIDENCE)
    else:
        conf = max(score, min(1.0, m.score / 100.0))
    return PlayerOut(
        name=text,
        confidence=round(conf, 4),
        source=source,
        roster_match=m.name if m else None,
        matched_slot=m.slot if m else None,
    )


def _fill_sequence(values: list[int | None], step_ok: Callable[[int, int], bool]) -> list[int | None]:
    """Infer a missing number from its neighbours when they pin it down (prev + 1 == next - 1)."""
    out = list(values)
    for i, v in enumerate(out):
        if v is None and 0 < i < len(out) - 1:
            a, b = out[i - 1], out[i + 1]
            if a is not None and b is not None and b - a == 2 and step_ok(a, b):
                out[i] = a + 1
    return out


def extract_image(
    image_bytes: bytes, kind: Kind, roster: Roster | None = None, image_id: str | None = None
) -> Extraction:
    """Read one screenshot. Raises ImageDecodeError for undecodable bytes; never raises for a hard image
    (returns an Extraction with warnings and needs_review=True instead).

    kind:   "slot_list" (lobby cards: slot + names) or "results" (rank blocks: rank + names + finishes)
    roster: optional known lineup (slot -> player names); improves names and gives results rows a slot
    """
    settings = get_settings()
    bundle = active_bundle()
    timer = _Timer()
    t_all = time.perf_counter()
    warnings: list[str] = []
    layout = load_layout(settings.layout_path, bundle.layout)
    raw = timer.run("decode", lambda: decode_image(image_bytes))
    img, vp = timer.run("viewport", lambda: normalise(raw, kind, layout))
    iid = image_id or image_id_for(image_bytes)

    det: Detection = timer.run("detect", lambda: detect(img, kind, layout))
    warnings.extend(det.warnings)

    def _crop() -> list[_Read]:
        strips = cut_strips(img, det, layout)
        return [_Read(s, prepare(s.image, s.profile, layout, s.role)) for s in strips]

    reads = timer.run("crop", _crop)
    timer.run("ocr", lambda: _ocr(reads, settings, bundle, warnings))
    matcher = Matcher(roster, bundle.lexicon, layout["roster"])

    pcfg = layout["postprocess"]

    def clean(r: _Read) -> str:
        s = pp.clean_name(
            r.text,
            pcfg["edge_noise"],
            int(pcfg["max_name_len"]),
            pcfg.get("char_map") or {},
            str(pcfg.get("spaced_separators", "")),
        )
        s = pp.apply_char_fixes(s, bundle.char_fixes)
        return s if len(s) >= int(pcfg["min_name_len"]) else ""

    by_region: dict[int, list[_Read]] = {}
    for r in reads:
        by_region.setdefault(r.strip.region, []).append(r)

    def _post() -> Extraction:
        if kind == "slot_list":
            return _slot_list(det, by_region, clean, matcher, warnings, iid, bundle, layout)
        return _results(det, by_region, clean, matcher, warnings, iid, bundle, layout)

    ex = timer.run("postprocess", _post)
    if settings.debug_crops:
        _write_debug(raw, vp, img, det, reads, iid, kind, settings)
    timer.timings["total"] = round((time.perf_counter() - t_all) * 1000, 1)
    ex.timings_ms = timer.timings
    low = settings.low_confidence
    names_low = any(p.confidence < low for t in ex.teams for p in t.players) or any(
        p.confidence < low for row in ex.rows for p in row.players
    )
    ex.needs_review = bool(
        any(not w.startswith(PARTIAL_NOTE) for w in ex.warnings)
        or names_low
        or any(t.slot is None or t.slot_confidence < low for t in ex.teams)
        or any(r.rank is None or r.rank_confidence < low for r in ex.rows)
        or any(p.kills is None for r in ex.rows for p in r.players)
        or (not ex.teams and not ex.rows)
    )
    log.info(
        "extracted",
        image_id=iid,
        kind=kind,
        model_version=bundle.version,
        teams=len(ex.teams),
        rows=len(ex.rows),
        needs_review=ex.needs_review,
        ms=timer.timings["total"],
    )
    return ex


def _slot_list(
    det: Detection,
    by_region: dict[int, list[_Read]],
    clean: Callable[[_Read], str],
    matcher: Matcher,
    warnings: list[str],
    iid: str,
    bundle: ModelBundle,
    layout: dict[str, Any],
) -> Extraction:
    max_slot = int(layout["slot_list"]["max_slot"])
    slots: list[int | None] = []
    slot_conf: list[float] = []
    for i in range(len(det.regions)):
        sr = next((r for r in by_region.get(i, []) if r.strip.role == "slot"), None)
        v = pp.parse_int(sr.text, 1, max_slot) if sr else None
        slots.append(v)
        slot_conf.append(sr.score if (sr and v is not None) else 0.0)
    filled = _fill_sequence(slots, lambda a, b: True)
    teams: list[TeamOut] = []
    for i, _region in enumerate(det.regions):
        if slots[i] is None and filled[i] is not None:
            slot_conf[i] = POSITIONAL_CONFIDENCE
            warnings.append(f"slot of card {i + 1} inferred as {filled[i]} from its neighbours")
        elif filled[i] is None:
            warnings.append(f"could not read the slot number of card {i + 1}")
        names = sorted((r for r in by_region.get(i, []) if r.strip.role == "name"), key=lambda r: r.strip.row)
        texts = [clean(r) if r.prep.image is not None else "" for r in names]
        matches, _ = matcher.match_group(texts, filled[i]) if any(texts) else ([None] * len(texts), None)
        players = [
            _player(t, r.score, r.source, m) for t, r, m in zip(texts, names, matches, strict=True) if t
        ]
        teams.append(TeamOut(slot=filled[i], slot_confidence=round(slot_conf[i], 4), players=players))
    known = [t.slot for t in teams if t.slot is not None]
    if len(known) != len(set(known)):
        warnings.append("the same slot number was read on more than one card")
    if known != sorted(known):
        warnings.append("slot numbers are not in screen order; check the slot numbers")
    return Extraction(
        image_id=iid,
        kind="slot_list",
        model_version=bundle.version,
        teams=teams,
        needs_review=True,
        warnings=warnings,
    )


def _results(
    det: Detection,
    by_region: dict[int, list[_Read]],
    clean: Callable[[_Read], str],
    matcher: Matcher,
    warnings: list[str],
    iid: str,
    bundle: ModelBundle,
    layout: dict[str, Any],
) -> Extraction:
    res = layout["results"]
    max_rank = int(res["max_rank"])
    ranks: list[int | None] = []
    rconf: list[float] = []
    for i, region in enumerate(det.regions):
        rs = by_region.get(i, [])
        if region.panel == "left" and region.rank_hint == 1:
            icon = next((r for r in rs if r.strip.role == "icon"), None)
            ratio = gold_ratio(icon.strip.image, layout) if icon else 0.0
            ok = ratio >= float(res["left_block"]["wings_min_gold_ratio"])
            if not ok:
                warnings.append("rank 1 wings icon not found; assuming the first left block is rank 1")
            ranks.append(1)
            rconf.append(1.0 if ok else POSITIONAL_CONFIDENCE)
            continue
        rr = next((r for r in rs if r.strip.role == "rank"), None)
        v = pp.parse_int(rr.text, 1, max_rank) if rr else None
        if region.panel == "left" and region.rank_hint is not None and v != region.rank_hint:
            if v is not None:
                warnings.append(f"left panel rank read as {v}, expected {region.rank_hint}")
            ranks.append(region.rank_hint)
            rconf.append(POSITIONAL_CONFIDENCE)
            continue
        ranks.append(v)
        rconf.append(rr.score if (rr and v is not None) else 0.0)
    # right panel ranks are consecutive top-down and never 1-2 (pinned left): rank_j = offset + j. The offset
    # most blocks agree on wins; blocks that disagree (cut digits, misreads) or were unreadable take it.
    right_idx = [i for i, r in enumerate(det.regions) if r.panel == "right"]
    pinned = int(res["left_panel"]["blocks"])
    offsets: Counter[int] = Counter()
    for j, i in enumerate(right_idx):
        rv_i = ranks[i]
        if rv_i is not None and rv_i > pinned:
            offsets[rv_i - j] += 1
    consensus: int | None = None
    if offsets:
        (top, n), *rest = offsets.most_common()
        if n >= 2 or (len(offsets) == 1 and not rest):
            consensus = top
    for j, i in enumerate(right_idx):
        read = ranks[i]
        if consensus is not None and read != consensus + j:
            ranks[i] = consensus + j
            rconf[i] = POSITIONAL_CONFIDENCE
            what = "unreadable" if read is None else f"read as {read}"
            warnings.append(f"rank of block {j + 1} {what}; set to {ranks[i]} from its neighbours")
        elif read is not None and read <= pinned:
            ranks[i] = None
            rconf[i] = 0.0
            warnings.append(f"could not read the rank of right-panel block {j + 1}")
        elif read is None:
            warnings.append(f"could not read the rank of right-panel block {j + 1}")
    if any(det.regions[i].edge_cut for i in right_idx):
        warnings.append("a rank block touches the panel edge; check its last player")

    rows: list[ResultRowOut] = []
    for i, _region in enumerate(det.regions):
        rs = by_region.get(i, [])
        names = sorted((r for r in rs if r.strip.role == "name"), key=lambda r: r.strip.row)
        fins = {r.strip.row: r for r in rs if r.strip.role == "finishes"}
        texts = [clean(r) if r.prep.image is not None else "" for r in names]
        matches, inferred = (
            matcher.match_group(texts, None)
            if matcher.has_roster or matcher.lexicon
            else ([None] * len(texts), None)
        )
        players: list[PlayerOut] = []
        for t, r, m in zip(texts, names, matches, strict=True):
            f = fins.get(r.strip.row)
            k = pp.parse_finishes(f.text) if f and f.prep.image is not None else None
            if not t:
                if k is None:
                    continue  # empty row (team with fewer players)
                # a player whose name renders blank (e.g. Hangul filler) still has finishes that count
                p = PlayerOut(name="", confidence=0.0, source=r.source)
                warnings.append(f"a player of rank {ranks[i]} has a blank name; enter it by hand")
            else:
                p = _player(t, r.score, r.source, m)
            if k is not None and f is not None:
                p.kills = k
                ok = pp.finishes_consistent(f.text, k) and pp.finishes_digit_read(f.text)
                p.kills_confidence = round(f.score * (1.0 if ok else IMPLIED_KILLS_FACTOR), 4)
            else:
                p.kills_confidence = 0.0
                warnings.append(f"could not read finishes for {t!r}")
            players.append(p)
        rows.append(
            ResultRowOut(
                rank=ranks[i], rank_confidence=round(rconf[i], 4), players=players, inferred_slot=inferred
            )
        )
    # pinned rank 1/2 + scrolled ranks: never two rows with the same rank in one screenshot
    seen = [r.rank for r in rows if r.rank is not None]
    if len(seen) != len(set(seen)):
        warnings.append("the same rank was read twice on this screenshot")
    return Extraction(
        image_id=iid,
        kind="results",
        model_version=bundle.version,
        rows=rows,
        needs_review=True,
        warnings=warnings,
    )


def _write_debug(
    raw: Image,
    vp: Viewport,
    img: Image,
    det: Detection,
    reads: list[_Read],
    iid: str,
    kind: str,
    settings: Settings,
) -> None:
    try:
        d = settings.debug_dir / f"{iid}-{kind}"
        d.mkdir(parents=True, exist_ok=True)
        draw_overlay(img, det, [(r.strip.role, r.strip.box) for r in reads], d / "overlay.png")
        draw_viewport(raw, vp, d / "viewport.png")
        for r in reads:
            if r.prep.image is not None:
                name = f"r{r.strip.region}-{r.strip.role}{r.strip.row}.png"
                cv2.imwrite(str(d / name), r.prep.image)
        lines = [f"{r.strip.region}\t{r.strip.role}\t{r.strip.row}\t{r.score:.3f}\t{r.text}" for r in reads]
        (d / "reads.tsv").write_text("\n".join(lines), encoding="utf-8")
    except OSError as e:
        log.warning("debug_write_failed", error=str(e))
