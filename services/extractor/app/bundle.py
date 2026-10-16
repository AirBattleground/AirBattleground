"""Seam between the OCR pipeline (app/pipeline, owned by the pipeline work) and the training system
(app/training, owned by the ML work).

A *model version* is a directory MODELS_DIR/<version>/ containing `manifest.json` plus optional
artifacts. The pipeline asks the registry for the active bundle on every request (cheap; cached
until the active version changes) and must work with an empty/"base" bundle.

Artifacts a trainer may produce (all optional; the pipeline uses whatever is present):
  rec_model_dir   fine-tuned PaddleOCR recognition model (inference format) — replaces the stock one
  lexicon         known player names (learned from labels) → used for fuzzy snapping, like a roster
  char_fixes      evidence-backed lookalike substitutions, e.g. {"0->O": {"context": "letters"}}
  layout          overrides merged on top of config/layout.yaml (tuned crop ratios / thresholds)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol


@dataclass(frozen=True)
class ModelBundle:
    version: str
    path: Path | None = None
    rec_model_dir: Path | None = None
    lexicon: tuple[str, ...] = ()
    char_fixes: dict[str, Any] = field(default_factory=dict)
    layout: dict[str, Any] = field(default_factory=dict)


BASE_BUNDLE = ModelBundle(version="base")


class Registry(Protocol):
    def active(self) -> ModelBundle: ...
    def get(self, version: str) -> ModelBundle: ...


_registry: Registry | None = None


def set_registry(r: Registry) -> None:
    global _registry
    _registry = r


def active_bundle() -> ModelBundle:
    """Pipeline entry point. Falls back to the stock model if no registry is configured."""
    return _registry.active() if _registry else BASE_BUNDLE
