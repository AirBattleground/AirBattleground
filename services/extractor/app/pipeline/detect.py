"""Find the cards (SLOT_LIST) and rank blocks (RESULTS) on a screenshot.

SLOT_LIST: up to 9 near-black cards on a lighter blurred map -> dark threshold + contours, row-major order.
           Falls back to the %-grid in layout.yaml when no plausible card is found.
RESULTS:   left panel (pinned): rank 1 (wings icon, no digit) above rank 2 -> layout ratios, top aligned
           with the right panel. Right panel (scrolls): gold blocks separated by dark lines -> gold mask
           row profile; blocks cut by the panel edge are dropped.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import cv2
import numpy as np
from numpy.typing import NDArray

from app.pipeline.geometry import Box, odd_kernel, to_px_x, to_px_y

Image = NDArray[np.uint8]
PARTIAL_NOTE = "ignored"  # prefix of the informational "dropped partial blocks" warning (not a review reason)
Panel = Literal["card", "left", "right"]


@dataclass
class Region:
    """A card (slot list) or a rank block (results)."""

    box: Box
    panel: Panel
    index: int  # order on screen (row-major for cards, top-down per panel for blocks)
    ref_h: int  # nominal height used for row positions (== box.h unless the block was cut)
    rank_hint: int | None = None  # rank implied by position (left panel)
    edge_cut: bool = False


@dataclass
class Detection:
    kind: str
    regions: list[Region]
    method: str
    warnings: list[str] = field(default_factory=list)
    panels: dict[str, Box] = field(default_factory=dict)


# ----------------------------------------------------------------------------------------------- slot list
def detect_slot_list(img: Image, layout: dict[str, Any]) -> Detection:
    cfg = layout["slot_list"]
    h, w = img.shape[:2]
    cards = _card_contours(img, cfg)
    grid = _grid_cards(img, cfg)
    warnings: list[str] = []
    method = "contours"
    if not cards or len(cards) < len(grid):
        if grid:
            if cards:
                warnings.append(
                    f"card detection found {len(cards)} cards, grid found {len(grid)}; using grid"
                )
            cards, method = grid, "grid"
        elif not cards:
            warnings.append("no slot cards found on the screenshot")
    cards = _row_major(cards, cfg["cards"]["row_tolerance_frac"] * h)[: int(cfg["max_cards"])]
    regions = [Region(box=b, panel="card", index=i, ref_h=b.h) for i, b in enumerate(cards)]
    return Detection(
        kind="slot_list", regions=regions, method=method, warnings=warnings, panels={"image": Box(0, 0, w, h)}
    )


def _dark_mask(img: Image, c: dict[str, Any]) -> Image:
    h = img.shape[0]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.medianBlur(gray, odd_kernel(c["median_blur_frac"], h, 3))
    mask = (gray < int(c["dark_max_gray"])).astype(np.uint8) * 255
    return mask


def _card_contours(img: Image, cfg: dict[str, Any]) -> list[Box]:
    c = cfg["cards"]
    h = img.shape[0]
    mask = _dark_mask(img, c)
    k = odd_kernel(c["open_kernel_frac"], h)
    mask = np.asarray(
        cv2.morphologyEx(mask, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k))), np.uint8
    )
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out: list[Box] = []
    for cnt in contours:
        x, y, bw, bh = cv2.boundingRect(cnt)
        if not (c["min_width_frac"] * h <= bw <= c["max_width_frac"] * h):
            continue
        if not (c["min_height_frac"] * h <= bh <= c["max_height_frac"] * h):
            continue
        # a card is a filled rectangle: its contour should cover most of its bounding box
        if cv2.contourArea(cnt) < c["min_fill"] * bw * bh:
            continue
        out.append(Box(x, y, x + bw, y + bh))
    return out


def _grid_cards(img: Image, cfg: dict[str, Any]) -> list[Box]:
    g = cfg["grid"]
    h, w = img.shape[:2]
    units = cfg["x_units"]
    mask = _dark_mask(img, cfg["cards"])
    out: list[Box] = []
    cw, ch = g["card_w"] * h, g["card_h"] * h
    for r in range(int(g["rows"])):
        for col in range(int(g["cols"])):
            x0 = to_px_x(g["x0"] + col * (g["card_w"] + g["gap_x"]), w, h, units)
            y0 = to_px_y(g["y0"] + r * (g["card_h"] + g["gap_y"]), h)
            b = Box(x0, y0, x0 + round(cw), y0 + round(ch)).clip(w, h)
            if b.area == 0:
                continue
            dark = float(mask[b.y0 : b.y1, b.x0 : b.x1].mean()) / 255.0
            if dark >= g["min_dark_ratio"]:
                out.append(b)
    return out


def _row_major(boxes: Sequence[Box], tol: float) -> list[Box]:
    rows: list[list[Box]] = []
    for b in sorted(boxes, key=lambda b: b.y0):
        if rows and abs(b.y0 - rows[-1][0].y0) <= tol:
            rows[-1].append(b)
        else:
            rows.append([b])
    return [b for row in rows for b in sorted(row, key=lambda b: b.x0)]


# ------------------------------------------------------------------------------------------------- results
def gold_mask(img: Image, rp: dict[str, Any]) -> Image:
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    hch, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    m = (
        (hch >= rp["gold_hue_min"])
        & (hch <= rp["gold_hue_max"])
        & (s >= rp["gold_sat_min"])
        & (v >= rp["gold_val_min"])
    )
    return m.astype(np.uint8)


def _runs(flags: NDArray[np.bool_]) -> list[tuple[int, int]]:
    """Contiguous True runs as half-open (start, end)."""
    out: list[tuple[int, int]] = []
    start: int | None = None
    for i, f in enumerate(flags.tolist()):
        if f and start is None:
            start = i
        elif not f and start is not None:
            out.append((start, i))
            start = None
    if start is not None:
        out.append((start, len(flags)))
    return out


def detect_results(img: Image, layout: dict[str, Any]) -> Detection:
    cfg = layout["results"]
    rp = cfg["right_panel"]
    h, w = img.shape[:2]
    units = cfg["x_units"]
    warnings: list[str] = []
    method = "gold-profile"

    s = rp["search"]
    sx0, sx1 = to_px_x(s["x0"], w, h, units), to_px_x(s["x1"], w, h, units)
    sy0, sy1 = to_px_y(s["y0"], h), to_px_y(s["y1"], h)
    search = Box(sx0, sy0, sx1, sy1).clip(w, h)
    gm = gold_mask(img, rp)[search.y0 : search.y1, search.x0 : search.x1]
    nominal = rp["block_height_frac"] * h

    panel: Box | None = None
    segments: list[tuple[int, int]] = []
    if gm.size:
        cols = _runs(gm.mean(axis=0) >= rp["col_fill_min"])
        if cols:
            c0, c1 = max(cols, key=lambda r: r[1] - r[0])
            if (c1 - c0) >= rp["min_width_frac"] * h:
                rows = _runs(gm[:, c0:c1].mean(axis=1) >= rp["row_fill_min"])
                if rows:
                    panel = Box(
                        search.x0 + c0, search.y0 + rows[0][0], search.x0 + c1, search.y0 + rows[-1][1]
                    )
                    segments = [(search.y0 + a, search.y0 + b) for a, b in rows]
    if panel is None:
        f = rp["fallback"]
        panel = Box(
            to_px_x(f["x0"], w, h, units),
            to_px_y(f["y0"], h),
            to_px_x(f["x1"], w, h, units),
            to_px_y(f["y1"], h),
        ).clip(w, h)
        method = "fallback"
        warnings.append("results right panel not found by colour; using layout fallback")
        n = int(rp["max_blocks"])
        step = nominal
        segments = [(round(panel.y0 + i * step), round(panel.y0 + (i + 1) * step)) for i in range(n)]
        segments = [sg for sg in segments if sg[1] <= panel.y1]

    # nominal block height: trust the measured full blocks when they agree with the layout
    heights = [b - a for a, b in segments]
    lo, hi = rp["nominal_agree"]
    if heights and lo * nominal <= max(heights) <= hi * nominal:
        nominal = float(max(heights))
    ref_h = round(nominal)
    edge = rp["edge_touch_frac"] * h

    regions: list[Region] = []
    # left panel: pinned rank 1 + rank 2
    lp = cfg["left_panel"]
    ly0 = panel.y0 if method != "fallback" else to_px_y(lp["y0"], h)
    lbox = Box(
        to_px_x(lp["x0"], w, h, units), ly0, to_px_x(lp["x1"], w, h, units), ly0 + to_px_y(lp["height"], h)
    ).clip(w, h)
    nb = int(lp["blocks"])
    for i in range(nb):
        y0 = lbox.y0 + round(i * lbox.h / nb)
        y1 = lbox.y0 + round((i + 1) * lbox.h / nb)
        lb = Box(lbox.x0, y0, lbox.x1, y1)
        regions.append(Region(box=lb, panel="left", index=i, ref_h=lb.h, rank_hint=i + 1))

    # right panel: complete blocks only. Only blocks touching the panel's top/bottom edge can be cut by the
    # scroll position; inner blocks are complete even when short (teams of 2-3 players have shorter blocks).
    dropped = 0
    ri = 0
    for a, b in segments:
        seg_h = b - a
        at_top = (a - panel.y0) <= edge
        at_bottom = (panel.y1 - b) <= edge
        at_edge = at_top or at_bottom
        if (at_edge and seg_h < rp["min_complete"] * nominal) or seg_h < rp["min_block_frac"] * nominal:
            dropped += 1
            continue
        cut = at_edge and seg_h < rp["cut_flag_ratio"] * nominal
        # a block cut at the top shows its lower part: position its rows from the bottom
        y0 = b - ref_h if (cut and at_top) else a
        box = Box(panel.x0, y0, panel.x1, y0 + ref_h).clip(w, h)
        regions.append(Region(box=box, panel="right", index=ri, ref_h=ref_h, edge_cut=cut))
        ri += 1
        if ri >= int(rp["max_blocks"]):
            break
    if dropped:
        warnings.append(f"{PARTIAL_NOTE} {dropped} partial rank block(s) cut off at the panel edge")
    return Detection(
        kind="results",
        regions=regions,
        method=method,
        warnings=warnings,
        panels={"left": lbox, "right": panel},
    )


def detect(img: Image, kind: str, layout: dict[str, Any]) -> Detection:
    if kind == "slot_list":
        return detect_slot_list(img, layout)
    if kind == "results":
        return detect_results(img, layout)
    raise ValueError(f"unknown kind {kind!r}")


# --------------------------------------------------------------------------------------------- debug image
_COLOURS: dict[str, tuple[int, int, int]] = {
    "card": (0, 200, 255),
    "left": (255, 160, 0),
    "right": (0, 255, 120),
    "slot": (255, 0, 255),
    "rank": (255, 0, 255),
    "name": (255, 255, 0),
    "finishes": (0, 140, 255),
}


def draw_overlay(img: Image, det: Detection, strips: Sequence[tuple[str, Box]], path: Path) -> None:
    """Write a debug overlay with every detected region and text strip."""
    out = img.copy()
    for r in det.regions:
        b = r.box
        cv2.rectangle(out, (b.x0, b.y0), (b.x1 - 1, b.y1 - 1), _COLOURS[r.panel], 2)
        label = f"{r.panel}{r.index}" + (" cut" if r.edge_cut else "")
        cv2.putText(out, label, (b.x0 + 2, b.y0 + 12), cv2.FONT_HERSHEY_SIMPLEX, 0.4, _COLOURS[r.panel], 1)
    for role, b in strips:
        cv2.rectangle(out, (b.x0, b.y0), (b.x1 - 1, b.y1 - 1), _COLOURS.get(role, (255, 255, 255)), 1)
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), out)
