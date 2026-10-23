/**
 * Auto capture (shared/studioLink.ts, kind=LIVE_STATUS): 7XEN Studio uploads a frame of a scene every few seconds; we
 * store it, queue it, and an in-process worker reads each team's player states (lib/extractor.ts readLive) and applies
 * them to the live team status (liveStatus.ts applyCapture, which owns the precedence rules).
 *
 * Queue: newest first, one capture in flight per match. Claiming a match's newest capture marks its older queued ones
 * SKIPPED, so a slow reader never falls behind — it reads the latest frame. nextIntervalSeconds slows the studio down
 * to what the reader keeps up with. Images and rows are deleted after 24 h.
 */
import { Prisma, type StudioWorker as DbWorker } from "@prisma/client";
import { MAX_LIVE_CAPTURE_BYTES, type LiveCaptureAccepted, type LiveCaptureFields } from "@7xen/shared";
import { isTest } from "../env.js";
import { prisma } from "../db.js";
import { AppError, conflict, notFound } from "../lib/errors.js";
import { ExtractorHttpError, ExtractorOfflineError, OFFLINE_MESSAGE, extractor } from "../lib/extractor.js";
import { deleteKey, readBuffer, saveBuffer } from "../lib/storage.js";
import type { UploadedImage } from "../lib/upload.js";
import { logger } from "../logger.js";
import { applyCapture, registeredTeams, studioMatch } from "./liveStatus.js";
import { loadOwnMatch } from "./matches.js";

const DEFAULT_INTERVAL_S = 5;
const MAX_INTERVAL_S = 30;
const PAUSED_INTERVAL_S = 15;
/** at most 1 upload per this long per studio per match */
export const CAPTURE_MIN_GAP_MS = isTest ? 150 : 2_000;
const RETENTION_MS = 24 * 3600_000;
const WORKER_CONCURRENCY = 3;
const POLL_MS = 1_000;
const SWEEP_MS = 10 * 60_000;
const NO_PANEL = "No team status panel on this frame. Capture the scene that shows the game's spectator view.";

// ---------------------------------------------------------------- upload

/** studio+match → last accepted upload (ms); in memory, like the other rate limits */
const lastUpload = new Map<string, number>();

/** Seconds to wait before this studio may upload for this match again (0 = go ahead, and counts as an upload). */
export function captureWait(workerId: string, matchId: string, now = Date.now()): number {
  const key = `${workerId}:${matchId}`;
  const last = lastUpload.get(key);
  if (last != null && now - last < CAPTURE_MIN_GAP_MS) return Math.max(1, Math.ceil((CAPTURE_MIN_GAP_MS - (now - last)) / 1000));
  lastUpload.set(key, now);
  if (lastUpload.size > 5_000) for (const [k, t] of lastUpload) if (now - t > 60_000) lastUpload.delete(k);
  return 0;
}

/** How often the studio should capture: about as often as the reader finishes one (5..30 s). */
async function nextInterval(matchId: string, paused: boolean): Promise<number> {
  if (paused) return PAUSED_INTERVAL_S;
  const recent = await prisma.liveCapture.findMany({
    where: { matchId, status: { in: ["APPLIED", "FAILED"] }, processedAt: { not: null } },
    orderBy: { processedAt: "desc" },
    take: 5,
    select: { createdAt: true, processedAt: true },
  });
  if (!recent.length) return DEFAULT_INTERVAL_S;
  const avgS = recent.reduce((sum, c) => sum + (c.processedAt!.getTime() - c.createdAt.getTime()), 0) / recent.length / 1000;
  return Math.min(MAX_INTERVAL_S, Math.max(DEFAULT_INTERVAL_S, Math.ceil(avgS)));
}

const duplicate = (captureId: string): { status: 200; body: LiveCaptureAccepted } => ({ status: 200, body: { captureId, accepted: false, duplicate: true } });

