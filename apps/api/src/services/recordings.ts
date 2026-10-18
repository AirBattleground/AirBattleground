/**
 * Phase 4: match recordings from the manager app — live session state + event log, resumable (tus-like)
 * video upload, ffmpeg post-processing, streaming, retention and the admin view.
 *
 * Upload protocol: POST create (expected size) → HEAD for the offset → PATCH raw chunks with `Upload-Offset`
 * (the file on disk is the source of truth for the offset; a dropped connection keeps the bytes that arrived)
 * → POST complete (size check → PROCESSING → ffmpeg duration/size/poster → READY).
 */
import { createWriteStream } from "node:fs";
import { mkdir, open, truncate } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Request } from "express";
import { Prisma, type MatchRecording, type RecordingStatus as DbRecordingStatus } from "@prisma/client";
import {
  MAX_UPLOAD_CHUNK_BYTES,
  UPLOAD_CHUNK_BYTES,
  type AdminRecordingRow,
  type AppSettings,
  type CreateUploadInput,
  type RecordingEvent,
  type RecordingEventInput,
  type RecordingRow,
  type RecordingStatus,
  type StartRecordingInput,
  type UploadState,
} from "@7xen/shared";
import { prisma } from "../db.js";
import { AppError, conflict, notFound, OffsetMismatchError } from "../lib/errors.js";
import { iso } from "../lib/serialize.js";
import {
  deleteVideoKey,
  makePoster,
  probeVideo,
  resolveVideoKey,
  videoFileSize,
  videoFreeBytes,
  videoKeyFor,
  videoRoot,
} from "../lib/video.js";
import { logger } from "../logger.js";
import { matchContext } from "./matchContext.js";
import { loadOwnMatch, ownerInclude, ownerManagerId } from "./matches.js";

const NOT_FOUND = "Recording not found";
export const MAX_EVENTS = 500;
/** A LIVE recording not touched for this long is treated as abandoned (app crashed / phone died). */
const STALE_LIVE_MS = 6 * 60 * 60 * 1000;
const APP_SOURCES = ["APP_AUTO", "APP_MANUAL"];

// ---------------------------------------------------------------- DTO

export const recordingShotSelect = { kind: true, source: true, createdAt: true } satisfies Prisma.ScreenshotSelect;
type Shot = Prisma.ScreenshotGetPayload<{ select: typeof recordingShotSelect }>;

/** App screenshots taken during (or shortly after) a recording. */
export function capturesFor(rec: Pick<MatchRecording, "startedAt" | "endedAt">, shots: Shot[]) {
  const from = rec.startedAt.getTime() - 60_000;
  const to = rec.endedAt ? rec.endedAt.getTime() + 30 * 60_000 : Infinity;
  const mine = shots.filter((s) => APP_SOURCES.includes(s.source) && s.createdAt.getTime() >= from && s.createdAt.getTime() <= to);
  return { slotList: mine.filter((s) => s.kind === "SLOT_LIST").length, results: mine.filter((s) => s.kind === "RESULTS").length };
}

export const eventsOf = (raw: Prisma.JsonValue): RecordingEvent[] => (Array.isArray(raw) ? (raw as unknown as RecordingEvent[]) : []);
const num = (b: bigint | null): number | null => (b == null ? null : Number(b));

export function toRecordingRow(r: MatchRecording, captures: { slotList: number; results: number }): RecordingRow {
  return {
    id: r.id,
    matchId: r.matchId,
    status: r.status as RecordingStatus,
    deviceName: r.deviceName,
    startedAt: r.startedAt.toISOString(),
    endedAt: iso(r.endedAt),
    durationSec: r.durationSec,
    sizeBytes: num(r.sizeBytes),
    uploadedBytes: Number(r.uploadedBytes),
    width: r.width,
    height: r.height,
    hasPoster: !!r.posterKey,
    events: eventsOf(r.events),
    captures,
    error: r.error,
  };
}

async function rowFor(r: MatchRecording): Promise<RecordingRow> {
  const shots = await prisma.screenshot.findMany({ where: { matchId: r.matchId }, select: recordingShotSelect });
  return toRecordingRow(r, capturesFor(r, shots));
}

// ---------------------------------------------------------------- loading

const recordingInclude = { match: { include: ownerInclude } } satisfies Prisma.MatchRecordingInclude;

