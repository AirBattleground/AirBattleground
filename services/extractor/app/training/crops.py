"""Cut labelled name strips out of screenshots (recognition fine-tune dataset).

Preferred source: the pipeline's own detection/crop functions (so training crops match inference crops).
Fallback: the reference geometry measured on the real 1600x720 screenshots (same numbers synth/ uses),
scaled by height and centred, plus detection of the gold result blocks via the bright left stripe.
Each crop is returned with its label; images whose structure doesn't match the labels are skipped (logged).
"""

from __future__ import annotations

import importlib
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

from app.training.samples import Sample, nfc

REF_W, REF_H = 1600, 720


@dataclass
class NameCrop:
    image: np.ndarray  # BGR
    label: str
    sample_id: str


def pipeline_strips(
    img: np.ndarray, kind: str, layout_overrides: dict[str, Any] | None = None
) -> list[list[np.ndarray]]:
    """Name strips per card/block using the pipeline's own detection + crop (training crops == inference
    crops). Results order: left panel (rank 1, 2) then right panel top-down, like the labels."""
    from app.config import load_layout
    from app.pipeline.crop import cut_strips
    from app.pipeline.detect import detect

    layout = load_layout(overrides=layout_overrides or {})
    det = detect(img, kind, layout)
    order = sorted(
        range(len(det.regions)), key=lambda i: (det.regions[i].panel == "right", det.regions[i].index)
    )
    by_region: dict[int, list[tuple[int, np.ndarray]]] = {i: [] for i in order}
    for st in cut_strips(img, det, layout):
        if st.role == "name":
            by_region[st.region].append((st.row, st.image))
    return [[im for _, im in sorted(by_region[i], key=lambda t: t[0])] for i in order]


def _pipeline_available() -> bool:
    try:
        importlib.import_module("app.pipeline.crop")
        importlib.import_module("app.pipeline.detect")
        importlib.import_module("app.config")
        return True
    except Exception:
        return False


class _Geo:
    def __init__(self, img: np.ndarray) -> None:
        h, w = img.shape[:2]
        self.s = min(w / REF_W, h / REF_H)
        self.ox = (w - REF_W * self.s) / 2
        self.oy = (h - REF_H * self.s) / 2
        self.img = img

    def crop(self, x0: float, y0: float, x1: float, y1: float) -> np.ndarray:
        h, w = self.img.shape[:2]
        a = (max(0, int(self.ox + x0 * self.s)), max(0, int(self.oy + y0 * self.s)))
        b = (min(w, int(self.ox + x1 * self.s)), min(h, int(self.oy + y1 * self.s)))
        return self.img[a[1] : b[1], a[0] : b[0]].copy()

    def _runs(self, mask: list[bool]) -> list[tuple[float, float]]:
        runs: list[tuple[float, float]] = []
        start = None
        for y, on in enumerate([*mask, False]):
            if on and start is None:
                start = y
            elif not on and start is not None:
                runs.append(((start - self.oy) / self.s, (y - self.oy) / self.s))
                start = None
        return runs

    def dark_cards(self, x_ref: float) -> list[tuple[float, float]]:
        """(top, bottom) of the dark slot-list cards in the column starting at reference x."""
        x = int(self.ox + (x_ref + 4) * self.s)
        gray = cv2.cvtColor(self.img, cv2.COLOR_BGR2GRAY)
        col = gray[:, x : x + max(2, int(8 * self.s))].mean(axis=1)
        return [(t, b) for t, b in self._runs(list(col < 22)) if b - t > 120]

    def gold_blocks(self) -> list[tuple[float, float]]:
        """(top, bottom) in reference coords of gold blocks on the right panel, via the yellow stripe."""
        x = int(self.ox + 841 * self.s)
        col = self.img[:, max(0, x - 1) : x + 2].astype(int).mean(axis=1)  # BGR
        b, g, r = col[:, 0], col[:, 1], col[:, 2]
        yellow = (r > 150) & (g > 110) & (b < 120) & (r - b > 80)
        return self._runs(list(yellow))


def geometry_strips(img: np.ndarray, kind: str, n_groups: int) -> list[list[np.ndarray]]:
    g = _Geo(img)
    out: list[list[np.ndarray]] = []
    if kind == "slot_list":
        cards = sorted(
            ((round(t / 50), x0, t) for x0 in (185, 573, 960) for t, _b in g.dark_cards(x0)),
        )  # row-major: rows bucketed by top, then x
        for _row, x0, y0 in cards[:n_groups]:
            out.append(
                [
                    g.crop(x0 + 52, y0 + 29 + j * 42.6 - 16, x0 + 262, y0 + 29 + j * 42.6 + 16)
                    for j in range(4)
                ]
            )
        return out
    for top in (177, 396):  # pinned rank 1 / rank 2
        out.append([g.crop(335, top + j * 40 - 17, 650, top + j * 40 + 17) for j in range(4)])
    for t, b in g.gold_blocks():
        # partial (cut by the scroll window) blocks are not labelled; 3-player blocks are ~148 px, 4 ~160
        cut = t < 134 or b > 626
        if b - t < 100 or (cut and b - t < 150):
            continue
        out.append([g.crop(950, t + 12 + j * 40 - 16, 1260, t + 12 + j * 40 + 16) for j in range(4)])
    return out


def name_crops(
    samples: list[Sample], log: Callable[[str], None] = print, layout_overrides: dict[str, Any] | None = None
) -> list[NameCrop]:
    use_pipeline = _pipeline_available()
    log(f"crops: using {'pipeline detect/cut_strips' if use_pipeline else 'reference geometry fallback'}")
    crops: list[NameCrop] = []
    for s in samples:
        img = cv2.imdecode(np.frombuffer(s.image_bytes(), np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            log(f"crops: {s.id}: unreadable image, skipped")
            continue
        if s.kind == "slot_list":
            groups = [[nfc(p) for p in t.get("players", [])] for t in s.labels.get("teams", [])]
        else:
            groups = [[nfc(p["name"]) for p in r.get("players", [])] for r in s.labels.get("rows", [])]
        strips: list[list[np.ndarray]] = []
        if use_pipeline:
            try:
                strips = pipeline_strips(img, s.kind, layout_overrides)
            except Exception as e:  # pipeline bug on one image: fall back rather than lose the sample
                log(f"crops: {s.id}: pipeline crop failed ({e}); using geometry fallback")
        if len(strips) != len(groups):
            if use_pipeline:
                log(
                    f"crops: {s.id}: pipeline found {len(strips)} blocks vs {len(groups)} labelled; "
                    "geometry fallback"
                )
            strips = geometry_strips(img, s.kind, len(groups))
        if len(strips) != len(groups):
            log(f"crops: {s.id}: {len(strips)} detected blocks vs {len(groups)} labelled — skipped")
            continue
        for names, gstrips in zip(groups, strips, strict=True):
            for name, strip in zip(names, gstrips, strict=False):
                if strip.size and strip.shape[0] > 8 and strip.shape[1] > 20:
                    crops.append(NameCrop(strip, name, s.id))
    return crops
