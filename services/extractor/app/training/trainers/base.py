"""Trainer interface. A trainer starts from the *base version's* bundle and writes artifacts into the new
version's directory (VersionDraft); trainers are chained (paddle_finetune first, then adaptive) and each
receives the bundle produced so far."""

from __future__ import annotations

import os
import shutil
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, Protocol

from app.bundle import ModelBundle
from app.training.evaluate import ExtractFn
from app.training.registry import FileRegistry, VersionDraft
from app.training.samples import Sample


class TrainerUnavailable(RuntimeError):
    """Raised (or returned by check()) with a human-readable reason, e.g. missing deps / too few samples."""


@dataclass
class TrainContext:
    registry: FileRegistry
    base: ModelBundle
    draft: VersionDraft
    train: list[Sample]
    test: list[Sample]
    log: Callable[[str], None]
    progress: Callable[[float], None]  # 0..1 within this trainer
    extract_fn: ExtractFn | None = None
    options: dict[str, Any] = field(default_factory=dict)

    def cancelled(self) -> bool:
        return bool(self.options.get("_cancel") and self.options["_cancel"].is_set())


@dataclass
class TrainOutcome:
    trainer: str
    bundle: ModelBundle
    notes: list[str] = field(default_factory=list)
    details: dict[str, Any] = field(default_factory=dict)


class Trainer(Protocol):
    name: str

    def check(self, samples: list[Sample], options: dict[str, Any]) -> str | None:
        """None when this trainer can run, else the reason it cannot."""
        ...

    def train(self, ctx: TrainContext, current: ModelBundle) -> TrainOutcome: ...


def link_tree(src: Path, dst: Path) -> None:
    """Copy a directory using hard links when possible (inherited rec models cost no disk)."""

    def _link(s: str, d: str) -> object:
        try:
            os.link(s, d)
            return d
        except OSError:
            return shutil.copy2(s, d)

    shutil.copytree(src, dst, copy_function=_link, dirs_exist_ok=True)


def inherit_base(draft: VersionDraft, base: ModelBundle) -> ModelBundle:
    """The child starts as a copy of the parent: same rec model, lexicon, fixes, layout."""
    rec = None
    if base.rec_model_dir and base.rec_model_dir.is_dir():
        link_tree(base.rec_model_dir, draft.rec_model_dir)
        rec = draft.rec_model_dir
    if base.lexicon:
        draft.write_lexicon(list(base.lexicon))
    if base.char_fixes:
        draft.write_char_fixes(dict(base.char_fixes))
    if base.layout:
        draft.write_layout(dict(base.layout))
    return replace(base, version=draft.version, path=draft.path, rec_model_dir=rec)
