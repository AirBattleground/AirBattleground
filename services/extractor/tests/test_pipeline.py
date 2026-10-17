"""Fast unit tests for the screenshot pipeline (no OCR model needed)."""

from __future__ import annotations

from typing import Any

import cv2
import numpy as np
import pytest

from app.config import deep_merge, load_layout
from app.pipeline import postprocess as pp
from app.pipeline.crop import region_strip_boxes
from app.pipeline.detect import Detection, Region, detect_results, detect_slot_list
from app.pipeline.geometry import Box, odd_kernel, to_px_x, to_px_y
from app.pipeline.preprocess import ink_channel, prepare, tighten
from app.pipeline.roster import Matcher, canonical, score
from app.schemas import Roster, RosterSlot


@pytest.fixture(scope="module")
def layout() -> dict[str, Any]:
    return load_layout()


# ------------------------------------------------------------------ geometry / crop math
def test_box_sub_and_row_strip() -> None:
    b = Box(100, 50, 300, 250)  # 200 x 200
    assert b.sub({"x0": 0.1, "x1": 0.5, "y0": 0.25, "y1": 0.75}) == Box(120, 100, 200, 200)
    s = b.row_strip(0.0, 1.0, 0.5, 0.2)
    assert (s.y0, s.y1) == (130, 170)
    # cut blocks position rows with their nominal height, not the visible one
    assert b.row_strip(0.0, 1.0, 0.5, 0.2, ref_h=100).y0 == 90
    assert Box(-5, -5, 10, 10).clip(8, 8) == Box(0, 0, 8, 8)


def test_layout_units() -> None:
    # center_h: offsets from the horizontal centre in units of the height -> survives aspect changes
    assert to_px_x(0.0, 1600, 720, "center_h") == 800
    assert to_px_x(-0.5, 1280, 720, "center_h") == 280
    assert to_px_x(0.25, 1000, 500, "width") == 250
    assert to_px_y(0.5, 720) == 360
    assert odd_kernel(0.007, 720, 3) == 5
    assert odd_kernel(0.0001, 720, 3) == 3


def test_layout_merge_and_version(layout: dict[str, Any]) -> None:
    assert layout["layout_version"]
    merged = load_layout(overrides={"strips": {"pad_frac": 0.5}})
    assert merged["strips"]["pad_frac"] == 0.5
    assert merged["strips"]["min_text_pixels"] == layout["strips"]["min_text_pixels"]
    assert deep_merge({"a": {"b": 1, "c": 2}}, {"a": {"b": 3}}) == {"a": {"b": 3, "c": 2}}


def test_strip_boxes_slot_list(layout: dict[str, Any]) -> None:
    card = Box(0, 0, 400, 200)
    det = Detection("slot_list", [Region(card, "card", 0, 200)], "test")
    boxes = region_strip_boxes(det, layout)
    roles = [b[0] for b in boxes]
    assert roles == ["slot", "name", "name", "name", "name"]
    names = [b[3] for b in boxes if b[0] == "name"]
    assert all(card.x0 <= n.x0 < n.x1 <= card.x1 for n in names)
    assert [n.y0 for n in names] == sorted(n.y0 for n in names)  # top-down rows
    assert all(a.y1 <= b.y0 + 1 for a, b in zip(names, names[1:], strict=False))  # no overlap


def test_strip_boxes_results(layout: dict[str, Any]) -> None:
    det = Detection(
        "results",
        [
            Region(Box(0, 0, 600, 210), "left", 0, 210, rank_hint=1),
            Region(Box(0, 0, 540, 160), "right", 0, 160),
        ],
        "test",
    )
    boxes = region_strip_boxes(det, layout)
    left = [b[0] for b in boxes if b[1] == 0]
    right = [b[0] for b in boxes if b[1] == 1]
    assert left[0] == "icon" and right[0] == "rank"
    assert left.count("name") == 4 and left.count("finishes") == 4 and right.count("finishes") == 4
    # finishes strips sit to the right of the names
    rn = [b[3] for b in boxes if b[1] == 1 and b[0] == "name"]
    rf = [b[3] for b in boxes if b[1] == 1 and b[0] == "finishes"]
    assert all(f.x0 >= n.x1 for n, f in zip(rn, rf, strict=True))


