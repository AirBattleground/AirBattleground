"""Training run manager: FIFO queue, one run at a time on a background worker thread, persisted to
MODELS_DIR/runs/<id>.json (+ .request.json and a full .log) so restarts never lose history.

A run: base = request.base_version or the active version →
  metrics_before = base on the TEST split →
  reserve version N+1 (parent = base), copy the base's artifacts into it (hard links) →
  trainers in order (paddle_finetune when selected, then adaptive), each starting from the bundle so far →
  metrics_after = new bundle on the TEST split → manifest status=ready →
  auto-activate only if requested AND TEST name_exact strictly improved.
On restart: queued runs are re-queued, a run that was running is marked failed (and its version too).
"""

from __future__ import annotations

import contextlib
import os
import queue
import threading
import traceback
import uuid
from collections import deque
from collections.abc import Callable
from pathlib import Path
from typing import Any, Literal

from app.schemas import EvalMetrics, SampleRef, TrainingRunInfo, TrainingRunRequest
from app.training.evaluate import ExtractFn, evaluate_bundle
from app.training.metrics import to_eval_metrics
from app.training.paths import atomic_write_json, read_json
from app.training.registry import FileRegistry, now_iso
from app.training.samples import Sample, from_refs, roster_from_samples, split_samples
from app.training.trainers import select_trainers
from app.training.trainers.base import TrainContext, inherit_base

TrainerMode = Literal["auto", "adaptive", "paddle_finetune"]
LOG_TAIL = 60


