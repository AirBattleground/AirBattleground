from __future__ import annotations

from pathlib import Path

from fake_pipeline import FakePipeline

from app.schemas import Extraction, Kind, Roster, TrainingRunRequest
from app.training.evaluate import evaluate_bundle
from app.training.registry import FileRegistry
from app.training.runs import run_training
from app.training.samples import load_dataset
from app.training.trainers import select_trainers


def _samples(synth_dir: Path) -> list:
    s = load_dataset(synth_dir)
    assert all(x.synthetic for x in s)
    for i, x in enumerate(s):  # deterministic split for the test
        x.split = "test" if i % 3 == 2 else "train"
        x.synthetic = False  # treat as "real" so the lexicon path is exercised too
    return s


def test_adaptive_produces_child_version_and_improves(models_dir: Path, synth_dir: Path) -> None:
    samples = _samples(synth_dir)
    fake = FakePipeline(samples, snap=False)  # no snapping: char_fixes must do the work
    reg = FileRegistry()
    res = run_training(
        reg,
        TrainingRunRequest(samples=[], auto_activate=True),
        samples=samples,
        trainer_mode="adaptive",
        extract_fn=fake,
        log=lambda m: None,
    )
    v = res["version"]
    assert v == "v1"
    m = reg.manifest(v)
    assert m["parent"] == "v0" and m["status"] == "ready" and m["trainer"] == "adaptive"
    assert "0->O" in reg.get(v).char_fixes  # learned from TRAIN confusions
    assert res["after"].name_exact >= res["before"].name_exact
    assert res["after"].name_exact > res["before"].name_exact and res["activated"]
    assert reg.active_version() == "v1"
    assert set(reg.get(v).lexicon) >= {n for s in samples for n in s.label_names()}


def test_retrain_on_top_of_previous_version(models_dir: Path, synth_dir: Path) -> None:
    samples = _samples(synth_dir)
    fake = FakePipeline(samples, snap=False)
    reg = FileRegistry()
    r1 = run_training(
        reg,
        TrainingRunRequest(samples=[]),
        samples=samples,
        trainer_mode="adaptive",
        extract_fn=fake,
        log=lambda m: None,
    )
    r2 = run_training(
        reg,
        TrainingRunRequest(samples=[], base_version=r1["version"]),
        samples=samples,
        trainer_mode="adaptive",
        extract_fn=fake,
        log=lambda m: None,
    )
    assert reg.manifest(r2["version"])["parent"] == r1["version"]
    # child inherits the parent's learned fixes (and keeps or improves accuracy)
    assert set(reg.get(r1["version"]).char_fixes) <= set(reg.get(r2["version"]).char_fixes)
    assert r2["after"].name_exact >= r1["after"].name_exact


def test_adaptive_never_regresses_train(models_dir: Path, synth_dir: Path) -> None:
    samples = _samples(synth_dir)
    fake = FakePipeline(samples, snap=True)
    reg = FileRegistry()
    train = [s for s in samples if s.split == "train"]
    before, _ = evaluate_bundle(train, reg.get("v0"), reg, extract_fn=fake)
    res = run_training(
        reg,
        TrainingRunRequest(samples=[]),
        samples=samples,
        trainer_mode="adaptive",
        extract_fn=fake,
        log=lambda m: None,
    )
    after, _ = evaluate_bundle(train, reg.get(res["version"]), reg, extract_fn=fake)
    for k in ("name_exact", "ocr_name_exact", "slot_accuracy", "rank_accuracy", "finishes_accuracy"):
        if before[k] is not None:
            assert after[k] >= before[k] - 1e-9, k


def test_auto_selection_skips_finetune_with_reason(synth_dir: Path) -> None:
    logs: list[str] = []
    ts = select_trainers("auto", _samples(synth_dir), {"paddleocr_repo": None}, logs.append)
    assert [t.name for t in ts] == ["adaptive"]
    assert any("paddle_finetune skipped" in m and "PADDLEOCR_REPO" in m for m in logs)


def test_extraction_errors_are_scored_as_misses(models_dir: Path, synth_dir: Path) -> None:
    samples = _samples(synth_dir)

    def broken(data: bytes, kind: Kind, roster: Roster | None) -> Extraction:
        raise RuntimeError("ocr exploded")

    reg = FileRegistry()
    # extraction errors are scored as misses, so training still completes on a "blind" model
    res = run_training(
        reg,
        TrainingRunRequest(samples=[]),
        samples=samples,
        trainer_mode="adaptive",
        extract_fn=broken,
        log=lambda m: None,
    )
    assert res["after"].name_exact == 0.0
    assert reg.active_version() == "v0"
