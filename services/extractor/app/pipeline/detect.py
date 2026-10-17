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

from app.pipeline.geometry import Box, odd_kernel

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
    visible: tuple[int, int] | None = None  # y-range actually shown (rows outside it are not read)


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


def find_cards(img: Image, cfg: dict[str, Any]) -> list[Box]:
    """Dark filled rectangles with the card aspect, then the largest group of similar width (scale-free:
    works on any resolution / window size before normalisation)."""
    c = cfg["cards"]
    h, w = img.shape[:2]
    mask = _dark_mask(img, c)
    k = odd_kernel(c["open_kernel_frac"], h)
    mask = np.asarray(
        cv2.morphologyEx(mask, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k))), np.uint8
    )
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cands: list[Box] = []
    lo, hi = c["aspect"]
    for cnt in contours:
        x, y, bw, bh = cv2.boundingRect(cnt)
        if bw < c["min_width_frac_w"] * w or bh == 0 or not lo <= bw / bh <= hi:
            continue
        # a card is a filled rectangle: its contour should cover most of its bounding box
        if cv2.contourArea(cnt) < c["min_fill"] * bw * bh:
            continue
        cands.append(Box(x, y, x + bw, y + bh))
    if not cands:
        return []
    tol = float(c["cluster_tol"])
    best: list[Box] = []
    for ref in cands:
        group = [b for b in cands if abs(b.w - ref.w) <= tol * ref.w and abs(b.h - ref.h) <= tol * ref.h]
        if len(group) > len(best):
            best = group
    return best


def _card_contours(img: Image, cfg: dict[str, Any]) -> list[Box]:
    """Cards on a normalised image: the scale-free finder plus the canonical size check."""
    c = cfg["cards"]
    cw, ch = float(c["canonical_w"]), float(c["canonical_h"])
    tol = float(c["canonical_tol"])
    return [b for b in find_cards(img, cfg) if abs(b.w - cw) <= tol * cw and abs(b.h - ch) <= tol * ch]


def _grid_cards(img: Image, cfg: dict[str, Any]) -> list[Box]:
    g = cfg["grid"]
    h, w = img.shape[:2]
    mask = _dark_mask(img, cfg["cards"])
    out: list[Box] = []
    unit = float(layout_unit(cfg))
    cw, ch = g["card_w"] * unit, g["card_h"] * unit
    for r in range(int(g["rows"])):
        for col in range(int(g["cols"])):
            x0 = round(w / 2 + (g["x0"] + col * (g["card_w"] + g["gap_x"])) * unit)
            y0 = round(h / 2 + (g["y0"] + r * (g["card_h"] + g["gap_y"])) * unit)
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


def layout_unit(cfg: dict[str, Any]) -> float:
    """Pixel size of one layout unit on a normalised image (the canonical UI unit)."""
    return float(cfg.get("unit_px", 720))


def find_gold_panel(img: Image, rp: dict[str, Any]) -> tuple[Box, list[tuple[int, int]]] | None:
    """The results right panel: the widest run of columns that are mostly gold, then its gold row runs.
    Scale-free (works before normalisation). Returns (panel box, [(y0, y1) per gold row run])."""
    h, w = img.shape[:2]
    gm = gold_mask(img, rp)
    counts = gm.sum(axis=0).astype(np.float64)
    if counts.max() <= 0:
        return None
    cols = _runs(counts >= rp["col_peak_frac"] * counts.max())
    if not cols:
        return None
    c0, c1 = max(cols, key=lambda r: float(counts[r[0] : r[1]].sum()))
    if (c1 - c0) < rp["min_width_frac_w"] * w:
        return None
    rows = _runs(gm[:, c0:c1].mean(axis=1) >= rp["row_fill_min"])
    rows = [r for r in rows if r[1] - r[0] >= rp["min_run_frac"] * (c1 - c0)]
    if not rows:
        return None
    return Box(c0, rows[0][0], c1, rows[-1][1]), rows


