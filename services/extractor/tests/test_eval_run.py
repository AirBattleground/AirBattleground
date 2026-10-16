from __future__ import annotations

import json
from pathlib import Path

from fake_pipeline import FakePipeline

from app.training import evaluate
from app.training.samples import load_dataset
from eval import run_eval


def test_run_eval_cli_writes_reports_and_labels_synthetic(
    models_dir: Path, synth_dir: Path, tmp_path: Path
) -> None:
    evaluate.set_extract_fn(FakePipeline(load_dataset(synth_dir)))
    out = tmp_path / "runs"
    assert run_eval.main(["--dataset", str(synth_dir), "--version", "v0", "--out", str(out)]) == 0
    run = next(out.iterdir())
    report = json.loads((run / "report.json").read_text(encoding="utf-8"))
    ds = report["datasets"][0]
    assert ds["synthetic"] is True
    assert set(ds["configs"]) == {"v0 roster=none", "v0 roster=lineup"}
    summ = ds["configs"]["v0 roster=lineup"]["summary"]["all"]["all_names"]
    assert summ["names"] > 0 and summ["latency_ms_p50"] is not None
    md = (run / "REPORT.md").read_text(encoding="utf-8")
    assert "SYNTHETIC — not real-world accuracy" in md and "Top OCR character confusions" in md


def test_table_configs_order() -> None:
    labels = [c.label for c in run_eval.table_configs(["v0", "v1"])]
    assert labels[0] == "1. Paddle-only" and labels[1] == "2. + postprocess"
    assert run_eval.table_configs(["v0", "v1"])[0].raw_ocr
    assert labels[-1].startswith("5. + roster + learned (v1)")
