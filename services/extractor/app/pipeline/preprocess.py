"""Turn a native-resolution strip into a clean OCR input: dark text on white, upscaled, padded.

Profiles (layout.yaml `preprocess.profiles`):
  dark          white/grey text on near-black (slot list cards, results left panel)  -> min(B,G,R)
  gold          white text on the gold/bronze gradient (results right panel)        -> min(B,G,R): gold has a
                low blue channel, white text has all channels high, so min() separates them cleanly
  digits_colour coloured slot digits (purple/red/green/orange/teal ...) on dark      -> HSV value = max(B,G,R)
  finishes      grey "N finishes" on dark or bronze                                   -> min(B,G,R)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np
from numpy.typing import NDArray

from app.pipeline.detect import Image

Gray = NDArray[np.uint8]


@dataclass
class Prepared:
    image: Image | None  # BGR uint8 for the recogniser, None when the strip is empty
    ink_box: tuple[int, int, int, int] | None  # tightened text box inside the strip (x0, y0, x1, y1)
    ink_pixels: int


def ink_channel(img: Image, profile: str) -> Gray:
    """Single channel where text is bright, background dark."""
    if profile == "digits_colour":
        return np.asarray(img.max(axis=2), dtype=np.uint8)
    return np.asarray(img.min(axis=2), dtype=np.uint8)


def _runs(flags: NDArray[np.bool_], max_gap: int) -> list[tuple[int, int]]:
    """Runs of True, merging runs separated by <= max_gap False entries. Half-open."""
    idx = np.flatnonzero(flags)
    if idx.size == 0:
        return []
    runs: list[tuple[int, int]] = []
    start = prev = int(idx[0])
    for i in idx[1:].tolist():
        if i - prev - 1 > max_gap:
            runs.append((start, prev + 1))
            start = i
        prev = i
    runs.append((start, prev + 1))
    return runs


def tighten(
    ink: Gray,
    ink_min: int,
    cfg: dict[str, Any],
    min_height_frac: float | None = None,
) -> tuple[int, int, int, int] | None:
    """Bounding box of the main text line inside a strip, or None when the strip holds no text."""
    mask = ink >= ink_min
    total = int(mask.sum())
    h, w = mask.shape
    if total < int(cfg["min_text_pixels"]) or h == 0 or w == 0:
        return None
    # vertical: the row run carrying the most ink (accents above capitals are merged via the gap allowance)
    row_counts = mask.sum(axis=1)
    rruns = _runs(row_counts >= int(cfg["ink_col_min"]), max_gap=max(1, round(cfg["row_gap_frac"] * h)))
    y0, y1 = max(rruns, key=lambda r: int(row_counts[r[0] : r[1]].sum()))
    mh = cfg["min_text_height_frac"] if min_height_frac is None else min_height_frac
    if (y1 - y0) < mh * h:
        return None
    # horizontal: group ink columns; drop stray blobs separated from the main group by a large gap
    col_counts = mask[y0:y1].sum(axis=0)
    gap = max(1, round(cfg["min_ink_cluster_gap_frac"] * (y1 - y0)))
    cruns = _runs(col_counts >= int(cfg["ink_col_min"]), max_gap=gap)
    if not cruns:
        return None
    x0, x1 = max(cruns, key=lambda r: int(col_counts[r[0] : r[1]].sum()))
    if int(mask[y0:y1, x0:x1].sum()) < int(cfg["min_text_pixels"]):
        return None
    return x0, y0, x1, y1


def _pad_box(box: tuple[int, int, int, int], shape: tuple[int, ...], pad: int) -> tuple[int, int, int, int]:
    x0, y0, x1, y1 = box
    h, w = shape[:2]
    return max(0, x0 - pad), max(0, y0 - pad), min(w, x1 + pad), min(h, y1 + pad)


def to_ocr_image(
    strip_img: Image, ink: Gray, box: tuple[int, int, int, int], layout: dict[str, Any], prof: dict[str, Any]
) -> Image:
    """OCR input for a tightened text box.

    mode `raw`: the original colour pixels around the text (PaddleOCR's recognisers are trained on natural
                text crops; on these screenshots this measured far better than binarised input).
    mode `ink`: contrast-stretched ink channel, inverted to dark-on-white, with a white border.
    """
    pad = max(1, round(float(prof.get("pad_frac", layout["strips"]["pad_frac"])) * strip_img.shape[0]))
    x0, y0, x1, y1 = _pad_box(box, strip_img.shape, pad)
    scale = float(prof.get("scale", 1.0))
    if prof.get("mode", "raw") == "raw":
        crop = strip_img[y0:y1, x0:x1]
        if scale != 1.0:
            interp = cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA
            crop = np.asarray(cv2.resize(crop, None, fx=scale, fy=scale, interpolation=interp), np.uint8)
        return np.ascontiguousarray(crop)
    g = ink[y0:y1, x0:x1].astype(np.float32)
    if g.size:
        lo, hi = float(np.percentile(g, 2)), float(np.percentile(g, 99.5))
        if hi - lo > 1:
            g = np.clip((g - lo) * (255.0 / (hi - lo)), 0, 255)
    inv: Any = (255 - g).astype(np.uint8)
    if scale != 1.0:
        inv = cv2.resize(inv, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    border = max(1, round(float(prof["border_frac"]) * inv.shape[0]))
    inv = cv2.copyMakeBorder(inv, border, border, border, border, cv2.BORDER_CONSTANT, value=255)
    return np.asarray(cv2.cvtColor(inv, cv2.COLOR_GRAY2BGR), np.uint8)


def ink_threshold(ink: Gray, prof: dict[str, Any]) -> int:
    """Fixed `ink_min`, or max(ink_min, Otsu) when the profile asks for `otsu` (dim slot digits)."""
    floor = int(prof["ink_min"])
    if not prof.get("otsu") or ink.size == 0:
        return floor
    t, _ = cv2.threshold(ink, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return max(floor, int(t))


def prepare(strip_img: Image, profile: str, layout: dict[str, Any], role: str = "name") -> Prepared:
    prof = layout["preprocess"]["profiles"][profile]
    ink = ink_channel(strip_img, profile)
    ink_min = ink_threshold(ink, prof)
    mh = layout["strips"].get("min_text_height_by_role", {}).get(role)
    box = tighten(ink, ink_min, layout["strips"], mh)
    if box is None:
        return Prepared(None, None, 0)
    x0, y0, x1, y1 = box
    n = int((ink[y0:y1, x0:x1] >= ink_min).sum())
    return Prepared(to_ocr_image(strip_img, ink, box, layout, prof), box, n)


def gold_ratio(strip_img: Image, layout: dict[str, Any]) -> float:
    """Share of gold pixels (used to recognise the rank-1 wings icon in the left panel)."""
    rp = layout["results"]["right_panel"]
    hsv = cv2.cvtColor(strip_img, cv2.COLOR_BGR2HSV)
    m = (
        (hsv[..., 0] >= rp["gold_hue_min"])
        & (hsv[..., 0] <= rp["gold_hue_max"])
        & (hsv[..., 1] >= rp["gold_sat_min"])
        & (hsv[..., 2] >= rp["gold_val_min"])
    )
    return float(m.mean()) if m.size else 0.0