/** The recording, if its match belongs to the manager (`bypass` = admin). */
async function loadOwnRecording(id: string, managerId: string, bypass = false) {
  const r = await prisma.matchRecording.findUnique({ where: { id }, include: recordingInclude });
  if (!r || (!bypass && ownerManagerId(r.match) !== managerId)) throw notFound(NOT_FOUND);
  return r;
}

const lockMatch = (tx: Prisma.TransactionClient, matchId: string) => tx.$queryRaw`SELECT id FROM "Match" WHERE id = ${matchId} FOR UPDATE`;

// ---------------------------------------------------------------- live session

export async function startRecording(matchId: string, managerId: string, input: StartRecordingInput, bypass = false, now = new Date()): Promise<RecordingRow> {
  await loadOwnMatch(matchId, managerId, bypass);
  const rec = await prisma.$transaction(async (tx) => {
    await lockMatch(tx, matchId);
    const live = await tx.matchRecording.findFirst({ where: { matchId, status: "LIVE" } });
    if (live) {
      if (now.getTime() - live.updatedAt.getTime() < STALE_LIVE_MS) {
        throw conflict(`This match is already being recorded${live.deviceName ? ` on ${live.deviceName}` : ""}. Stop that recording first.`);
      }
      await tx.matchRecording.update({ where: { id: live.id }, data: { status: "FAILED", endedAt: live.updatedAt, error: "Recording was abandoned" } });
    }
    const start: RecordingEvent = { at: now.toISOString(), type: "start", detail: input.deviceName ?? null };
    return tx.matchRecording.create({
      data: {
        matchId,
        managerId,
        deviceName: input.deviceName ?? null,
        appVersion: input.appVersion ?? null,
        startedAt: now,
        events: [start] as unknown as Prisma.InputJsonValue,
      },
    });
  });
  return rowFor(rec);
}

export async function listRecordings(matchId: string, managerId: string, bypass = false): Promise<RecordingRow[]> {
  await loadOwnMatch(matchId, managerId, bypass);
  const [rows, shots] = await Promise.all([
    prisma.matchRecording.findMany({ where: { matchId }, orderBy: { startedAt: "desc" } }),
    prisma.screenshot.findMany({ where: { matchId }, select: recordingShotSelect }),
  ]);
  return rows.map((r) => toRecordingRow(r, capturesFor(r, shots)));
}

export async function updateRecording(id: string, managerId: string, input: RecordingEventInput, bypass = false, now = new Date()): Promise<RecordingRow> {
  const r = await loadOwnRecording(id, managerId, bypass);
  if (r.status === "DELETED") throw conflict("This recording was deleted");

  const data: Prisma.MatchRecordingUpdateInput = {};
  if (input.events.length) {
    const events = [...eventsOf(r.events), ...input.events.map((e) => ({ at: e.at, type: e.type, detail: e.detail ?? null }))].slice(-MAX_EVENTS);
    data.events = events as unknown as Prisma.InputJsonValue;
  }
  if (input.durationSec != null) data.durationSec = input.durationSec;
  if (input.error != null) data.error = input.error;

  if (input.status === "STOPPED" && r.status === "LIVE") {
    data.status = "STOPPED";
    data.endedAt = now;
  } else if (input.status === "LIVE" && r.status !== "LIVE") {
    if (r.status !== "STOPPED") throw conflict("This recording can't go live again");
    const other = await prisma.matchRecording.findFirst({ where: { matchId: r.matchId, status: "LIVE", id: { not: id } } });
    if (other) throw conflict("Another recording of this match is live");
    data.status = "LIVE";
    data.endedAt = null;
  } else if (input.status === "FAILED" && r.status !== "FAILED") {
    if (r.status === "READY") throw conflict("This recording is already uploaded");
    data.status = "FAILED";
    data.endedAt = r.endedAt ?? now;
  }
  // anything else (e.g. STOPPED after the upload began) is a harmless repeat

  const row = await prisma.matchRecording.update({ where: { id }, data });
  return rowFor(row);
}

// ---------------------------------------------------------------- upload

function uploadState(r: Pick<MatchRecording, "id" | "sizeBytes" | "status">, offset: number): UploadState {
  const size = num(r.sizeBytes) ?? 0;
  return { recordingId: r.id, offset, sizeBytes: size, chunkSize: UPLOAD_CHUNK_BYTES, complete: size > 0 && offset >= size };
}