class RunManager:
    def __init__(
        self,
        registry: FileRegistry,
        *,
        extract_fn: ExtractFn | None = None,
        sample_loader: Callable[[list[SampleRef]], list[Sample]] | None = None,
        start_worker: bool = True,
    ) -> None:
        self.registry = registry
        self.dir = registry.root / "runs"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.extract_fn = extract_fn
        self.sample_loader = sample_loader or _default_loader
        self._lock = threading.RLock()
        self._runs: dict[str, TrainingRunInfo] = {}
        self._logs: dict[str, deque[str]] = {}
        self._q: queue.Queue[str] = queue.Queue()
        self._cancel = threading.Event()
        self._worker: threading.Thread | None = None
        self._recover()
        if start_worker:
            self.start()

    # ---------------- lifecycle ----------------
    def start(self) -> None:
        if self._worker and self._worker.is_alive():
            return
        self._worker = threading.Thread(target=self._loop, name="training-worker", daemon=True)
        self._worker.start()

    def _recover(self) -> None:
        for p in sorted(self.dir.glob("*.json")):
            if p.name.endswith(".request.json"):
                continue
            try:
                info = TrainingRunInfo.model_validate(read_json(p))
            except Exception:
                continue
            if info.status == "running":
                info.status = "failed"
                info.error = "Interrupted by an extractor restart — start the run again."
                info.finished_at = now_iso()
                if info.result_version:
                    self.registry.mark_failed(info.result_version, "interrupted by restart")
                self._runs[info.id] = info
                self._persist(info)
            else:
                self._runs[info.id] = info
                if info.status == "queued":
                    if (self.dir / f"{info.id}.request.json").exists():
                        self._q.put(info.id)
                    else:
                        info.status = "failed"
                        info.error = "Run request was lost; start the run again."
                        self._persist(info)

    # ---------------- public API ----------------
    def submit(self, req: TrainingRunRequest, trainer: TrainerMode | None = None) -> TrainingRunInfo:
        if not req.samples:
            raise ValueError("a training run needs at least one sample")
        base = req.base_version or self.registry.active_version()
        if base == "base":
            base = "v0"
        if self.registry.manifest(base).get("status") != "ready":
            raise ValueError(f"base version {base} is not ready")
        self.sample_loader(req.samples)  # validate paths now → 4xx instead of a failed run
        rid = f"run_{now_iso()[:19].replace(':', '').replace('-', '')}_{uuid.uuid4().hex[:6]}"
        info = TrainingRunInfo(
            id=rid,
            status="queued",
            progress=0.0,
            base_version=base,
            sample_count=len(req.samples),
            created_at=now_iso(),
        )
        payload: dict[str, Any] = req.model_dump()
        payload["base_version"] = base
        payload["_trainer"] = trainer or os.environ.get("TRAINER_MODE", "auto")
        atomic_write_json(self.dir / f"{rid}.request.json", payload)
        with self._lock:
            self._runs[rid] = info
            self._persist(info)
            snapshot = info.model_copy(deep=True)
        self._q.put(rid)
        return snapshot

    def get(self, rid: str) -> TrainingRunInfo | None:
        with self._lock:
            info = self._runs.get(rid)
            return info.model_copy(deep=True) if info else None

    def list_runs(self) -> list[TrainingRunInfo]:
        with self._lock:
            return sorted(
                (r.model_copy(deep=True) for r in self._runs.values()),
                key=lambda r: r.created_at,
                reverse=True,
            )

    def wait_idle(self, timeout: float = 600) -> None:
        """Block until the queue is drained (tests / CLI)."""
        done = threading.Event()

        def _check() -> None:
            self._q.join()
            done.set()

        threading.Thread(target=_check, daemon=True).start()
        done.wait(timeout)

    def shutdown(self) -> None:
        self._cancel.set()

    # ---------------- worker ----------------
    def _loop(self) -> None:
        while True:
            rid = self._q.get()
            try:
                self._run(rid)
            except Exception:  # never let the worker die
                traceback.print_exc()
            finally:
                self._q.task_done()

    def _persist(self, info: TrainingRunInfo) -> None:
        atomic_write_json(self.dir / f"{info.id}.json", info.model_dump())

    def _update(self, rid: str, **fields: Any) -> None:
        with self._lock:
            info = self._runs[rid]
            for k, v in fields.items():
                setattr(info, k, v)
            info.log_tail = list(self._logs.get(rid, deque()))[-LOG_TAIL:]
            self._persist(info)

    def _logger(self, rid: str) -> Callable[[str], None]:
        buf = self._logs.setdefault(rid, deque(maxlen=500))
        log_path = self.dir / f"{rid}.log"

        def log(msg: str) -> None:
            line = f"{now_iso()[11:19]} {msg}"
            buf.append(line)
            with open(log_path, "a", encoding="utf-8") as f:
                f.write(line + "\n")
            self._update(rid)

        return log

    def _run(self, rid: str) -> None:
        with self._lock:
            info = self._runs.get(rid)
            if info is None or info.status != "queued":
                return
        req_data = read_json(self.dir / f"{rid}.request.json")
        trainer_mode: str = req_data.pop("_trainer", "auto")
        req = TrainingRunRequest.model_validate(req_data)
        log = self._logger(rid)
        self._update(rid, status="running", started_at=now_iso(), progress=0.01)
        draft = None
        try:
            run_training(
                self.registry,
                req,
                rid=rid,
                trainer_mode=trainer_mode,
                samples=self.sample_loader(req.samples),
                log=log,
                progress=lambda p: self._update(rid, progress=round(min(max(p, 0.0), 0.999), 4)),
                on_version=lambda v: self._update(rid, result_version=v),
                on_metrics=lambda k, m: self._update(rid, **{k: m}),
                extract_fn=self.extract_fn,
                cancel=self._cancel,
            )
            self._update(rid, status="succeeded", progress=1.0, finished_at=now_iso())
        except Exception as e:
            log(f"FAILED: {type(e).__name__}: {e}")
            with self._lock:
                draft = self._runs[rid].result_version
            if draft:
                self.registry.mark_failed(draft, str(e))
            self._update(rid, status="failed", error=f"{e}"[:2000], finished_at=now_iso())


def _default_loader(refs: list[SampleRef]) -> list[Sample]:
    samples = from_refs(refs)
    for s in samples:
        s.synthetic = s.id.startswith("synth")  # convention for synthetic samples sent through the API
    return samples