def _digit_centred(
    img: Image, panel: Box, a: int, b: int, gw: float, nominal: float, cfg: dict[str, Any]
) -> bool:
    """True when the white rank digit's vertical centre sits in the middle of the gold run [a, b)."""
    spec = cfg["right_block"]["rank"]
    x0, x1 = round(panel.x0 + spec["x0"] * gw), round(panel.x0 + spec["x1"] * gw)
    roi = img[a:b, x0:x1]
    if roi.size == 0:
        return False
    ink = roi.min(axis=2) >= int(cfg["right_panel"]["digit_ink_min"])
    rows = np.flatnonzero(ink.sum(axis=1) >= 1)
    if rows.size < cfg["right_panel"]["digit_min_rows"] * nominal:
        return False
    centre = (rows[0] + rows[-1]) / 2
    return bool(abs(centre - (b - a) / 2) <= cfg["right_panel"]["digit_centre_tol"] * nominal)


def detect_results(img: Image, layout: dict[str, Any]) -> Detection:
    """Expects a normalised image (viewport.normalise): the gold panel is ~canonical width."""
    cfg = layout["results"]
    rp = cfg["right_panel"]
    h, w = img.shape[:2]
    warnings: list[str] = []
    method = "gold-profile"
    unit = layout_unit(cfg)

    found = find_gold_panel(img, rp)
    if found is not None:
        panel, segments = found
        gw = float(panel.w)
    else:
        f = rp["fallback"]
        panel = Box(
            round(w / 2 + f["x0"] * unit),
            round(h / 2 + f["y0"] * unit),
            round(w / 2 + f["x1"] * unit),
            round(h / 2 + f["y1"] * unit),
        ).clip(w, h)
        gw = float(panel.w)
        method = "fallback"
        warnings.append("results right panel not found by colour; using layout fallback")
        step = rp["block_height"] * gw
        n = int(rp["max_blocks"])
        segments = [(round(panel.y0 + i * step), round(panel.y0 + (i + 1) * step)) for i in range(n)]
        segments = [sg for sg in segments if sg[1] <= panel.y1]

    nominal = rp["block_height"] * gw  # everything in the results layout scales with the panel width
    heights = [b - a for a, b in segments]
    lo, hi = rp["nominal_agree"]
    if heights and lo * nominal <= max(heights) <= hi * nominal:
        nominal = float(max(heights))
    ref_h = round(nominal)
    edge = rp["edge_touch"] * gw

    regions: list[Region] = []
    # left panel: pinned rank 1 + rank 2, placed relative to the gold panel
    lp = cfg["left_panel"]
    lbox = Box(
        round(panel.x0 + lp["x0"] * gw),
        panel.y0,
        round(panel.x0 + lp["x1"] * gw),
        round(panel.y0 + lp["height"] * gw),
    ).clip(w, h)
    nb = int(lp["blocks"])
    for i in range(nb):
        y0 = lbox.y0 + round(i * lbox.h / nb)
        y1 = lbox.y0 + round((i + 1) * lbox.h / nb)
        lb = Box(lbox.x0, y0, lbox.x1, y1)
        regions.append(Region(box=lb, panel="left", index=i, ref_h=lb.h, rank_hint=i + 1))

    # right panel: complete blocks only. Only blocks touching the panel's top/bottom edge can be cut by the
    # scroll position; inner blocks are complete even when short (teams of 1-3 players have shorter blocks).
    dropped = 0
    ri = 0
    for a, b in segments:
        seg_h = b - a
        at_top = (a - panel.y0) <= edge
        at_bottom = (panel.y1 - b) <= edge
        at_edge = at_top or at_bottom
        # top edge: the upper rows (names) are gone -> need nearly the whole block; bottom edge: a block with
        # fewer players is shorter, so keep it and read only the rows that are fully visible
        need = rp["min_complete"] if at_top else rp["bottom_min_keep"] if at_bottom else rp["min_block_frac"]
        if seg_h < need * nominal or seg_h < rp["min_block_frac"] * nominal:
            dropped += 1
            continue
        short = at_edge and seg_h < rp["cut_flag_ratio"] * nominal
        # a short block at the panel edge is either cut by the scroll position or a complete block of a team
        # with fewer players. The rank digit is centred in a complete block -> tell them apart by it.
        cut = short and not _digit_centred(img, panel, a, b, gw, nominal, cfg)
        # a block cut at the top shows its lower part: position its rows from the bottom
        y0 = b - ref_h if (cut and at_top) else a
        box = Box(panel.x0, y0, panel.x1, y0 + ref_h).clip(w, h)
        regions.append(Region(box=box, panel="right", index=ri, ref_h=ref_h, edge_cut=cut, visible=(a, b)))
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