const UPLOADABLE: DbRecordingStatus[] = ["LIVE", "STOPPED", "UPLOADING", "FAILED"];

export async function createUpload(id: string, managerId: string, input: CreateUploadInput, bypass = false, now = new Date()): Promise<UploadState> {
  const r = await loadOwnRecording(id, managerId, bypass);
  if (r.status === "PROCESSING" || r.status === "READY") throw conflict("This video is already uploaded");
  if (!UPLOADABLE.includes(r.status)) throw conflict("This recording was deleted");

  // same upload again (app restarted): just report where we are
  if (r.videoKey && num(r.sizeBytes) === input.sizeBytes) {
    const offset = await videoFileSize(r.videoKey);
    if (r.status !== "UPLOADING" || Number(r.uploadedBytes) !== offset) {
      await prisma.matchRecording.update({ where: { id }, data: { status: "UPLOADING", uploadedBytes: offset } });
    }
    return uploadState({ ...r, status: "UPLOADING" }, offset);
  }

  const free = await videoFreeBytes();
  if (free != null && free < 2 * input.sizeBytes) {
    throw new AppError("STORAGE_FULL", "The server is running out of space for videos. Ask the admin to free some space, then try again.");
  }

  await deleteVideoKey(r.videoKey); // a different file was started before: begin again
  const videoKey = videoKeyFor(r.id, "mp4", r.startedAt);
  const abs = resolveVideoKey(videoKey);
  await mkdir(path.dirname(abs), { recursive: true });
  await (await open(abs, "w")).close(); // empty file: offset 0
  const row = await prisma.matchRecording.update({
    where: { id },
    data: {
      status: "UPLOADING",
      videoKey,
      sizeBytes: BigInt(input.sizeBytes),
      uploadedBytes: 0n,
      width: input.width ?? r.width,
      height: input.height ?? r.height,
      endedAt: r.endedAt ?? now,
    },
  });
  return uploadState(row, 0);
}

function requireUpload(r: MatchRecording): string {
  if (r.status === "PROCESSING" || r.status === "READY") throw conflict("This video is already uploaded");
  if (r.status !== "UPLOADING" || !r.videoKey) throw conflict("Start the upload first");
  return r.videoKey;
}

export async function uploadOffset(id: string, managerId: string, bypass = false): Promise<UploadState> {
  const r = await loadOwnRecording(id, managerId, bypass);
  if (!r.videoKey) throw notFound("No upload has been started for this recording");
  const offset = r.status === "READY" || r.status === "PROCESSING" ? Number(r.sizeBytes ?? 0n) : await videoFileSize(r.videoKey);
  return uploadState(r, offset);
}

/** Recordings currently receiving a chunk (single API process) — refuse parallel PATCHes. */
const writing = new Set<string>();

class ChunkTooLarge extends Error {}

export async function appendChunk(req: Request, id: string, managerId: string, bypass = false): Promise<UploadState> {
  const r = await loadOwnRecording(id, managerId, bypass);
  const videoKey = requireUpload(r);
  if (!req.is("application/octet-stream") && !req.is("application/offset+octet-stream")) {
    throw new AppError("VALIDATION_ERROR", "Send the video chunk as application/octet-stream", undefined, 415);
  }
  const header = req.header("upload-offset");
  if (header == null || !/^\d+$/.test(header.trim())) throw new AppError("VALIDATION_ERROR", "Missing Upload-Offset header");
  const claimed = Number(header);
  const size = Number(r.sizeBytes ?? 0n);
  const declared = req.header("content-length");
  if (declared != null && Number(declared) > MAX_UPLOAD_CHUNK_BYTES) {
    throw new AppError("VALIDATION_ERROR", `Send at most ${MAX_UPLOAD_CHUNK_BYTES / (1024 * 1024)} MB per chunk`, undefined, 413);
  }

  if (writing.has(id)) throw conflict("Another upload of this video is in progress");
  writing.add(id);
  try {
    const offset = await videoFileSize(videoKey);
    if (claimed !== offset) throw new OffsetMismatchError(offset);
    if (declared != null && offset + Number(declared) > size) {
      throw new AppError("VALIDATION_ERROR", "That chunk goes past the end of the video");
    }
    const abs = resolveVideoKey(videoKey);
    const limit = Math.min(MAX_UPLOAD_CHUNK_BYTES, size - offset);
    let received = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        received += chunk.length;
        if (received > limit) return cb(new ChunkTooLarge());
        cb(null, chunk);
      },
    });
    try {
      await pipeline(req, counter, createWriteStream(abs, { flags: "a" }));
    } catch (e) {
      if (e instanceof ChunkTooLarge) {
        await truncate(abs, offset); // drop the oversized chunk entirely
        throw new AppError("VALIDATION_ERROR", received > MAX_UPLOAD_CHUNK_BYTES ? "Chunk is too large" : "That chunk goes past the end of the video", undefined, 413);
      }
      // connection dropped: keep the bytes that arrived; the app resumes from HEAD's offset
      const now = await videoFileSize(videoKey);
      await prisma.matchRecording.update({ where: { id }, data: { uploadedBytes: BigInt(now) } });
      throw e;
    }
    const newOffset = await videoFileSize(videoKey);
    await prisma.matchRecording.update({ where: { id }, data: { uploadedBytes: BigInt(newOffset) } });
    return uploadState(r, newOffset);
  } finally {
    writing.delete(id);
  }
}

