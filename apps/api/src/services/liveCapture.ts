/**
 * Studio screenshots (shared/studioLink.ts, kind AUTO / LIVE_STATUS): 7XEN Studio sends a frame — every few seconds
 * (trigger "auto") or when the operator presses Send ("manual") — without saying what it shows. We store it, queue
 * it, and the worker reads it with the reader that fits the match's state, then applies what it found:
 *   before Start   → team-list reader: a lobby fills the team list (a Match Center screenshot, source STUDIO_AUTO)
 *   live           → live reader: the spectator HUD updates who's alive (liveStatus.applyCapture, precedence rules);
 *                    anything else → results reader: a results screen fills ranks and ends the match
 *   after Stop     → results reader: results pages fill ranks
 * The reader's own "which screen is this" answer is the detection (`detected`); anything else is ignored.
 *
 * Queue: one capture in flight per match. Manual captures go first, oldest first, and are never skipped (results
 * pages sent back to back all count); otherwise the newest auto capture wins and older queued auto frames are
 * skipped, so a slow reader never falls behind. Images and rows are deleted after 24 h, except captures whose
 * operator hint disagrees with what was detected — those are kept to train the reader.
 */
import { Prisma, type StudioWorker as DbWorker } from "@prisma/client";
import {
  MAX_LIVE_CAPTURE_BYTES,
  type CaptureDetected,
  type ExtractionResult,
  type LiveCaptureAccepted,
  type LiveCaptureFields,
  type ScreenshotKind,
  type StudioCaptureState,
  type StudioCaptureStatus,
} from "@7xen/shared";
import { isTest } from "../env.js";
import { prisma } from "../db.js";
import { AppError, conflict, notFound } from "../lib/errors.js";
import { ExtractorHttpError, ExtractorOfflineError, OFFLINE_MESSAGE, extractor } from "../lib/extractor.js";
import { deleteKey, readBuffer, saveBuffer } from "../lib/storage.js";
import type { UploadedImage } from "../lib/upload.js";
import { logger } from "../logger.js";
import { applyCapture, registeredTeams, studioMatch } from "./liveStatus.js";
import { adoptScreenshot, loadOwnMatch, rosterForMatch } from "./matches.js";

const DEFAULT_INTERVAL_S = 5;
const MAX_INTERVAL_S = 30;
const PAUSED_INTERVAL_S = 15;
/** at most 1 upload per this long per studio per match */
export const CAPTURE_MIN_GAP_MS = isTest ? 150 : 2_000;
const RETENTION_MS = 24 * 3600_000;
const WORKER_CONCURRENCY = 3;
const POLL_MS = 1_000;
const SWEEP_MS = 10 * 60_000;
const NOT_GAME = "Not a game screen we can read. Capture the scene with the game's lobby, spectator view or results.";
const LOBBY_SCREENS = new Set(["custom_lobby", "tdm_lobby"]);
const RESULTS_SCREENS = new Set(["custom_results", "tdm_results", "classic_results"]);
const SURE = 0.97;
const UNSURE = 0.6;

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
  if (m.status === "PUBLISHED") throw conflict("The results of this match are published. Pick the next match in 7XEN Studio.");
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
        trigger: fields.trigger,
        hint: fields.hint,
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

const STATE: Record<string, StudioCaptureState> = { QUEUED: "queued", PROCESSING: "reading", APPLIED: "applied", SKIPPED: "ignored", FAILED: "failed" };

/** Studio: what the reader made of one of its captures. */
export async function captureStatus(worker: DbWorker, matchId: string, captureId: string): Promise<StudioCaptureStatus> {
  await studioMatch(matchId, worker.managerId);
  const c = await prisma.liveCapture.findUnique({ where: { workerId_captureId: { workerId: worker.id, captureId } } });
  if (!c || c.matchId !== matchId) throw notFound("Capture not found");
  return {
    captureId,
    status: STATE[c.status]!,
    detected: (c.detected as CaptureDetected | null) ?? null,
    confidence: c.confidence,
    message: c.message ?? c.error,
  };
}

// ---------------------------------------------------------------- worker