/** Store + queue one capture. `wait` = the rate gate (seconds to wait, 0 = ok), checked after the cheap rejections. */
export async function acceptCapture(
  worker: DbWorker,
  matchId: string,
  fields: LiveCaptureFields,
  img: UploadedImage,
  wait: () => number,
): Promise<{ status: 200 | 202; body: LiveCaptureAccepted } | { status: 429; retryAfter: number }> {
  const m = await studioMatch(matchId, worker.managerId);
  if (img.buffer.length > MAX_LIVE_CAPTURE_BYTES) {
    throw new AppError("VALIDATION_ERROR", "Each capture must be 2 MB or smaller", { files: "Max 2 MB" }, 413);
  }
  const seen = await prisma.liveCapture.findUnique({ where: { workerId_captureId: { workerId: worker.id, captureId: fields.captureId } }, select: { id: true } });
  if (seen) return duplicate(fields.captureId);
  if (m.status !== "LIVE") throw conflict("This match isn't live. Auto capture will pick up again once the match starts.");
  const retryAfter = wait();
  if (retryAfter > 0) return { status: 429, retryAfter };

  const storageKey = `matches/${matchId}/captures/${fields.sessionId}/${fields.sequence}.${img.info.ext}`;
  await saveBuffer(storageKey, img.buffer);
  try {
    await prisma.liveCapture.create({
      data: {
        matchId,
        workerId: worker.id,
        captureId: fields.captureId,
        sessionId: fields.sessionId,
        sequence: fields.sequence,
        capturedAt: new Date(fields.capturedAt),
        sceneId: fields.sceneId,
        sceneName: fields.sceneName,
        storageKey,
        mimeType: img.info.mime,
        width: fields.width ?? img.info.width,
        height: fields.height ?? img.info.height,
      },
    });
  } catch (e) {
    // a concurrent upload of the same captureId won the race (same key, so its file stays)
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return duplicate(fields.captureId);
    throw e;
  }
  kickLiveCaptureWorker();

  const ahead = await prisma.liveCapture.groupBy({ by: ["matchId"], where: { status: "QUEUED", matchId: { not: matchId } } });
  return {
    status: 202,
    body: { captureId: fields.captureId, accepted: true, queuePosition: ahead.length, nextIntervalSeconds: await nextInterval(matchId, m.liveAutoPaused) },
  };
}

/** Match Center: a capture's stored image (own match; `bypass` = admin). */
export async function liveCaptureFile(matchId: string, id: string, managerId: string, bypass = false) {
  await loadOwnMatch(matchId, managerId, bypass);
  const c = await prisma.liveCapture.findFirst({ where: { id, matchId }, select: { storageKey: true, mimeType: true } });
  if (!c) throw notFound("That capture is gone (captures are kept for 24 hours)");
  return c;
}

// ---------------------------------------------------------------- worker

/** Claim the newest queued capture of up to `limit` matches that have none in flight; older queued ones are skipped. */
async function claim(limit: number): Promise<{ id: string; matchId: string }[]> {
  if (limit <= 0) return [];
  const rows = await prisma.$queryRaw<{ id: string; matchId: string; capturedAt: Date }[]>`
    UPDATE "LiveCapture" SET status = 'PROCESSING'
    WHERE status = 'QUEUED' AND id IN (
      SELECT id FROM (
        SELECT DISTINCT ON (c."matchId") c.id, c."createdAt"
        FROM "LiveCapture" c
        WHERE c.status = 'QUEUED'
          AND NOT EXISTS (SELECT 1 FROM "LiveCapture" p WHERE p."matchId" = c."matchId" AND p.status = 'PROCESSING')
        ORDER BY c."matchId", c."capturedAt" DESC
      ) newest
      ORDER BY newest."createdAt"
      LIMIT ${limit}
    )
    RETURNING id, "matchId", "capturedAt"`;
  for (const r of rows) {
    await prisma.liveCapture.updateMany({
      where: { matchId: r.matchId, status: "QUEUED", capturedAt: { lte: r.capturedAt } },
      data: { status: "SKIPPED", error: "superseded by a newer capture", processedAt: new Date() },
    });
  }
  return rows;
}

async function finish(id: string, data: Prisma.LiveCaptureUpdateInput) {
  await prisma.liveCapture.update({ where: { id }, data: { ...data, processedAt: new Date() } });
}