def run_training(
    registry: FileRegistry,
    req: TrainingRunRequest,
    *,
    samples: list[Sample],
    rid: str = "cli",
    trainer_mode: str = "auto",
    log: Callable[[str], None] = print,
    progress: Callable[[float], None] = lambda p: None,
    on_version: Callable[[str], None] = lambda v: None,
    on_metrics: Callable[[str, EvalMetrics], None] = lambda k, m: None,
    extract_fn: ExtractFn | None = None,
    cancel: threading.Event | None = None,
    options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Synchronous training run (used by the worker and by the CLI / tests). Returns a summary dict."""
    base_v = req.base_version or registry.active_version()
    base = registry.get(base_v)
    train, test = split_samples(samples)
    eval_set, eval_split = (test, "test") if test else (train, "train")
    if not test:
        log("WARNING: no TEST samples — before/after metrics are on TRAIN and are optimistic")
    real = [s for s in samples if not s.synthetic]
    log(
        f"run {rid}: base {base_v}, {len(train)} train / {len(test)} test samples "
        f"({len(samples) - len(real)} synthetic), trainer mode {trainer_mode}"
    )
    scoring_roster = roster_from_samples(samples)
    opts = {**_env_options(), **(options or {}), "_cancel": cancel}
    trainers = select_trainers(trainer_mode, samples, opts, log)

    def _eval(bundle: Any, phase: str, lo: float, hi: float) -> EvalMetrics:
        agg, _ = evaluate_bundle(
            eval_set,
            bundle,
            registry,
            scoring_roster=scoring_roster,
            extract_fn=extract_fn,
            on_progress=lambda i, n: progress(lo + (hi - lo) * i / max(n, 1)),
        )
        m = to_eval_metrics(agg, eval_split)  # type: ignore[arg-type]
        log(
            f"{phase} ({eval_split.upper()}, {m.images} images, {m.names} names): "
            f"name_exact={m.name_exact:.3f} "
            f"cer={m.cer:.4f} slot={m.slot_accuracy:.3f} rank={m.rank_accuracy} finishes={m.kills_accuracy}"
        )
        return m

    before = _eval(base, f"metrics_before {base_v}", 0.02, 0.15)
    on_metrics("metrics_before", before)
    draft = registry.create_version(base_v, "+".join(t.name for t in trainers), req.notes, len(samples))
    on_version(draft.version)
    log(f"created {draft.version} (parent {base_v}); inheriting base artifacts")
    current = inherit_base(draft, base)
    details: dict[str, Any] = {}
    notes: list[str] = [req.notes] if req.notes else []
    span = 0.7 / max(len(trainers), 1)
    for i, t in enumerate(trainers):
        lo = 0.15 + i * span
        ctx = TrainContext(
            registry=registry,
            base=base,
            draft=draft,
            train=train,
            test=test,
            log=log,
            progress=_scaled(progress, lo, span),
            extract_fn=extract_fn,
            options=opts,
        )
        log(f"trainer {t.name}: start")
        outcome = t.train(ctx, current)
        current = outcome.bundle
        details[t.name] = outcome.details
        notes += outcome.notes
        if cancel is not None and cancel.is_set():
            raise RuntimeError("cancelled (service shutting down)")
    after = _eval(current, f"metrics_after {draft.version}", 0.85, 0.98)
    on_metrics("metrics_after", after)
    registry.finalize(
        draft,
        trainer="+".join(t.name for t in trainers),
        sample_count=len(samples),
        metrics=after,
        notes="; ".join(n for n in notes if n),
        extra={
            "run_id": rid,
            "metrics_before": before.model_dump(),
            "base_version": base_v,
            "eval_lexicon": "base ∪ TRAIN names (shipped lexicon also has TEST names)",
            "details": details,
        },
    )
    activated = False
    if req.auto_activate:
        if after.name_exact > before.name_exact:
            registry.activate(draft.version)
            activated = True
            log(
                f"auto-activated {draft.version}: TEST name_exact "
                f"{before.name_exact:.3f} → {after.name_exact:.3f}"
            )
        else:
            log(
                "not activated: TEST name_exact did not improve "
                f"({before.name_exact:.3f} → {after.name_exact:.3f})"
            )
    log(f"done: {draft.version} ready")
    return {
        "version": draft.version,
        "before": before,
        "after": after,
        "activated": activated,
        "details": details,
    }


def _scaled(progress: Callable[[float], None], lo: float, span: float) -> Callable[[float], None]:
    def f(p: float) -> None:
        progress(lo + span * p)

    return f


def _env_options() -> dict[str, Any]:
    out: dict[str, Any] = {}
    if v := os.environ.get("PADDLE_FINETUNE_MIN_NAMES"):
        out["finetune_min_names"] = int(v)
    if v := os.environ.get("PADDLE_FINETUNE_EPOCHS"):
        out["finetune_epochs"] = int(v)
    if os.environ.get("PADDLE_FINETUNE_GPU") == "1":
        out["finetune_gpu"] = True
    if v := os.environ.get("PADDLEOCR_REPO"):
        out["paddleocr_repo"] = Path(v)
    return out


_manager: RunManager | None = None
_manager_lock = threading.Lock()


def get_manager() -> RunManager:
    global _manager
    from app.training.registry import get_registry

    with _manager_lock:
        reg = get_registry()
        if _manager is None or _manager.registry is not reg:
            _manager = RunManager(reg)
        return _manager


def reset_manager() -> None:
    global _manager
    with _manager_lock:
        if _manager:
            with contextlib.suppress(Exception):
                _manager.shutdown()
        _manager = None