/**
 * Claim the next capture of up to `limit` matches that have none in flight: the oldest manual one, else the newest
 * auto one (older queued auto frames of that match are then skipped).
 */
async function claim(limit: number): Promise<{ id: string; matchId: string }[]> {
  if (limit <= 0) return [];
  const rows = await prisma.$queryRaw<{ id: string; matchId: string; capturedAt: Date; trigger: string }[]>`
    UPDATE "LiveCapture" SET status = 'PROCESSING'
    WHERE status = 'QUEUED' AND id IN (
      SELECT id FROM (
        SELECT DISTINCT ON (c."matchId") c.id, c."createdAt"
        FROM "LiveCapture" c
        WHERE c.status = 'QUEUED'
          AND NOT EXISTS (SELECT 1 FROM "LiveCapture" p WHERE p."matchId" = c."matchId" AND p.status = 'PROCESSING')
        ORDER BY c."matchId", (c.trigger = 'manual') DESC, CASE WHEN c.trigger = 'manual' THEN c."capturedAt" END ASC, c."capturedAt" DESC
      ) next
      ORDER BY next."createdAt"
      LIMIT ${limit}
    )
    RETURNING id, "matchId", "capturedAt", trigger`;
  for (const r of rows.filter((x) => x.trigger !== "manual")) {
    await prisma.liveCapture.updateMany({
      where: { matchId: r.matchId, status: "QUEUED", trigger: "auto", capturedAt: { lte: r.capturedAt } },
      data: { status: "SKIPPED", error: "superseded by a newer capture", processedAt: new Date() },
    });
  }
  return rows;
}

async function finish(id: string, data: Prisma.LiveCaptureUpdateInput) {
  await prisma.liveCapture.update({ where: { id }, data: { ...data, processedAt: new Date() } });
}

type Done = Prisma.LiveCaptureUpdateInput & { detected: CaptureDetected | null };
type Capture = Prisma.LiveCaptureGetPayload<{ include: { match: { select: { id: true; status: true; sessionId: true; groupId: true } } } }>;

