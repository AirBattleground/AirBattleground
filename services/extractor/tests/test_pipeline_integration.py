"""Full pipeline (PaddleOCR) on the 7 real screenshots in eval/dataset/real/.

Slow: `pytest -m "not slow"` skips these.

Slots, ranks and finishes must be exactly right. Names are reported (exact-match rate printed) and must stay
above a floor so regressions are caught; with the lineup as roster every clean RESULTS name must be exact.
"""

from __future__ import annotations

import json
import unicodedata
from pathlib import Path
from typing import Any

import pytest

from app.bundle import BASE_BUNDLE, ModelBundle, set_registry
from app.pipeline.bench import roster_from_labels
from app.pipeline.orchestrator import extract_image
from app.schemas import Extraction

REAL = Path(__file__).resolve().parents[1] / "eval" / "dataset" / "real"
LABELS: dict[str, Any] = json.loads((REAL / "labels.json").read_text(encoding="utf-8"))
FLAGGED = {unicodedata.normalize("NFC", n) for n in LABELS["needs_human_check"]}
IMAGES = {im["file"]: im for im in LABELS["images"]}

pytestmark = pytest.mark.slow


class _BaseRegistry:
    def active(self) -> ModelBundle:
        return BASE_BUNDLE

    def get(self, version: str) -> ModelBundle:
        return BASE_BUNDLE


@pytest.fixture(autouse=True)
def _base_bundle() -> None:
    set_registry(_BaseRegistry())  # measure the stock pipeline, not whatever model is active on disk


_cache: dict[tuple[str, bool], Extraction] = {}


def run(file: str, with_roster: bool = False) -> Extraction:
    key = (file, with_roster)
    if key not in _cache:
        kind = "slot_list" if IMAGES[file]["kind"] == "SLOT_LIST" else "results"
        roster = roster_from_labels(LABELS) if with_roster else None
        _cache[key] = extract_image((REAL / file).read_bytes(), kind, roster)  # type: ignore[arg-type]
    return _cache[key]


def nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


@pytest.mark.parametrize(
    ("file", "slots"),
    [("lobby-1.jpg", [5, 6, 7, 8, 9, 11, 12, 13, 14]), ("lobby-2.jpg", [15, 16, 17, 18, 19, 20, 21, 22])],
)
def test_slot_list_slots_exact(file: str, slots: list[int]) -> None:
    ex = run(file)
    assert [t.slot for t in ex.teams] == slots
    assert [len(t.players) for t in ex.teams] == [len(t["players"]) for t in IMAGES[file]["teams"]]


RESULT_FILES = [f"result-{i}.jpg" for i in range(1, 6)]


@pytest.mark.parametrize("file", RESULT_FILES)
def test_results_ranks_and_finishes_exact(file: str) -> None:
    ex = run(file)
    rows = sorted(IMAGES[file]["rows"], key=lambda r: r["rank"])
    assert [r.rank for r in ex.rows] == [r["rank"] for r in rows]
    assert ex.rows[0].rank_confidence >= 0.85  # wings icon recognised
    got = [[p.kills for p in r.players] for r in ex.rows]
    assert got == [[p["kills"] for p in r["players"]] for r in rows]


def _name_pairs(file: str, with_roster: bool) -> list[tuple[str, str]]:
    ex = run(file, with_roster)
    im = IMAGES[file]
    pairs: list[tuple[str, str]] = []
    if im["kind"] == "SLOT_LIST":
        for t, pt in zip(im["teams"], ex.teams, strict=True):
            for j, n in enumerate(t["players"]):
                p = pt.players[j] if j < len(pt.players) else None
                pairs.append((nfc(n), nfc((p.roster_match or p.name) if p else "")))
    else:
        for r, pr in zip(sorted(im["rows"], key=lambda r: r["rank"]), ex.rows, strict=True):
            for j, n in enumerate(r["players"]):
                p = pr.players[j] if j < len(pr.players) else None
                pairs.append((nfc(n["name"]), nfc((p.roster_match or p.name) if p else "")))
    return pairs


def test_name_exact_match_report() -> None:
    allp = [p for f in IMAGES for p in _name_pairs(f, False)]
    clean = [p for p in allp if p[0] not in FLAGGED]
    acc_all = sum(e == g for e, g in allp) / len(allp)
    acc_clean = sum(e == g for e, g in clean) / len(clean)
    print(f"\nname exact (no roster): all {acc_all:.1%} ({len(allp)}), clean {acc_clean:.1%} ({len(clean)})")
    assert acc_clean >= 0.85


def test_results_names_with_roster() -> None:
    pairs = [p for f in RESULT_FILES for p in _name_pairs(f, True)]
    clean = [p for p in pairs if p[0] not in FLAGGED]
    acc = sum(e == g for e, g in pairs) / len(pairs)
    print(f"\nRESULTS name exact with roster: {acc:.1%} ({len(pairs)})")
    assert all(e == g for e, g in clean), [p for p in clean if p[0] != p[1]]
    assert acc >= 0.95


@pytest.mark.parametrize("file", RESULT_FILES)
def test_results_inferred_slot_with_roster(file: str) -> None:
    slot_of = {nfc(p): s.slot for s in roster_from_labels(LABELS).slots for p in s.players}
    ex = run(file, True)
    for r in ex.rows:
        names = [p.roster_match for p in r.players if p.roster_match]
        assert r.inferred_slot == slot_of[names[0]]
