"""Training / model-version endpoints (contract: app/schemas.py).

GET  /v1/models                     -> ModelList
POST /v1/models/{version}/activate  -> ModelList            (rollback = activate an older version)
POST /v1/training/runs              -> TrainingRunInfo (202)
GET  /v1/training/runs              -> list[TrainingRunInfo]
GET  /v1/training/runs/{id}         -> TrainingRunInfo
POST /v1/evaluate                   -> EvalMetrics
Sample image paths are relative to STORAGE_DIR; paths escaping it are rejected (400).
"""

from __future__ import annotations

import asyncio
from typing import Literal

from fastapi import APIRouter, HTTPException, status

from app.bundle import set_registry
from app.schemas import EvalMetrics, EvaluateRequest, ModelList, TrainingRunInfo, TrainingRunRequest
from app.training.evaluate import PipelineUnavailable, evaluate_bundle
from app.training.metrics import to_eval_metrics
from app.training.paths import UnsafePathError
from app.training.registry import RegistryError, VersionNotFound, VersionNotReady, get_registry
from app.training.runs import get_manager
from app.training.samples import from_refs, roster_from_samples

router = APIRouter(tags=["training"])


def on_startup() -> None:
    reg = get_registry()
    set_registry(reg)
    get_manager()  # recover persisted runs, start the worker


def _http(e: Exception) -> HTTPException:
    if isinstance(e, VersionNotFound):
        return HTTPException(status.HTTP_404_NOT_FOUND, str(e))
    if isinstance(e, VersionNotReady):
        return HTTPException(status.HTTP_409_CONFLICT, str(e))
    if isinstance(e, UnsafePathError | FileNotFoundError | ValueError | RegistryError):
        return HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    if isinstance(e, PipelineUnavailable):
        return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e))
    raise e


@router.get("/v1/models", response_model=ModelList)
def list_models() -> ModelList:
    return get_registry().list_models()


@router.post("/v1/models/{version}/activate", response_model=ModelList)
def activate_model(version: str) -> ModelList:
    try:
        return get_registry().activate(version)
    except Exception as e:
        raise _http(e) from e


@router.post("/v1/training/runs", response_model=TrainingRunInfo, status_code=status.HTTP_202_ACCEPTED)
def start_run(req: TrainingRunRequest) -> TrainingRunInfo:
    try:
        return get_manager().submit(req)
    except Exception as e:
        raise _http(e) from e


@router.get("/v1/training/runs", response_model=list[TrainingRunInfo])
def list_runs() -> list[TrainingRunInfo]:
    return get_manager().list_runs()


@router.get("/v1/training/runs/{run_id}", response_model=TrainingRunInfo)
def get_run(run_id: str) -> TrainingRunInfo:
    info = get_manager().get(run_id)
    if info is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"training run {run_id} not found")
    return info


@router.post("/v1/evaluate", response_model=EvalMetrics)
async def evaluate(req: EvaluateRequest) -> EvalMetrics:
    """Synchronous evaluation of `version` (default: active) on the given samples (TEST ones if any)."""
    try:
        reg = get_registry()
        bundle = reg.get(req.version or reg.active_version())
        samples = from_refs(req.samples)
        if not samples:
            raise ValueError("no samples to evaluate")
        tests = [s for s in samples if s.split == "test"]
        chosen, split = (tests, "test") if tests else (samples, "train")
        sp: Literal["train", "test"] = "test" if split == "test" else "train"
        agg, _ = await asyncio.to_thread(
            evaluate_bundle, chosen, bundle, reg, scoring_roster=roster_from_samples(samples)
        )
        return to_eval_metrics(agg, sp)
    except HTTPException:
        raise
    except Exception as e:
        raise _http(e) from e