const detectedOf = (ex: ExtractionResult): CaptureDetected => {
  if (ex.screen && LOBBY_SCREENS.has(ex.screen)) return "lobby";
  if (ex.screen && RESULTS_SCREENS.has(ex.screen)) return "results";
  return "other";
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Before Start: a lobby fills the team list; anything else is ignored. */
async function readBeforeStart(c: Capture, image: Buffer): Promise<Done> {
  const ex = await extractor.extract(image, c.mimeType, "SLOT_LIST", await rosterForMatch(c.match, "SLOT_LIST"));
  const detected = detectedOf(ex);
  const confidence = ex.needsReview ? UNSURE : SURE;
  if (detected === "results") return { status: "SKIPPED", detected, confidence, message: "Results screen, but this match hasn't started. Press Start first." };
  if (detected !== "lobby") return { status: "SKIPPED", detected, confidence, message: NOT_GAME };
  return adopt(c, image, "SLOT_LIST", ex, detected, confidence);
}

/** Live or stopped: a results screen fills ranks (and ends a live match); anything else is ignored. */
async function readResults(c: Capture, image: Buffer): Promise<Done> {
  const ex = await extractor.extract(image, c.mimeType, "RESULTS", await rosterForMatch(c.match, "RESULTS"));
  const detected = detectedOf(ex);
  const confidence = ex.needsReview ? UNSURE : SURE;
  if (detected === "lobby") return { status: "SKIPPED", detected, confidence, message: "Lobby screen, but this match has already started." };
  if (detected !== "results") return { status: "SKIPPED", detected, confidence, message: NOT_GAME };
  return adopt(c, image, "RESULTS", ex, detected, confidence);
}

async function adopt(c: Capture, image: Buffer, kind: ScreenshotKind, ex: ExtractionResult, detected: CaptureDetected, confidence: number): Promise<Done> {
  const { screenshotId, changed } = await adoptScreenshot(c.matchId, kind, image, c.mimeType, ex);
  const n = kind === "SLOT_LIST" ? ex.teams.filter((t) => t.players.length).length : ex.rows.length;
  const what = kind === "SLOT_LIST" ? `Lobby ✓ ${plural(n, "team")}` : `Results ✓ ${plural(n, "rank")}`;
  const ended = kind === "RESULTS" && c.match.status === "LIVE" && changed > 0 ? " — the match has ended" : "";
  return { status: "APPLIED", detected, confidence, changes: changed, screenshotId, message: changed ? `${what}${ended}` : `${what} (nothing new)` };
}

/** Live: the spectator HUD updates who's still in; otherwise it may be the results screen. */
async function readWhileLive(c: Capture, image: Buffer): Promise<Done> {
  const slots = await registeredTeams(c.match);
  const read = await extractor.readLive(image, c.mimeType, slots.map((s) => ({ slot: s.slotNumber, name: s.team.name, tag: s.team.tag })));
  if (read.screen !== "spectator_hud" || !read.teams.length) return readResults(c, image);
  const outcome = await applyCapture(c.matchId, c.capturedAt, read.teams);
  const confidence = Math.min(...read.teams.map((t) => t.confidence));
  if (outcome.status === "SKIPPED") return { status: "SKIPPED", detected: "in_game", confidence, message: `In-game — not applied (${outcome.reason})` };
  if (outcome.skipped.length) logger.info({ captureId: c.captureId, matchId: c.matchId, skipped: outcome.skipped }, "studio capture: values not applied");
  return {
    status: "APPLIED",
    detected: "in_game",
    confidence,
    changes: outcome.changes,
    message: outcome.changes ? `In-game ✓ ${plural(outcome.changes, "player change")}` : "In-game ✓ no changes",
    result: { read, ...outcome } as unknown as Prisma.InputJsonValue,
  };
}

/** Read and apply one claimed capture. Never throws; no retries (the next capture supersedes this one). */
async function processCapture(id: string): Promise<void> {
  const c = await prisma.liveCapture.findUnique({ where: { id }, include: { match: { select: { id: true, status: true, sessionId: true, groupId: true } } } });
  if (!c) return;
  try {
    let image: Buffer;
    try {
      image = await readBuffer(c.storageKey);
    } catch {
      await finish(id, { status: "FAILED", error: "The captured image is missing." });
      return;
    }
    const s = c.match.status;
    const done: Done =
      s === "PUBLISHED"
        ? { status: "SKIPPED", detected: null, message: "The results of this match are published." }
        : s === "LIVE"
          ? await readWhileLive(c, image)
          : s === "RESULTS_REVIEW"
            ? await readResults(c, image)
            : await readBeforeStart(c, image);
    await finish(id, { ...done, error: done.status === "FAILED" ? (done.message as string) : null });
  } catch (e) {
    const error =
      e instanceof ExtractorOfflineError
        ? OFFLINE_MESSAGE
        : `Couldn't read this capture (${e instanceof ExtractorHttpError ? e.detail : "unexpected error"}).`;
    if (!(e instanceof ExtractorOfflineError)) logger.warn({ err: e, captureId: c.captureId }, "studio capture processing failed");
    await finish(id, { status: "FAILED", error, message: error }).catch(() => undefined);
  }
}

let inFlight = 0;

/** One poll: claim what fits and process it. Resolves when those finish (tests). */
export async function runLiveCaptureOnce(): Promise<number> {
  const rows = await claim(WORKER_CONCURRENCY - inFlight);
  await Promise.all(rows.map((r) => processCapture(r.id)));
  return rows.length;
}

/** Delete captures (rows + images) older than 24 h, except hint/detection mismatches. */
export async function sweepLiveCaptures(now = Date.now()): Promise<number> {
  // keep captures the operator labelled differently from what was detected: training material for the reader
  const old = await prisma.$queryRaw<{ id: string; storageKey: string }[]>`
    SELECT id, "storageKey" FROM "LiveCapture"
    WHERE "createdAt" < ${new Date(now - RETENTION_MS)}
      AND NOT (hint IS NOT NULL AND detected IS NOT NULL AND hint <> detected)
    LIMIT 2000`;
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