# ------------------------------------------------------------------ detection on synthetic screens
def _slot_screen(n_cards: int) -> np.ndarray:
    img = np.full((720, 1600, 3), 35, np.uint8)  # blurred map grey
    xs, ys, w, h = (185, 573, 960), (86, 292, 498), 363, 188
    k = 0
    for y in ys:
        for x in xs:
            if k < n_cards:
                img[y : y + h, x : x + w] = 15
                cv2.putText(
                    img, "PLAYER", (x + 60, y + 40), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2
                )
            k += 1
    return img


def test_detect_slot_list_cards_row_major(layout: dict[str, Any]) -> None:
    det = detect_slot_list(_slot_screen(8), layout)
    assert det.method == "contours"
    assert len(det.regions) == 8
    tops = [r.box.y0 for r in det.regions]
    assert tops == sorted(tops)
    assert [r.box.x0 for r in det.regions[:3]] == sorted(r.box.x0 for r in det.regions[:3])


def test_detect_slot_list_grid_fallback(layout: dict[str, Any]) -> None:
    # cards merged into one dark slab -> contour sizes implausible -> grid fallback still finds 9 cells
    img = np.full((720, 1600, 3), 35, np.uint8)
    img[86:686, 185:1324] = 15
    det = detect_slot_list(img, layout)
    assert det.method == "grid"
    assert len(det.regions) == 9


def _results_screen(blocks: list[tuple[int, int]]) -> np.ndarray:
    img = np.full((720, 1600, 3), 5, np.uint8)
    for y0, y1 in blocks:
        img[y0:y1, 836:1380] = (44, 147, 180)  # BGR gold
    return img


def test_detect_results_drops_partial_blocks(layout: dict[str, Any]) -> None:
    img = _results_screen([(131, 140), (144, 304), (308, 468), (472, 628)])
    det = detect_results(img, layout)
    right = [r for r in det.regions if r.panel == "right"]
    left = [r for r in det.regions if r.panel == "left"]
    assert [r.box.y0 for r in right] == [144, 308, 472]
    assert [r.rank_hint for r in left] == [1, 2]
    assert any("partial" in w for w in det.warnings)


def test_detect_results_fallback_when_no_gold(layout: dict[str, Any]) -> None:
    det = detect_results(np.zeros((720, 1600, 3), np.uint8), layout)
    assert det.method == "fallback"
    assert sum(r.panel == "left" for r in det.regions) == 2


# ------------------------------------------------------------------ preprocessing
def test_ink_channel_separates_white_from_gold() -> None:
    img = np.zeros((10, 20, 3), np.uint8)
    img[:, :10] = (44, 147, 180)  # gold
    img[:, 10:] = (235, 235, 235)  # white text
    ink = ink_channel(img, "gold")
    assert ink[:, :10].max() < 60 and ink[:, 10:].min() > 200
    # coloured slot digits use the value channel
    img2 = np.zeros((4, 4, 3), np.uint8)
    img2[:] = (200, 40, 120)  # purple
    assert ink_channel(img2, "digits_colour").min() == 200


def test_tighten_finds_text_and_empty(layout: dict[str, Any]) -> None:
    ink = np.zeros((40, 200), np.uint8)
    assert tighten(ink, 110, layout["strips"]) is None
    ink[12:28, 30:90] = 230
    ink[0:3, 195:200] = 230  # stray blob far away at the edge (should not widen the box)
    box = tighten(ink, 110, layout["strips"])
    assert box is not None
    x0, y0, x1, y1 = box
    assert (x0, x1) == (30, 90) and 10 <= y0 <= 12 and 28 <= y1 <= 30