export async function completeUpload(id: string, managerId: string, bypass = false): Promise<RecordingRow> {
  const r = await loadOwnRecording(id, managerId, bypass);
  if (r.status === "READY" || r.status === "PROCESSING") return rowFor(r);
  const videoKey = requireUpload(r);
  if (writing.has(id)) throw conflict("A chunk is still being uploaded");
  const size = Number(r.sizeBytes ?? 0n);
  const offset = await videoFileSize(videoKey);
  if (offset !== size) {
    throw new OffsetMismatchError(offset, `The upload isn't finished yet (${offset} of ${size} bytes). Resume from the server's offset.`);
  }
  await prisma.matchRecording.update({ where: { id }, data: { status: "PROCESSING", uploadedBytes: BigInt(offset) } });
  const done = await processVideo(r.id, videoKey, r.startedAt);
  return rowFor(done);
}

/** ffmpeg: duration, size and a poster at ~10%. Failures still end READY (no poster) and are logged. */
export async function processVideo(id: string, videoKey: string, startedAt: Date): Promise<MatchRecording> {
  const abs = resolveVideoKey(videoKey);
  const data: Prisma.MatchRecordingUpdateInput = { status: "READY" };
  try {
    const info = await probeVideo(abs);
    if (info.durationSec != null) data.durationSec = info.durationSec;
    if (info.width != null) data.width = info.width;
    if (info.height != null) data.height = info.height;
    const posterKey = videoKeyFor(id, "jpg", startedAt);
    await makePoster(abs, resolveVideoKey(posterKey), Math.max(0, (info.durationSec ?? 0) * 0.1));
    data.posterKey = posterKey;
  } catch (err) {
    logger.warn({ err, recordingId: id }, "video post-processing failed; keeping the video without a poster");
  }
  return prisma.matchRecording.update({ where: { id }, data });
}

// ---------------------------------------------------------------- files

export async function videoFile(id: string, managerId: string, bypass = false): Promise<string> {
  const r = await loadOwnRecording(id, managerId, bypass);
  if (r.status !== "READY" || !r.videoKey) throw notFound("This video isn't available");
  return resolveVideoKey(r.videoKey);
}

export async function posterFile(id: string, managerId: string, bypass = false): Promise<string> {
  const r = await loadOwnRecording(id, managerId, bypass);
  if (r.status === "DELETED" || !r.posterKey) throw notFound("No poster for this video");
  return resolveVideoKey(r.posterKey);
}

async function dropFiles(r: Pick<MatchRecording, "id" | "videoKey" | "posterKey">) {
  await deleteVideoKey(r.videoKey);
  await deleteVideoKey(r.posterKey);
  await prisma.matchRecording.update({ where: { id: r.id }, data: { status: "DELETED", videoKey: null, posterKey: null, uploadedBytes: 0n } });
}

// ---------------------------------------------------------------- settings + retention

const VIDEO_RETENTION_KEY = "videoRetentionDays";
const DEFAULT_VIDEO_RETENTION_DAYS = 30;