/** Read and apply one claimed capture. Never throws; no retries (the next capture supersedes this one). */
async function processCapture(id: string): Promise<void> {
  const c = await prisma.liveCapture.findUnique({ where: { id }, include: { match: { select: { sessionId: true, groupId: true } } } });
  if (!c) return;
  try {
    let image: Buffer;
    try {
      image = await readBuffer(c.storageKey);
    } catch {
      await finish(id, { status: "FAILED", error: "The captured image is missing." });
      return;
    }
    const slots = await registeredTeams(c.match);
    const read = await extractor.readLive(
      image,
      c.mimeType,
      slots.map((s) => ({ slot: s.slotNumber, name: s.team.name, tag: s.team.tag })),
    );
    if (read.screen === "other" || !read.teams.length) {
      await finish(id, { status: "FAILED", error: NO_PANEL, result: { read } as unknown as Prisma.InputJsonValue });
      return;
    }
    const outcome = await applyCapture(c.matchId, c.capturedAt, read.teams);
    if (outcome.status === "APPLIED" && outcome.skipped.length) {
      logger.info({ captureId: c.captureId, matchId: c.matchId, skipped: outcome.skipped }, "live capture: values not applied");
    }
    await finish(id, {
      status: outcome.status,
      changes: outcome.status === "APPLIED" ? outcome.changes : 0,
      error: outcome.status === "SKIPPED" ? outcome.reason : null,
      result: { read, ...outcome } as unknown as Prisma.InputJsonValue,
    });
  } catch (e) {
    const error =
      e instanceof ExtractorOfflineError
        ? OFFLINE_MESSAGE
        : `Couldn't read this capture (${e instanceof ExtractorHttpError ? e.detail : "unexpected error"}).`;
    if (!(e instanceof ExtractorOfflineError)) logger.warn({ err: e, captureId: c.captureId }, "live capture processing failed");
    await finish(id, { status: "FAILED", error }).catch(() => undefined);
  }
}

let inFlight = 0;

/** One poll: claim what fits and process it. Resolves when those finish (tests). */
export async function runLiveCaptureOnce(): Promise<number> {
  const rows = await claim(WORKER_CONCURRENCY - inFlight);
  await Promise.all(rows.map((r) => processCapture(r.id)));
  return rows.length;
}

/** Delete captures (rows + images) older than 24 h. */
export async function sweepLiveCaptures(now = Date.now()): Promise<number> {
  const old = await prisma.liveCapture.findMany({ where: { createdAt: { lt: new Date(now - RETENTION_MS) } }, select: { id: true, storageKey: true }, take: 2_000 });
  for (const c of old) await deleteKey(c.storageKey);
  await prisma.liveCapture.deleteMany({ where: { id: { in: old.map((c) => c.id) } } });
  return old.length;
}

let kick: (() => void) | null = null;
/** An upload arrived: poll now instead of waiting for the next tick. */
export function kickLiveCaptureWorker() {
  kick?.();
}

/** Start the worker (when the screenshot worker runs) and the 24 h sweep. Returns a stop function. */
export function startLiveCaptureWorker(): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  const tick = async () => {
    if (stopped) return;
    try {
      const rows = await claim(WORKER_CONCURRENCY - inFlight);
      for (const r of rows) {
        inFlight++;
        void processCapture(r.id).finally(() => {
          inFlight--;
          if (!stopped) setImmediate(() => void tick());
        });
      }
    } catch (e) {
      logger.error({ err: e }, "live capture worker poll failed");
    }
    if (!stopped) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void tick(), POLL_MS);
      timer.unref();
    }
  };
  kick = () => setImmediate(() => void tick());
  const sweep = () => void sweepLiveCaptures().catch((e) => logger.warn({ err: e }, "live capture sweep failed"));
  const sweeper = setInterval(sweep, SWEEP_MS);
  sweeper.unref();
  // captures stuck in PROCESSING after a crash/restart go back to the queue
  void prisma.liveCapture
    .updateMany({ where: { status: "PROCESSING" }, data: { status: "QUEUED" } })
    .catch((e) => logger.warn({ err: e }, "could not requeue live captures"))
    .finally(() => {
      sweep();
      void tick();
    });
  logger.info("live capture worker started");
  return () => {
    stopped = true;
    kick = null;
    clearInterval(sweeper);
    if (timer) clearTimeout(timer);
  };
}
