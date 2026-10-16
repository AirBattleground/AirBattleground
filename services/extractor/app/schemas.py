"""HTTP contract of the extractor service (snake_case JSON). The 7xen API converts to camelCase
(packages/shared/src/phase2.ts). Change only additively; both apps/api and the UIs depend on it.

Endpoints
  GET  /healthz                          -> Health
  GET  /v1/version                       -> VersionInfo
  POST /v1/extract            multipart: image, kind=slot_list|results (default slot_list),
                                         roster (optional JSON string, Roster)       -> Extraction
  POST /v1/extract/batch      multipart: images[] (or one .zip), kind, roster       -> BatchExtraction
  -- training / models (app/api/training.py) --
  GET  /v1/models                        -> ModelList
  POST /v1/models/{version}/activate     -> ModelList
  POST /v1/training/runs      TrainingRunRequest -> TrainingRunInfo (202)
  GET  /v1/training/runs                 -> list[TrainingRunInfo]
  GET  /v1/training/runs/{id}            -> TrainingRunInfo
  POST /v1/evaluate           EvaluateRequest -> EvalMetrics
Images referenced by path (training/eval) are relative to STORAGE_DIR, which is shared with apps/api.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Kind = Literal["slot_list", "results"]


class RosterSlot(BaseModel):
    slot: int
    team_name: str | None = None
    players: list[str] = Field(default_factory=list)


class Roster(BaseModel):
    """Known players per slot (from the confirmed lineup / team rosters). Big accuracy lever."""

    slots: list[RosterSlot] = Field(default_factory=list)


class PlayerOut(BaseModel):
    name: str
    confidence: float
    source: str = "paddle"
    roster_match: str | None = None
    matched_slot: int | None = None
    # results only
    kills: int | None = None
    kills_confidence: float | None = None


class TeamOut(BaseModel):
    slot: int | None
    slot_confidence: float
    players: list[PlayerOut]


class ResultRowOut(BaseModel):
    rank: int | None
    rank_confidence: float
    players: list[PlayerOut]
    inferred_slot: int | None = None


class Extraction(BaseModel):
    image_id: str
    kind: Kind
    model_version: str
    teams: list[TeamOut] = Field(default_factory=list)  # slot_list
    rows: list[ResultRowOut] = Field(default_factory=list)  # results
    needs_review: bool
    warnings: list[str] = Field(default_factory=list)
    timings_ms: dict[str, float] = Field(default_factory=dict)


class BatchExtraction(BaseModel):
    items: list[Extraction]
    errors: list[dict[str, str]] = Field(default_factory=list)


class Health(BaseModel):
    status: Literal["ok", "degraded"]
    model_version: str
    ocr_ready: bool


class VersionInfo(BaseModel):
    service_version: str
    model_version: str
    layout_version: str
    vlm_enabled: bool


# ---------- labels / training ----------
class SlotListLabels(BaseModel):
    teams: list[dict]  # [{"slot": 5, "players": ["A9xTARUN", ...]}]


class ResultsLabels(BaseModel):
    rows: list[dict]  # [{"rank": 1, "players": [{"name": "...", "kills": 5}]}]


class SampleRef(BaseModel):
    id: str
    kind: Kind
    image_path: str  # relative to STORAGE_DIR
    labels: dict
    split: Literal["train", "test"]


class EvalMetrics(BaseModel):
    name_exact: float
    cer: float
    slot_accuracy: float
    kills_accuracy: float | None = None
    rank_accuracy: float | None = None
    names: int
    images: int
    split: Literal["test", "train"]


class ModelVersionInfo(BaseModel):
    version: str
    parent: str | None
    status: Literal["training", "ready", "failed"]
    active: bool
    trainer: str
    created_at: str
    sample_count: int
    metrics: EvalMetrics | None = None
    notes: str | None = None


class ModelList(BaseModel):
    active: str
    items: list[ModelVersionInfo]


class TrainingRunRequest(BaseModel):
    base_version: str | None = None  # default: active
    samples: list[SampleRef]
    notes: str | None = None
    auto_activate: bool = False


class TrainingRunInfo(BaseModel):
    id: str
    status: Literal["queued", "running", "succeeded", "failed"]
    progress: float
    base_version: str
    result_version: str | None = None
    sample_count: int
    metrics_before: EvalMetrics | None = None
    metrics_after: EvalMetrics | None = None
    log_tail: list[str] = Field(default_factory=list)
    error: str | None = None
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None


class EvaluateRequest(BaseModel):
    samples: list[SampleRef]
    version: str | None = None
