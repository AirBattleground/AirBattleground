"""Train a new model version from labelled dataset dirs (same code path as POST /v1/training/runs).

    uv run python -m app.training.cli --dataset eval/dataset/real --synthetic eval/dataset/synthetic \\
        --trainer adaptive [--base v0] [--auto-activate]

Real samples keep their stable sha256 TRAIN/TEST split. Synthetic samples are always forced to TRAIN (extra
lookalike evidence only): they never enter TEST metrics nor the shipped lexicon.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.bundle import set_registry
from app.schemas import TrainingRunRequest
from app.training.registry import FileRegistry
from app.training.runs import run_training
from app.training.samples import Sample, load_dataset


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset", type=Path, action="append", default=[], help="real labelled dataset dir")
    ap.add_argument(
        "--synthetic", type=Path, action="append", default=[], help="synthetic dataset dir (TRAIN only)"
    )
    ap.add_argument("--trainer", choices=["auto", "adaptive", "paddle_finetune"], default="auto")
    ap.add_argument("--base", help="base version (default: active)")
    ap.add_argument("--auto-activate", action="store_true")
    ap.add_argument("--notes")
    ap.add_argument("--epochs", type=int, help="paddle_finetune epochs")
    ap.add_argument("--min-names", type=int, help="paddle_finetune minimum TRAIN names")
    a = ap.parse_args(argv)
    samples: list[Sample] = []
    for d in a.dataset:
        samples += load_dataset(d, synthetic=False)
    for d in a.synthetic:
        for s in load_dataset(d, synthetic=True):
            s.split = "train"
            s.id = f"synth-{d.name}-{s.id}"
            samples.append(s)
    if not samples:
        ap.error("no samples: pass --dataset and/or --synthetic")
    reg = FileRegistry()
    set_registry(reg)
    opts: dict[str, object] = {}
    if a.epochs:
        opts["finetune_epochs"] = a.epochs
    if a.min_names:
        opts["finetune_min_names"] = a.min_names
    res = run_training(
        reg,
        TrainingRunRequest(base_version=a.base, samples=[], notes=a.notes, auto_activate=a.auto_activate),
        samples=samples,
        trainer_mode=a.trainer,
        options=opts,
    )
    print(
        json.dumps(
            {
                "version": res["version"],
                "activated": res["activated"],
                "metrics_before": res["before"].model_dump(),
                "metrics_after": res["after"].model_dump(),
            },
            indent=1,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
