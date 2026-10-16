"""Cut text strips (slot / rank digits, name rows, finishes rows) out of detected regions.

All positions are fractions of the card/block box from layout.yaml; this module only does the arithmetic.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from app.pipeline.detect import Detection, Image, Region
from app.pipeline.geometry import Box

Role = Literal["slot", "rank", "name", "finishes", "icon"]


@dataclass
class Strip:
    role: Role
    region: int  # index into Detection.regions
    row: int  # name/finishes row (0-3); 0 for slot/rank/icon
    box: Box
    profile: str  # preprocess profile name
    image: Image  # native-resolution BGR crop


def _rows(region: Region, spec: dict[str, Any]) -> list[Box]:
    return [
        region.box.row_strip(spec["x0"], spec["x1"], c, spec["row_height"], region.ref_h)
        for c in spec["row_centers"]
    ]


def region_strip_boxes(det: Detection, layout: dict[str, Any]) -> list[tuple[Role, int, int, Box, str]]:
    """(role, region index, row, box, profile) for every strip, before cutting pixels."""
    out: list[tuple[Role, int, int, Box, str]] = []
    if det.kind == "slot_list":
        card = layout["slot_list"]["card"]
        prof = layout["slot_list"]["text"]["profile"]
        for i, r in enumerate(det.regions):
            out.append(("slot", i, 0, r.box.sub(card["slot"]), "digits_colour"))
            for j, b in enumerate(_rows(r, card["names"])):
                out.append(("name", i, j, b, prof))
        return out
    res = layout["results"]
    for i, r in enumerate(det.regions):
        spec = res["left_block"] if r.panel == "left" else res["right_block"]
        text_prof = "dark" if r.panel == "left" else "gold"
        rank_box = r.box.sub(spec["rank"])
        if r.panel == "left" and r.rank_hint == 1:
            out.append(("icon", i, 0, rank_box, text_prof))
        else:
            out.append(("rank", i, 0, rank_box, text_prof))
        for j, b in enumerate(_rows(r, spec["names"])):
            out.append(("name", i, j, b, text_prof))
        for j, b in enumerate(_rows(r, spec["finishes"])):
            out.append(("finishes", i, j, b, "finishes"))
    return out


def cut_strips(img: Image, det: Detection, layout: dict[str, Any]) -> list[Strip]:
    h, w = img.shape[:2]
    strips: list[Strip] = []
    for role, ri, row, box, prof in region_strip_boxes(det, layout):
        b = box.clip(w, h)
        if b.area == 0:
            continue
        strips.append(Strip(role, ri, row, b, prof, img[b.y0 : b.y1, b.x0 : b.x1].copy()))
    return strips
