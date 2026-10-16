"""PaddleOCR 3.x recognition-only wrapper (no text detection: the pipeline already knows where text is).

* Lazy, process-wide singletons keyed by (model name, model dir); creation and inference are guarded by a
  lock because Paddle predictors are not thread-safe.
* Strips are recognised in batches (`ocr_batch_size`).
* Models are resolved from the local PaddleX cache (PADDLE_PDX_CACHE_HOME, default ~/.paddlex). The Docker
  image downloads them at build time (`python -m app.pipeline.ocr_paddle --download`) so the service needs
  no network at runtime. A fine-tuned bundle model (`rec_model_dir`) is loaded from disk with the model name
  read from its inference.yml.

Chosen stock model: PP-OCRv6_small_rec — measured best on the real screenshots (eval/PIPELINE_BASELINE.md):
it reads 多, シ, 《》, £ which the Latin/English models drop, at mobile-model speed.
"""

from __future__ import annotations

import os
import threading
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from app.logging import get_logger
from app.pipeline.detect import Image

# never probe model hosters at runtime; models must already be cached locally
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

log = get_logger(__name__)


@dataclass(frozen=True)
class RecResult:
    text: str
    score: float


def model_name_from_dir(model_dir: Path) -> str | None:
    for fname in ("inference.yml", "inference.yaml"):
        p = model_dir / fname
        if p.exists():
            try:
                data = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
                name = (data.get("Global") or {}).get("model_name")
                return str(name) if name else None
            except Exception:  # malformed yml -> let paddlex decide
                return None
    return None


class PaddleRecognizer:
    def __init__(self, model_name: str, model_dir: Path | None, threads: int, batch_size: int) -> None:
        from paddleocr import TextRecognition  # heavy import, deferred

        name = (model_name_from_dir(model_dir) if model_dir else None) or model_name
        self.model_name = name
        self.model_dir = model_dir
        self.batch_size = batch_size
        self._lock = threading.Lock()
        kwargs: dict[str, Any] = {"model_name": name, "device": "cpu", "cpu_threads": threads}
        if model_dir is not None:
            kwargs["model_dir"] = str(model_dir)
        self._model = TextRecognition(**kwargs)
        log.info("ocr_model_loaded", model=name, model_dir=str(model_dir) if model_dir else None)

    def recognize(self, images: Sequence[Image]) -> list[RecResult]:
        if not images:
            return []
        with self._lock:
            out = self._model.predict(input=list(images), batch_size=self.batch_size)
        return [RecResult(str(r["rec_text"]), float(r["rec_score"])) for r in out]


_models: dict[tuple[str, str], PaddleRecognizer] = {}
_models_lock = threading.Lock()


def get_recognizer(
    model_name: str, model_dir: Path | None = None, threads: int = 4, batch_size: int = 16
) -> PaddleRecognizer:
    key = (model_name, str(model_dir) if model_dir else "")
    rec = _models.get(key)
    if rec is not None:
        return rec
    with _models_lock:
        rec = _models.get(key)
        if rec is None:
            rec = PaddleRecognizer(model_name, model_dir, threads, batch_size)
            _models[key] = rec
    return rec


def loaded_models() -> list[str]:
    return [k[0] + (f"@{k[1]}" if k[1] else "") for k in _models]


def download(models: Sequence[str]) -> None:
    """Fetch models into the local cache (Docker build step)."""
    import numpy as np

    os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "False"
    for m in models:
        rec = PaddleRecognizer(m, None, threads=1, batch_size=1)
        rec.recognize([np.full((48, 96, 3), 255, dtype=np.uint8)])
        print(f"cached {m}")


if __name__ == "__main__":  # pragma: no cover - build helper
    import argparse

    from app.settings import get_settings

    ap = argparse.ArgumentParser()
    ap.add_argument("--download", action="store_true")
    args = ap.parse_args()
    if args.download:
        s = get_settings()
        download([s.ocr_rec_model, *s.ocr_alt_rec_models])