def test_prepare_raw_and_ink_modes(layout: dict[str, Any]) -> None:
    strip = np.full((36, 220, 3), 15, np.uint8)
    cv2.putText(strip, "AExJenu", (10, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
    p = prepare(strip, "dark", layout)
    assert p.image is not None and p.image.ndim == 3 and p.image.shape[0] <= 36
    ink_layout = deep_merge(layout, {"preprocess": {"profiles": {"dark": {"mode": "ink", "scale": 2.0}}}})
    q = prepare(strip, "dark", ink_layout)
    assert q.image is not None and q.image[0, 0].tolist() == [255, 255, 255]  # dark text on white
    assert prepare(np.full((36, 220, 3), 15, np.uint8), "dark", layout).image is None


# ------------------------------------------------------------------ postprocess
@pytest.mark.parametrize(
    ("raw", "value"),
    [
        ("5 finishes", 5),
        ("1 finish", 1),
        ("1finish", 1),
        ("I finish", 1),
        ("l finish", 1),
        ("1I finish", 1),  # singular wins
        ("0 finishes", 0),
        ("O finishes", 0),
        ("D finishes", 0),
        ("12 finishes", 12),
        (" finishes", 0),  # plural with the narrow "0" dropped
        ("I finishes", 0),  # "1" is never plural
        ("u tinisnes", 0),
        ("I inish", 1),
        ("1I fnish", 1),
        ("3 finishe", 3),
        ("2 finisshes", 2),
        ("B6 finishes", 6),
        ("", None),
        ("garbage", None),
        ("7", 7),
    ],
)
def test_parse_finishes(raw: str, value: int | None) -> None:
    assert pp.parse_finishes(raw) == value


def test_parse_int_and_consistency() -> None:
    assert pp.parse_int("05", 1, 99) == 5
    assert pp.parse_int("1 1", 1, 99) == 11
    assert pp.parse_int("I3", 1, 99) == 13
    assert pp.parse_int("", 1, 99) is None
    assert pp.parse_int("123", 1, 99) is None
    assert pp.finishes_consistent("1 finish", 1) and not pp.finishes_consistent("1 finishes", 1)


def test_clean_name_and_char_fixes() -> None:
    assert pp.clean_name("  |GExFireGod_ ", "|_", 24) == "GExFireGod"
    assert pp.clean_name("DCKARTIK'", "|_", 24) == "DCKARTIK'"  # apostrophe kept
    assert pp.clean_name("· Titann ·", "|_", 24) == "· Titann ·"
    assert pp.clean_name("Ā", "", 24) == "Ā"  # NFC
    fixes = {"0->O": {"context": "letters"}, "l->I": {"context": "start"}}
    assert pp.apply_char_fixes("G0D", fixes) == "GOD"
    assert pp.apply_char_fixes("MEGA03", fixes) == "MEGA03"  # 0 next to a digit: untouched
    assert pp.apply_char_fixes("lMxBroly", fixes) == "IMxBroly"
    assert pp.apply_char_fixes("x", {}) == "x"


# ------------------------------------------------------------------ roster matching
def _cfg(layout: dict[str, Any]) -> dict[str, Any]:
    return dict(layout["roster"])


ROSTER = Roster(
    slots=[
        RosterSlot(slot=7, players=["GExRuwad1O", "GExDeadPlaYeR", "GExMoOnGOD", "GExFireGod"]),
        RosterSlot(slot=21, players=["AIxTIXZO", "AIxKrAg", "AIxZeD", "AIxFlexy"]),
        RosterSlot(slot=18, players=["ʞeɯɹer2", "DCKARTIK'", "आशीष्", "Lobby×‿ Ja"]),
    ]
)


def test_canonical_collapses_lookalikes() -> None:
    assert canonical("GExRuwad10") == canonical("GExRuwad1O")
    assert canonical("AlxZe0") == canonical("AIxZeD")
    assert canonical("WRG|GHOST") == canonical("WRG | GHOST")
    assert score("abc", "abc", 0.5) == 100.0


def test_match_group_infers_slot_and_snaps(layout: dict[str, Any]) -> None:
    m = Matcher(ROSTER, (), _cfg(layout))
    matches, slot = m.match_group(["AlxTIXZO", "AlxKrAa", "AlxFlexv", "AlxZe0"], None)
    assert slot == 21
    assert [x.name if x else None for x in matches] == ["AIxTIXZO", "AIxKrAg", "AIxFlexy", "AIxZeD"]
    assert all(x and x.slot == 21 for x in matches)


def test_match_group_elimination(layout: dict[str, Any]) -> None:
    m = Matcher(ROSTER, (), _cfg(layout))
    matches, slot = m.match_group(["Lobby×Ja", "3T2々", "Seemer2", "DCKARTIK'"], None)
    assert slot == 18
    assert [x.name if x else None for x in matches] == ["Lobby×‿ Ja", "आशीष्", "ʞeɯɹer2", "DCKARTIK'"]


def test_no_roster_no_match(layout: dict[str, Any]) -> None:
    m = Matcher(None, (), _cfg(layout))
    matches, slot = m.match_group(["anything"], None)
    assert matches == [None] and slot is None


def test_lexicon_snaps_without_roster(layout: dict[str, Any]) -> None:
    m = Matcher(None, ("GExRuwad1O", "Talent Scout"), _cfg(layout))
    hit = m.match_one("GExRuwad10")
    assert hit is not None and hit.name == "GExRuwad1O" and hit.slot is None
    assert m.match_one("Completely Different") is None


def test_unrelated_names_not_snapped(layout: dict[str, Any]) -> None:
    m = Matcher(ROSTER, (), _cfg(layout))
    assert m.match_one("ZZZZQQQQ") is None


def test_detect_results_keeps_short_inner_block(layout: dict[str, Any]) -> None:
    # a 3-player team has a shorter block; only blocks at the panel edge can be cut by scrolling
    img = _results_screen([(131, 133), (138, 297), (302, 449), (453, 613), (618, 628)])
    det = detect_results(img, layout)
    right = [r for r in det.regions if r.panel == "right"]
    assert [r.box.y0 for r in right] == [138, 302, 453]
    assert not any(r.edge_cut for r in right)


# ------------------------------------------------------------------ viewport (stage 0)
def _ipad_window_screenshot() -> np.ndarray:
    """1600x1199 'iPad' with a grey wallpaper, a dock and a floating game window holding a gold panel."""
    img = np.full((1199, 1600, 3), 125, np.uint8)
    img[:, 200:260] = 10  # dark wallpaper stripe crossing the window border
    img[1050:1170, 215:1385] = 210  # dock
    img[28:1020, 137:1462] = 4  # game window
    # gold panel 680 px wide (scale 544/680 = 0.8 to canonical)
    for y0 in (300, 504, 708):
        img[y0 : y0 + 200, 700:1380] = (44, 147, 180)
    return img


def test_viewport_finds_floating_window(layout: dict[str, Any]) -> None:
    from app.pipeline.viewport import find_window, normalise

    img = _ipad_window_screenshot()
    box = find_window(img, layout["viewport"])
    assert box is not None
    assert abs(box.x0 - 137) <= 6 and abs(box.x1 - 1462) <= 6
    assert abs(box.y0 - 28) <= 6 and abs(box.y1 - 1020) <= 6
    canon, vp = normalise(img, "results", layout)
    assert vp.method == "window+anchor"
    assert abs(vp.scale - 544 / 680) < 0.01
    assert abs(canon.shape[1] - round(box.w * vp.scale)) <= 1
    det = detect_results(canon, layout)
    assert sum(r.panel == "right" for r in det.regions) == 3
    assert all(abs(r.box.w - 544) <= 3 for r in det.regions if r.panel == "right")


def test_viewport_full_screen_phone_unchanged(layout: dict[str, Any]) -> None:
    from app.pipeline.viewport import normalise

    img = _results_screen([(131, 140), (144, 304), (308, 468), (472, 628)])
    canon, vp = normalise(img, "results", layout)
    assert vp.method == "full+anchor" and vp.scale == 1.0 and canon.shape == img.shape


def test_space_separators() -> None:
    assert pp.clean_name("MTB·Aafu", "|_", 24, {}, "·|") == "MTB · Aafu"
    assert pp.clean_name("WRG|GHOST", "_", 24, {}, "·|") == "WRG | GHOST"
    assert pp.clean_name("·Titann·", "|_", 24, {}, "·|") == "· Titann ·"
    assert pp.clean_name("• Titann •", "|_", 24, {"•": "·"}, "·|") == "· Titann ·"
    assert pp.clean_name("Ｍｒ·ＬａＬａ", "|_", 24, {}, "·|") == "Ｍｒ·ＬａＬａ"  # fullwidth: untouched