export async function videoRetentionDays(): Promise<number> {
  const s = await prisma.appSetting.findUnique({ where: { key: VIDEO_RETENTION_KEY } });
  const v = typeof s?.value === "number" ? s.value : Number(s?.value);
  return Number.isInteger(v) && v > 0 ? v : DEFAULT_VIDEO_RETENTION_DAYS;
}

export async function getSettings(): Promise<AppSettings> {
  const [days, used, videos, freeBytes] = await Promise.all([
    videoRetentionDays(),
    prisma.matchRecording.aggregate({ where: { status: { not: "DELETED" } }, _sum: { uploadedBytes: true } }),
    prisma.matchRecording.count({ where: { status: { not: "DELETED" }, videoKey: { not: null } } }),
    videoFreeBytes(),
  ]);
  return { videoRetentionDays: days, videoStorage: { dir: videoRoot(), usedBytes: Number(used._sum.uploadedBytes ?? 0n), freeBytes, videos } };
}

export async function updateSettings(input: { videoRetentionDays: number }): Promise<AppSettings> {
  await prisma.appSetting.upsert({
    where: { key: VIDEO_RETENTION_KEY },
    create: { key: VIDEO_RETENTION_KEY, value: input.videoRetentionDays },
    update: { value: input.videoRetentionDays },
  });
  return getSettings();
}

/** Delete videos older than the retention period (status DELETED). Returns how many were removed. */
export async function runRetentionSweep(now = new Date()): Promise<number> {
  const days = await videoRetentionDays();
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const old = await prisma.matchRecording.findMany({
    where: { status: { not: "DELETED" }, createdAt: { lt: cutoff } },
    select: { id: true, videoKey: true, posterKey: true },
  });
  for (const r of old) await dropFiles(r);
  // a crash mid-processing leaves PROCESSING forever: the file is complete, so serve it
  await prisma.matchRecording.updateMany({ where: { status: "PROCESSING", updatedAt: { lt: new Date(now.getTime() - 30 * 60_000) } }, data: { status: "READY" } });
  if (old.length) logger.info({ removed: old.length, retentionDays: days }, "video retention sweep");
  return old.length;
}

/** Runs the sweep shortly after start and then daily. Returns a stop function. */
export function startRetentionSweeper(): () => void {
  const run = () => void runRetentionSweep().catch((err) => logger.error({ err }, "video retention sweep failed"));
  const first = setTimeout(run, 60_000);
  const daily = setInterval(run, 24 * 60 * 60 * 1000);
  first.unref();
  daily.unref();
  return () => {
    clearTimeout(first);
    clearInterval(daily);
  };
}

// ---------------------------------------------------------------- admin

export async function adminListRecordings(filter: { status?: RecordingStatus; q?: string }): Promise<AdminRecordingRow[]> {
  const q = filter.q?.trim();
  const contains = (s: string) => ({ contains: s, mode: "insensitive" as const });
  const rows = await prisma.matchRecording.findMany({
    where: {
      ...(filter.status ? { status: filter.status } : {}),
      ...(q
        ? {
            OR: [
              { manager: { displayName: contains(q) } },
              { deviceName: contains(q) },
              { match: { session: { scrim: { title: contains(q) } } } },
              { match: { group: { stage: { tournament: { title: contains(q) } } } } },
            ],
          }
        : {}),
    },
    include: { ...recordingInclude, manager: { select: { id: true, displayName: true } } },
    orderBy: { startedAt: "desc" },
    take: 200,
  });
  const matchIds = [...new Set(rows.map((r) => r.matchId))];
  const shots = matchIds.length ? await prisma.screenshot.findMany({ where: { matchId: { in: matchIds } }, select: { ...recordingShotSelect, matchId: true } }) : [];
  return rows.map((r) => {
    const ctx = matchContext(r.match);
    return {
      ...toRecordingRow(
        r,
        capturesFor(
          r,
          shots.filter((s) => s.matchId === r.matchId),
        ),
      ),
      manager: r.manager,
      matchTitle: `${ctx.title} · ${ctx.subtitle}`,
    };
  });
}

export async function adminDeleteRecording(id: string): Promise<void> {
  const r = await prisma.matchRecording.findUnique({ where: { id } });
  if (!r) throw notFound(NOT_FOUND);
  await dropFiles(r);
}
