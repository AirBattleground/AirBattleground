"""Run the real extraction pipeline over labelled samples with a given model bundle and score it.

The pipeline is consumed through one function, `extract_image(image_bytes, kind, roster) -> Extraction`
(app.pipeline.orchestrator or app.api.extract). The bundle under test is injected with
`FileRegistry.override()` (a context variable), so live /v1/extract traffic keeps using the active model.
Tests can swap the pipeline with `set_extract_fn()`.
"""

from __future__ import annotations

import hashlib
import importlib
import json
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal

from app.bundle import ModelBundle, set_registry
from app.schemas import EvalMetrics, Extraction, Kind, Roster
from app.training.metrics import ImageScore, aggregate, score_image, to_eval_metrics
from app.training.registry import FileRegistry
from app.training.samples import Sample, roster_from_samples

ExtractFn = Callable[[bytes, Kind, Roster | None], Extraction]
RosterMode = Literal["none", "lineup"]

_extract_fn: ExtractFn | None = None
_PIPELINE_MODULES = ("app.pipeline.orchestrator", "app.api.extract")


class PipelineUnavailable(RuntimeError):
    pass


def set_extract_fn(fn: ExtractFn | None) -> None:
    """Inject a pipeline (tests) or reset to auto-discovery (None)."""
    global _extract_fn
    _extract_fn = fn
    _cache.clear()


def get_extract_fn() -> ExtractFn:
    if _extract_fn is not None:
        return _extract_fn
    errors = []
    for mod_name in _PIPELINE_MODULES:
        try:
            mod = importlib.import_module(mod_name)
        except ModuleNotFoundError as e:
            errors.append(f"{mod_name}: {e}")
            continue
        fn = getattr(mod, "extract_image", None)
        if callable(fn):
            return fn
    raise PipelineUnavailable(
        "extraction pipeline not available (extract_image not found): " + "; ".join(errors)
    )


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()


def bundle_fingerprint(b: ModelBundle) -> str:
    payload = json.dumps(
        {
            "v": b.version,
            "rec": str(b.rec_model_dir) if b.rec_model_dir else None,
            "lex": sorted(b.lexicon),
            "fix": b.char_fixes,
            "lay": b.layout,
        },
        sort_keys=True,
        ensure_ascii=False,
        default=str,
    )
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


# (image sha, kind, bundle fingerprint, roster digest) -> (extraction json, latency) — the pipeline is
# deterministic for a fixed bundle, so repeated evaluations during training reuse results.
_cache: dict[tuple[str, str, str, str], tuple[str, float]] = {}
_cache_lock = threading.Lock()
_CACHE_MAX = 5000


@dataclass
class Prediction:
    sample: Sample
    extraction: Extraction | None
    latency_ms: float
    error: str | None = None


def predict(
    samples: list[Sample],
    bundle: ModelBundle,
    registry: FileRegistry,
    *,
    roster_mode: RosterMode = "none",
    roster: Roster | None = None,
    extract_fn: ExtractFn | None = None,
    on_progress: Callable[[int, int], None] | None = None,
) -> list[Prediction]:
    fn = extract_fn or get_extract_fn()
    send_roster = (roster or roster_from_samples(samples)) if roster_mode == "lineup" else None
    roster_key = (
        hashlib.sha256(send_roster.model_dump_json().encode()).hexdigest()[:12] if send_roster else "-"
    )
    fp = bundle_fingerprint(bundle)
    out: list[Prediction] = []
    set_registry(registry)  # the pipeline reads the bundle through app.bundle.active_bundle()
    with registry.override(bundle):
        for i, s in enumerate(samples):
            data = s.image_bytes()
            key = (hashlib.sha256(data).hexdigest(), s.kind, fp, roster_key)
            with _cache_lock:
                hit = _cache.get(key)
            if hit:
                out.append(Prediction(s, Extraction.model_validate_json(hit[0]), hit[1]))
            else:
                t0 = time.perf_counter()
                try:
                    ex = fn(data, s.kind, send_roster)
                    ms = (time.perf_counter() - t0) * 1000
                    out.append(Prediction(s, ex, ms))
                    with _cache_lock:
                        if len(_cache) >= _CACHE_MAX:
                            _cache.clear()
                        _cache[key] = (ex.model_dump_json(), ms)
                except PipelineUnavailable:
                    raise
                except Exception as e:  # one bad image must not kill an evaluation
                    out.append(
                        Prediction(s, None, (time.perf_counter() - t0) * 1000, f"{type(e).__name__}: {e}")
                    )
            if on_progress:
                on_progress(i + 1, len(samples))
    return out


def score(predictions: list[Prediction], scoring_roster: Roster | None = None) -> list[ImageScore]:
    roster = scoring_roster or roster_from_samples([p.sample for p in predictions])
    return [
        score_image(
            sample_id=p.sample.id,
            kind=p.sample.kind,
            split=p.sample.split,
            labels=p.sample.labels,
            extraction=p.extraction,
            flagged=p.sample.needs_human_check,
            synthetic=p.sample.synthetic,
            latency_ms=p.latency_ms,
            roster=roster,
            error=p.error,
        )
        for p in predictions
    ]


def evaluate_bundle(
    samples: list[Sample],
    bundle: ModelBundle,
    registry: FileRegistry,
    *,
    roster_mode: RosterMode = "none",
    scoring_roster: Roster | None = None,
    extract_fn: ExtractFn | None = None,
    on_progress: Callable[[int, int], None] | None = None,
) -> tuple[dict[str, Any], list[ImageScore]]:
    preds = predict(
        samples, bundle, registry, roster_mode=roster_mode, extract_fn=extract_fn, on_progress=on_progress
    )
    scores = score(preds, scoring_roster)
    return aggregate(scores), scores


def evaluate_metrics(
    samples: list[Sample],
    bundle: ModelBundle,
    registry: FileRegistry,
    *,
    split: Literal["train", "test"],
    scoring_roster: Roster | None = None,
    extract_fn: ExtractFn | None = None,
) -> EvalMetrics:
    agg, _ = evaluate_bundle(samples, bundle, registry, scoring_roster=scoring_roster, extract_fn=extract_fn)
    return to_eval_metrics(agg, split)
