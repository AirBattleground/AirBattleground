from __future__ import annotations

import pytest

from app.schemas import Extraction, PlayerOut, ResultRowOut, Roster, RosterSlot, TeamOut
from app.training.metrics import EMPTY, aggregate, cer, char_confusions, score_image, to_eval_metrics
from app.training.samples import stable_split


def test_cer_and_confusions() -> None:
    assert cer("abc", "abc") == 0
    assert cer("abd", "abc") == pytest.approx(1 / 3)
    assert cer("", "abcd") == 1.0
    assert cer("x", "") == 1.0
    assert sorted(char_confusions("GExM0OnG0D", "GExMoOnGOD")) == [("O", "0"), ("o", "0")]
    assert char_confusions("ab", "abc") == [("c", EMPTY)]


def _pl(name: str, match: str | None = None, kills: int | None = None) -> PlayerOut:
    return PlayerOut(name=name, confidence=0.9, roster_match=match, kills=kills)


def test_slot_list_scoring_pairs_by_names_not_slot() -> None:
    labels = {
        "teams": [{"slot": 5, "players": ["Alpha", "Beta"]}, {"slot": 6, "players": ["Gamma", "Delta"]}]
    }
    ex = Extraction(
        image_id="x",
        kind="slot_list",
        model_version="v0",
        needs_review=False,
        teams=[
            TeamOut(
                slot=8, slot_confidence=0.5, players=[_pl("Gamma"), _pl("De1ta", "Delta")]
            ),  # slot misread
            TeamOut(slot=5, slot_confidence=0.9, players=[_pl("A1pha"), _pl("Beta"), _pl("Ghost")]),
        ],
    )
    s = score_image(
        sample_id="x",
        kind="slot_list",
        split="test",
        labels=labels,
        extraction=ex,
        flagged=frozenset({"Alpha"}),
    )
    agg = aggregate([s])
    assert agg["names"] == 4
    assert agg["name_exact"] == pytest.approx(3 / 4)  # A1pha wrong; De1ta snapped by roster_match
    assert agg["ocr_name_exact"] == pytest.approx(2 / 4)
    assert agg["cer"] == pytest.approx(1 / 19)
    assert agg["slot_accuracy"] == pytest.approx(1 / 2)
    assert agg["extra_names"] == 1
    assert agg["rank_accuracy"] is None and agg["finishes_accuracy"] is None
    excl = aggregate([s], exclude_flagged=True)
    assert excl["names"] == 3 and excl["name_exact"] == 1.0
    assert dict(agg["top_confusions"])["l→1"] == 2


def test_results_scoring_rank_finishes_and_inferred_slot() -> None:
    labels = {
        "rows": [
            {"rank": 1, "players": [{"name": "Ann", "kills": 5}, {"name": "Bob", "kills": 1}]},
            {"rank": 3, "players": [{"name": "Cid", "kills": 0}]},
        ]
    }
    ex = Extraction(
        image_id="r",
        kind="results",
        model_version="v0",
        needs_review=False,
        rows=[
            ResultRowOut(
                rank=1, rank_confidence=1, players=[_pl("Ann", kills=5), _pl("Bob", kills=7)], inferred_slot=4
            ),
            ResultRowOut(rank=8, rank_confidence=1, players=[_pl("Cid", kills=0)], inferred_slot=9),
        ],
    )
    roster = Roster(slots=[RosterSlot(slot=4, players=["Ann", "Bob"]), RosterSlot(slot=2, players=["Cid"])])
    s = score_image(
        sample_id="r",
        kind="results",
        split="train",
        labels=labels,
        extraction=ex,
        roster=roster,
        latency_ms=100,
    )
    agg = aggregate([s])
    assert agg["name_exact"] == 1.0
    assert agg["rank_accuracy"] == 0.5
    assert agg["finishes_accuracy"] == pytest.approx(2 / 3)
    assert agg["slot_accuracy"] is None and agg["slots"] == 0
    assert agg["row_slot_accuracy"] == 0.5
    m = to_eval_metrics(agg, "train")
    assert m.kills_accuracy == pytest.approx(2 / 3) and m.images == 1 and m.names == 3


def test_missing_extraction_counts_every_name_wrong() -> None:
    labels = {"teams": [{"slot": 1, "players": ["abc", "de"]}]}
    s = score_image(
        sample_id="e", kind="slot_list", split="test", labels=labels, extraction=None, error="boom"
    )
    agg = aggregate([s])
    assert agg["name_exact"] == 0 and agg["cer"] == 1.0 and agg["missed_names"] == 2
    assert agg["images_failed"] == 1 and agg["latency_ms_p50"] is None


def test_latency_percentiles() -> None:
    scores = [
        score_image(
            sample_id=str(i),
            kind="slot_list",
            split="test",
            labels={"teams": []},
            extraction=None,
            latency_ms=float(i),
        )
        for i in range(1, 101)
    ]
    agg = aggregate(scores)
    assert agg["latency_ms_p50"] == pytest.approx(50.5)
    assert agg["latency_ms_p95"] == pytest.approx(95.05)


def test_stable_split_is_deterministic_and_roughly_70_30() -> None:
    splits = [stable_split(f"img-{i}") for i in range(2000)]
    assert splits == [stable_split(f"img-{i}") for i in range(2000)]
    assert 0.66 < splits.count("train") / 2000 < 0.74
