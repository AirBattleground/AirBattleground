"""Trainer registry + selection.

auto            = paddle_finetune (only when available: enough samples + training deps) then adaptive (always)
adaptive        = adaptive only
paddle_finetune = paddle_finetune (must be available, else the run fails with the reason) then adaptive
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from app.training.samples import Sample
from app.training.trainers.adaptive import AdaptiveTrainer
from app.training.trainers.base import Trainer, TrainerUnavailable
from app.training.trainers.paddle_finetune import PaddleFinetuneTrainer

TRAINERS: dict[str, Callable[[], Trainer]] = {
    "adaptive": AdaptiveTrainer,
    "paddle_finetune": PaddleFinetuneTrainer,
}


def select_trainers(
    mode: str, samples: list[Sample], options: dict[str, Any], log: Callable[[str], None]
) -> list[Trainer]:
    if mode not in ("auto", *TRAINERS):
        raise ValueError(f"unknown trainer mode {mode!r}")
    chosen: list[Trainer] = []
    if mode in ("auto", "paddle_finetune"):
        ft = PaddleFinetuneTrainer()
        reason = ft.check(samples, options)
        if reason is None:
            chosen.append(ft)
        elif mode == "paddle_finetune":
            raise TrainerUnavailable(f"paddle_finetune unavailable: {reason}")
        else:
            log(f"paddle_finetune skipped: {reason}")
    chosen.append(AdaptiveTrainer())
    return chosen


__all__ = ["TRAINERS", "select_trainers"]
