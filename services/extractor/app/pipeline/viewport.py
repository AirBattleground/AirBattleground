"""Stage 0: find the game viewport and normalise it.

Phones take full-screen screenshots, so the viewport is the whole image. On iPad, BGMI often runs in a
floating window: the game frame sits somewhere inside the screenshot, surrounded by the status bar, the dock,
other app windows and the wallpaper, at a varying position and scale.

The window is a large rounded rectangle with long, straight horizontal borders (wallpaper stripes are
diagonal, the dock and other windows have edges that do not pair up). Detection:
  1. horizontal-edge map (|I(y+d) - I(y-d)| on a blurred grey image)
  2. per row, the longest run of edge pixels (small gaps bridged) -> candidate border rows
  3. pair a top and a bottom candidate whose runs start/end at the same x (the window's width) and whose
     rectangle has a plausible game aspect; the largest such pair wins
  4. refine left/right with the vertical-edge profile near the run ends (rounded corners shorten runs)
If no window is found, the whole image is the viewport.

Normalisation: the viewport is cropped and resized so its *UI unit* equals `canonical_unit` px, where
UI unit = min(height, width * ui_ref_h / ui_ref_w) — BGMI scales its HUD with the limiting dimension of a
reference aspect, so after this step text and panels have (about) the same pixel size on every device.
All ratios live in layout.yaml `viewport:`.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from numpy.typing import NDArray

from app.pipeline.detect import Image, find_cards, find_gold_panel
from app.pipeline.geometry import Box, odd_kernel


@dataclass
class Viewport:
    box: Box  # game frame in original-image pixels
    method: str  # "window" | "full"
    scale: float  # resize factor applied to the crop (normalised = crop * scale)
    unit: float  # UI unit of the crop before scaling (px)


def ui_unit(w: int, h: int, cfg: dict[str, Any]) -> float:
    return float(min(h, w * cfg["ui_ref_h"] / cfg["ui_ref_w"]))


def _row_runs(edges: NDArray[np.bool_], max_gap: int, min_len: int) -> list[tuple[int, int, int]]:
    """(y, x0, x1) of the longest gap-bridged run per row, for rows whose run is >= min_len."""
    out: list[tuple[int, int, int]] = []
    for y in range(edges.shape[0]):
        xs = np.flatnonzero(edges[y])
        if xs.size < min_len // 3:
            continue
        best = (0, 0)
        start = prev = int(xs[0])
        for x in xs[1:].tolist():
            if x - prev > max_gap:
                if prev - start > best[1] - best[0]:
                    best = (start, prev)
                start = x
            prev = x
        if prev - start > best[1] - best[0]:
            best = (start, prev)
        if best[1] - best[0] >= min_len:
            out.append((y, best[0], best[1] + 1))
    return out


def _suppress(rows: list[tuple[int, int, int]], dist: int) -> list[tuple[int, int, int]]:
    """Keep the longest run among rows closer than `dist` (an edge spans a few rows)."""
    out: list[tuple[int, int, int]] = []
    for r in rows:
        if out and r[0] - out[-1][0] <= dist:
            if r[2] - r[1] > out[-1][2] - out[-1][1]:
                out[-1] = r
        else:
            out.append(r)
    return out


def find_window(img: Image, cfg: dict[str, Any]) -> Box | None:
    h, w = img.shape[:2]
    gray8 = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    k = odd_kernel(cfg["blur_frac"], h, 3)
    gray: NDArray[np.int16] = np.asarray(cv2.GaussianBlur(gray8, (k, k), 0), dtype=np.int16)
    d = max(1, round(cfg["edge_offset_frac"] * h))
    gy = np.zeros_like(gray)
    gy[d:-d] = np.abs(gray[2 * d :] - gray[: -2 * d])
    edges = gy >= int(cfg["edge_min"])
    rows = _suppress(
        _row_runs(edges, max(1, round(cfg["run_gap_frac"] * w)), round(cfg["min_run_frac"] * w)),
        max(1, round(cfg["nms_frac"] * h)),
    )
    tol = cfg["pair_tol_frac"] * w
    lo, hi = cfg["aspect"]
    best: tuple[float, Box] | None = None
    for i, (yt, a0, a1) in enumerate(rows):
        for yb, b0, b1 in rows[i + 1 :]:
            if yb - yt < cfg["min_height_frac"] * h:
                continue
            if abs(a0 - b0) > tol or abs(a1 - b1) > tol:
                continue
            x0, x1 = min(a0, b0), max(a1, b1)
            asp = (x1 - x0) / max(1, yb - yt)
            if not lo <= asp <= hi:
                continue
            area = float((x1 - x0) * (yb - yt))
            if best is None or area > best[0]:
                best = (area, Box(x0, yt, x1, yb))
    if best is None:
        return None
    box = _refine_sides(gray, best[1], cfg)
    if box.area >= cfg["full_frame_area"] * w * h:
        return None  # (almost) the whole screenshot: treat as full screen
    return box


def _refine_sides(gray: NDArray[np.int16], box: Box, cfg: dict[str, Any]) -> Box:
    """Snap left/right to the strongest vertical edge near the run ends (rounded corners shorten runs)."""
    h, w = gray.shape
    d = max(1, round(cfg["edge_offset_frac"] * h))
    gx = np.zeros_like(gray)
    gx[:, d:-d] = np.abs(gray[:, 2 * d :] - gray[:, : -2 * d])
    band = gx[box.y0 + box.h // 4 : box.y1 - box.h // 4]
    prof = (band >= int(cfg["edge_min"])).mean(axis=0)
    win = max(2, round(cfg["side_search_frac"] * w))

    def snap(x: int) -> int:
        a, b = max(0, x - win), min(w, x + win)
        if b <= a:
            return x
        i = int(np.argmax(prof[a:b]))
        return a + i if prof[a + i] >= cfg["side_min_fill"] else x

    return Box(snap(box.x0), box.y0, snap(box.x1), box.y1).clip(w, h)


def _contains(outer: Box, inner: Box, slack: int) -> bool:
    return (
        inner.x0 >= outer.x0 - slack
        and inner.y0 >= outer.y0 - slack
        and inner.x1 <= outer.x1 + slack
        and inner.y1 <= outer.y1 + slack
    )


def _anchor(img: Image, kind: str, layout: dict[str, Any]) -> tuple[Box, float] | None:
    """Scale-free content anchor: (bounding box, scale to canonical) from the gold results panel or the
    slot-list cards. The anchor is far more reliable for scale than the window size."""
    if kind == "results":
        found = find_gold_panel(img, layout["results"]["right_panel"])
        if found is None:
            return None
        panel, _ = found
        return panel, float(layout["viewport"]["canonical_gold_w"]) / max(1, panel.w)
    cards = find_cards(img, layout["slot_list"])
    if not cards:
        return None
    ws = sorted(b.w for b in cards)
    box = Box(
        min(b.x0 for b in cards), min(b.y0 for b in cards), max(b.x1 for b in cards), max(b.y1 for b in cards)
    )
    return box, float(layout["slot_list"]["cards"]["canonical_w"]) / ws[len(ws) // 2]


def normalise(img: Image, kind: str, layout: dict[str, Any]) -> tuple[Image, Viewport]:
    """Crop the game viewport and resize it so the HUD has its canonical pixel size."""
    cfg = layout["viewport"]
    h, w = img.shape[:2]
    win = find_window(img, cfg) if cfg.get("enabled", True) else None
    anchor = _anchor(img, kind, layout)
    slack = round(cfg["contain_slack_frac"] * w)
    if win is not None and anchor is not None and not _contains(win, anchor[0], slack):
        win = None  # the "window" does not hold the game content: wrong guess, use the whole image
    box, method = (win, "window") if win is not None else (Box(0, 0, w, h), "full")
    unit = ui_unit(box.w, box.h, cfg)
    if anchor is not None:
        scale = anchor[1]
        method += "+anchor"
    else:
        scale = float(cfg["canonical_unit"]) / unit if unit > 0 else 1.0
    crop = img[box.y0 : box.y1, box.x0 : box.x1]
    if abs(scale - 1.0) > cfg["scale_tolerance"]:
        interp = cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC
        crop = np.asarray(cv2.resize(crop, None, fx=scale, fy=scale, interpolation=interp), np.uint8)
    else:
        scale = 1.0
    return np.ascontiguousarray(crop, dtype=np.uint8), Viewport(box, method, scale, unit)


def draw_viewport(img: Image, vp: Viewport, path: Path) -> None:
    """Debug: the original screenshot with the detected game viewport."""
    out = img.copy()
    b = vp.box
    t = max(2, img.shape[0] // 300)
    cv2.rectangle(out, (b.x0, b.y0), (b.x1 - 1, b.y1 - 1), (0, 0, 255), t)
    label = f"viewport {vp.method} scale={vp.scale:.3f}"
    cv2.putText(out, label, (b.x0 + 8, b.y0 + 30), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 255), 2)
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), out)
