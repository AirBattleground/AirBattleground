/**
 * HTTP client for services/extractor (FastAPI). Its JSON is snake_case (services/extractor/app/schemas.py);
 * everything returned from here is the camelCase shape in packages/shared/src/phase2.ts.
 *
 * All calls go through the exported `extractor` object so tests can stub them with vi.spyOn.
 */
import type {
  EvalMetrics,
  ExtractedPlayer,
  ExtractionResult,
  ModelList,
  ModelVersion,
  ScreenshotKind,
  TrainingRun,
} from "@7xen/shared";
import { env } from "../env.js";
import { AppError } from "./errors.js";

export const OFFLINE_MESSAGE = "Screenshot reader is offline — enter results by hand or retry";

/** The extractor could not be reached (connection refused, DNS, timeout). */
export class ExtractorOfflineError extends Error {
  constructor(cause?: unknown) {
    super(OFFLINE_MESSAGE);
    this.name = "ExtractorOfflineError";
    this.cause = cause;
  }
}

/** The extractor answered with an error status. */
export class ExtractorHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(`Screenshot reader error (${status}): ${detail}`);
    this.name = "ExtractorHttpError";
  }
  /** 5xx / 429 are worth retrying; 4xx means the input itself is bad */
  get retryable() {
    return this.status >= 500 || this.status === 429;
  }
}

/** Roster sent with an extraction: known player names per slot. */
export interface RosterSlot {
  slot: number;
  teamName: string | null;
  players: string[];
}

const EXTRACT_TIMEOUT_MS = 120_000;
const SHORT_TIMEOUT_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 30_000;

const baseUrl = () => env.EXTRACTOR_URL.replace(/\/$/, "");

async function call(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<unknown> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(baseUrl() + path, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new ExtractorOfflineError(e);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const detail =
      body && typeof body === "object" && "detail" in body
        ? typeof (body as { detail: unknown }).detail === "string"
          ? (body as { detail: string }).detail
          : JSON.stringify((body as { detail: unknown }).detail)
        : String(text).slice(0, 200);
    throw new ExtractorHttpError(res.status, detail || res.statusText);
  }
  return body;
}

// ---------------------------------------------------------------- snake → camel mapping

type Obj = Record<string, unknown>;
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const intOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Obj[]) : []);

function toPlayer(p: Obj): ExtractedPlayer {
  return {
    name: str(p.name).normalize("NFC"),
    confidence: num(p.confidence),
    source: str(p.source, "paddle"),
    rosterMatch: strOrNull(p.roster_match),
    matchedSlot: intOrNull(p.matched_slot),
    kills: intOrNull(p.kills),
    killsConfidence: numOrNull(p.kills_confidence),
  };
}

export function toExtractionResult(raw: unknown, fallbackKind: ScreenshotKind): ExtractionResult {
  const r = (raw && typeof raw === "object" ? raw : {}) as Obj;
  const kind: ScreenshotKind = r.kind === "results" ? "RESULTS" : r.kind === "slot_list" ? "SLOT_LIST" : fallbackKind;
  const timings: Record<string, number> = {};
  if (r.timings_ms && typeof r.timings_ms === "object") {
    for (const [k, v] of Object.entries(r.timings_ms as Obj)) if (typeof v === "number") timings[k] = v;
  }
  return {
    imageId: str(r.image_id),
    kind,
    modelVersion: str(r.model_version, "unknown"),
    teams: arr(r.teams).map((t) => ({
      slot: intOrNull(t.slot),
      slotConfidence: num(t.slot_confidence),
      players: arr(t.players).map(toPlayer),
    })),
    rows: arr(r.rows).map((row) => ({
      rank: intOrNull(row.rank),
      rankConfidence: num(row.rank_confidence),
      players: arr(row.players).map(toPlayer),
      inferredSlot: intOrNull(row.inferred_slot),
    })),
    needsReview: Boolean(r.needs_review),
    warnings: Array.isArray(r.warnings) ? r.warnings.filter((w): w is string => typeof w === "string") : [],
    timingsMs: timings,
  };
}

function toMetrics(raw: unknown): EvalMetrics | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Obj;
  return {
    nameExact: num(m.name_exact),
    cer: num(m.cer),
    slotAccuracy: num(m.slot_accuracy),
    killsAccuracy: numOrNull(m.kills_accuracy),
    rankAccuracy: numOrNull(m.rank_accuracy),
    names: num(m.names),
    images: num(m.images),
    split: m.split === "train" ? "TRAIN" : "TEST",
  };
}

function toModelVersion(raw: Obj): ModelVersion {
  const status = str(raw.status).toUpperCase();
  return {
    version: str(raw.version),
    parent: strOrNull(raw.parent),
    status: status === "TRAINING" || status === "FAILED" ? status : "READY",
    active: Boolean(raw.active),
    trainer: str(raw.trainer, "unknown"),
    createdAt: str(raw.created_at),
    sampleCount: num(raw.sample_count),
    metrics: toMetrics(raw.metrics),
    notes: strOrNull(raw.notes),
  };
}

export function toModelList(raw: unknown): ModelList {
  const r = (raw && typeof raw === "object" ? raw : {}) as Obj;
  return { active: str(r.active), items: arr(r.items).map(toModelVersion) };
}

