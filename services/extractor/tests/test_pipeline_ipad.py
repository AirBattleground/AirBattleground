"""Full pipeline on owner-provided iPad / phone screenshots (eval/dataset/testingss). Slow.

Covers: floating game window on iPad (1600x1199), 2732x2048 iPad, full-screen iPad, short blocks of teams
with fewer players at the panel edge, and the 1600x717 phone variant. Slots, ranks and finishes must be
exact; names are covered by the bench (python -m app.pipeline.bench).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from app.bundle import BASE_BUNDLE, ModelBundle, set_registry
from app.pipeline.orchestrator import extract_image

ROOT = Path(__file__).resolve().parents[1] / "eval" / "dataset" / "testingss"

pytestmark = pytest.mark.slow


class _BaseRegistry:
    def active(self) -> ModelBundle:
        return BASE_BUNDLE

    def get(self, version: str) -> ModelBundle:
        return BASE_BUNDLE


@pytest.fixture(autouse=True)
def _base_bundle() -> None:
    set_registry(_BaseRegistry())


def _label(group: str, file: str) -> dict[str, Any]:
    p = ROOT / group / "labels.json"
    if not p.exists():
        pytest.skip(f"{group} not labelled yet")
    for im in json.loads(p.read_text(encoding="utf-8"))["images"]:
        if im["file"] == file:
            return dict(im)
    pytest.skip(f"{group}/{file} not labelled")
    raise AssertionError  # unreachable


@pytest.mark.parametrize(
    ("group", "file"),
    [("g10", "01.jpg"), ("g10", "02.jpg"), ("g15", "01.jpg"), ("g18", "07.jpg"), ("g21", "07.jpg")],
)
def test_slot_list_slots_exact(group: str, file: str) -> None:
    im = _label(group, file)
    ex = extract_image((ROOT / group / file).read_bytes(), "slot_list")
    assert [t.slot for t in ex.teams] == [t["slot"] for t in im["teams"]]
    assert [len(t.players) for t in ex.teams] == [len(t["players"]) for t in im["teams"]]


@pytest.mark.parametrize(
    ("group", "file"),
    [
        ("g10", "05.jpg"),  # floating window, short 3-player blocks, partial block at the top
        ("g16", "01.jpg"),  # 2732x2048
        ("g01", "01.jpg"),  # full-screen iPad
        ("g19", "07.jpg"),  # short (3-player) block at the top edge of the panel
        ("g12", "06.jpg"),  # 2-player block at the top edge
        ("g21", "05.jpg"),  # phone 1600x717
    ],
)
def test_results_ranks_and_finishes_exact(group: str, file: str) -> None:
    im = _label(group, file)
    ex = extract_image((ROOT / group / file).read_bytes(), "results")
    rows = sorted(im["rows"], key=lambda r: r["rank"])
    got = {r.rank: r for r in ex.rows}
    for r in rows:
        assert r["rank"] in got, f"rank {r['rank']} missing"
        assert [p.kills for p in got[r["rank"]].players] == [p["kills"] for p in r["players"]]