export function toTrainingRun(raw: unknown): TrainingRun {
  const r = (raw && typeof raw === "object" ? raw : {}) as Obj;
  const status = str(r.status).toUpperCase();
  return {
    id: str(r.id),
    status: status === "RUNNING" || status === "SUCCEEDED" || status === "FAILED" ? status : "QUEUED",
    progress: num(r.progress),
    baseVersion: str(r.base_version),
    resultVersion: strOrNull(r.result_version),
    sampleCount: num(r.sample_count),
    metricsBefore: toMetrics(r.metrics_before),
    metricsAfter: toMetrics(r.metrics_after),
    logTail: Array.isArray(r.log_tail) ? r.log_tail.filter((l): l is string => typeof l === "string") : [],
    error: strOrNull(r.error),
    createdAt: str(r.created_at),
    startedAt: strOrNull(r.started_at),
    finishedAt: strOrNull(r.finished_at),
  };
}

// ---------------------------------------------------------------- calls

export interface SampleRefInput {
  id: string;
  kind: ScreenshotKind;
  imagePath: string;
  labels: unknown;
  split: "TRAIN" | "TEST";
}

export interface ExtractorHealth {
  online: boolean;
  serviceVersion: string | null;
  activeModel: string | null;
  ocrReady: boolean;
  vlmEnabled: boolean;
}

const kindParam = (k: ScreenshotKind) => (k === "RESULTS" ? "results" : "slot_list");

export const extractor = {
  /** Read one screenshot. `roster` improves name matching a lot (slot → known names). */
  async extract(image: Buffer, mime: string, kind: ScreenshotKind, roster?: RosterSlot[], filename = "image"): Promise<ExtractionResult> {
    const form = new FormData();
    form.append("image", new Blob([new Uint8Array(image)], { type: mime }), filename);
    form.append("kind", kindParam(kind));
    if (roster && roster.length) {
      form.append(
        "roster",
        JSON.stringify({ slots: roster.map((r) => ({ slot: r.slot, team_name: r.teamName, players: r.players })) }),
      );
    }
    const raw = await call("/v1/extract", { method: "POST", body: form, timeoutMs: EXTRACT_TIMEOUT_MS });
    return toExtractionResult(raw, kind);
  },

  /** Health + version. Never throws. */
  async status(): Promise<ExtractorHealth> {
    const offline: ExtractorHealth = { online: false, serviceVersion: null, activeModel: null, ocrReady: false, vlmEnabled: false };
    try {
      const health = (await call("/healthz", { timeoutMs: SHORT_TIMEOUT_MS })) as Obj;
      let version: Obj = {};
      try {
        version = ((await call("/v1/version", { timeoutMs: SHORT_TIMEOUT_MS })) as Obj) ?? {};
      } catch {
        /* older extractor without /v1/version */
      }
      return {
        online: true,
        serviceVersion: strOrNull(version.service_version),
        activeModel: strOrNull(version.model_version) ?? strOrNull(health?.model_version),
        ocrReady: Boolean(health?.ocr_ready),
        vlmEnabled: Boolean(version.vlm_enabled),
      };
    } catch {
      return offline;
    }
  },

  async listModels(): Promise<ModelList> {
    return toModelList(await call("/v1/models"));
  },

  async activateModel(version: string): Promise<ModelList> {
    return toModelList(await call(`/v1/models/${encodeURIComponent(version)}/activate`, { method: "POST" }));
  },

  async listRuns(): Promise<TrainingRun[]> {
    const raw = await call("/v1/training/runs");
    const items = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as Obj).items) ? ((raw as Obj).items as unknown[]) : [];
    return items.map(toTrainingRun);
  },

  async getRun(id: string): Promise<TrainingRun> {
    return toTrainingRun(await call(`/v1/training/runs/${encodeURIComponent(id)}`));
  },

  async startRun(input: { baseVersion?: string; notes?: string; autoActivate: boolean; samples: SampleRefInput[] }): Promise<TrainingRun> {
    const body = {
      base_version: input.baseVersion ?? null,
      notes: input.notes ?? null,
      auto_activate: input.autoActivate,
      samples: input.samples.map((s) => ({
        id: s.id,
        kind: kindParam(s.kind),
        image_path: s.imagePath,
        labels: s.labels,
        split: s.split === "TEST" ? "test" : "train",
      })),
    };
    const raw = await call("/v1/training/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return toTrainingRun(raw);
  },
};

/** Convert extractor failures into API errors for request handlers (admin proxy endpoints). */
export function extractorToAppError(e: unknown): unknown {
  if (e instanceof ExtractorOfflineError) return new AppError("EXTRACTOR_OFFLINE", "Screenshot reader is offline. Try again in a minute.");
  if (e instanceof ExtractorHttpError) {
    if (e.status === 404) return new AppError("NOT_FOUND", e.detail || "Not found");
    if (e.status === 400 || e.status === 422 || e.status === 409) {
      return new AppError(e.status === 409 ? "CONFLICT" : "VALIDATION_ERROR", `Screenshot reader: ${e.detail}`);
    }
    return new AppError("EXTRACTOR_OFFLINE", `Screenshot reader failed: ${e.detail}`);
  }
  return e;
}

/** Run an extractor call from a request handler, mapping failures to API errors. */
export async function viaExtractor<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw extractorToAppError(e);
  }
}
