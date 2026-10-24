/**
 * Studio screenshots (shared/studioLink.ts, kind AUTO / LIVE_STATUS): 7XEN Studio sends a frame — every few seconds
 * (trigger "auto") or when the operator presses Send ("manual") — without saying what it shows. We store it, queue
 * it, and the worker reads it (one reader call: extractor.readFrame) and applies what it found for the match's state.
 * The game's team list and results screen are both scrolled, so each frame shows some of the teams; every frame adds
 * what it shows and the match state builds up from all of them:
 *   before Start   → team list: fills the lineup slot by slot (a Match Center screenshot, source STUDIO_AUTO)
 *   live           → team list: each player's alive/eliminated state and kills (liveStatus.applyTeamList; a slot
 *                    nobody was read from before Start is filled); results screen: ends the match (an interval frame
 *                    only when it shows rank 1 and another results frame confirms it) and fills ranks; spectator HUD
 *                    (frames that are neither): alive counts (liveStatus.applyCapture)
 *   ended          → results pages fill ranks, until every team in the lineup has its rank; then interval frames get
 *                    409 CAPTURE_DONE and the studio stops capturing
 * The reader's own "which screen is this" answer is the detection (`detected`); anything else is ignored.
 *
 * Queue: frames are read in parallel (WORKER_CONCURRENCY), manual ones first, then oldest first — each frame may show
 * different teams, so none is superseded; per-player read times keep an older frame from overwriting a newer one.
 * Auto frames that waited longer than STALE_MS are skipped (a slow reader catches up), and an auto frame arriving
 * while MAX_PENDING of its match's frames wait is dropped ("busy"). Images and rows are deleted after 24 h, except
 * captures whose operator hint disagrees with what was detected — those are kept to train the reader.
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
import { applyCapture, applyTeamList, matchControl, registeredTeams, resultsProgress, studioMatch } from "./liveStatus.js";
import { adoptScreenshot, loadOwnMatch, rosterForMatch } from "./matches.js";

const MIN_INTERVAL_S = 2;
const MAX_INTERVAL_S = 30;
const PAUSED_INTERVAL_S = 15;
/** at most 1 upload per this long per studio per match */
export const CAPTURE_MIN_GAP_MS = isTest ? 150 : 2_000;
const RETENTION_MS = 24 * 3600_000;
/** reader calls at once (all matches) */
const WORKER_CONCURRENCY = 4;
/** an auto frame still queued this long after it arrived is skipped */
const STALE_MS = 45_000;
/** a match's frames queued or being read before new auto frames are dropped */
const MAX_PENDING = 12;
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

/** How often the studio should capture: as often as the parallel readers keep up with (2..30 s; the studio's own interval is the minimum). */
async function nextInterval(matchId: string, paused: boolean): Promise<number> {
  if (paused) return PAUSED_INTERVAL_S;
  const recent = await prisma.liveCapture.findMany({
    where: { matchId, status: { in: ["APPLIED", "FAILED"] }, processedAt: { not: null } },
    orderBy: { processedAt: "desc" },
    take: 5,
    select: { createdAt: true, processedAt: true },
  });
  if (!recent.length) return MIN_INTERVAL_S;
  const avgS = recent.reduce((sum, c) => sum + (c.processedAt!.getTime() - c.createdAt.getTime()), 0) / recent.length / 1000;
  return Math.min(MAX_INTERVAL_S, Math.max(MIN_INTERVAL_S, Math.ceil(avgS / WORKER_CONCURRENCY)));
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
  const auto = fields.trigger !== "manual";
  // interval frames stop once every team that played has its rank: the studio stops capturing on this code
  if (auto && (m.status === "PUBLISHED" || (m.status === "RESULTS_REVIEW" && (await resultsProgress(m.id, m.status)).complete))) {
    throw new AppError("CAPTURE_DONE", "All results are in — auto capture is done for this match.");
  }
  if (m.status === "PUBLISHED") throw conflict("The results of this match are published. Pick the next match in 7XEN Studio.");
  if (fields.hint && fields.hint !== "lobby") {
    const c = await matchControl(m);
    if (c.state === "locked") throw conflict(`Match is still locked: ${c.reason}. Only lobby screenshots are read until then.`);
  }
  // the readers are behind on this match: drop interval frames, the next one is seconds away
  if (auto && (await prisma.liveCapture.count({ where: { matchId, status: { in: ["QUEUED", "PROCESSING"] } } })) >= MAX_PENDING) {
    return { status: 200, body: { captureId: fields.captureId, accepted: false, reason: "busy" } };
  }
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
 * Claim up to `limit` queued captures: manual ones first (oldest first), then auto frames oldest first. Auto frames
 * that waited longer than STALE_MS are skipped first, so a slow reader catches up with the studio.
 */
async function claim(limit: number): Promise<{ id: string; matchId: string }[]> {
  if (limit <= 0) return [];
  await prisma.liveCapture.updateMany({
    where: { status: "QUEUED", trigger: "auto", createdAt: { lt: new Date(Date.now() - STALE_MS) } },
    data: { status: "SKIPPED", error: "skipped: waited too long to be read", processedAt: new Date() },
  });
  return prisma.$queryRaw<{ id: string; matchId: string }[]>`
    UPDATE "LiveCapture" SET status = 'PROCESSING'
    WHERE id IN (
      SELECT id FROM "LiveCapture"
      WHERE status = 'QUEUED'
      ORDER BY (trigger = 'manual') DESC, "capturedAt" ASC, "createdAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, "matchId"`;
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

/** Before Start: a team list fills the lineup (each frame the slots it shows); anything else is ignored. */
async function readBeforeStart(c: Capture, image: Buffer, ex: ExtractionResult): Promise<Done> {
  const detected = detectedOf(ex);
  const confidence = ex.needsReview ? UNSURE : SURE;
  if (detected === "results") return { status: "SKIPPED", detected, confidence, message: "Results screen, but this match hasn't started. Press Start first." };
  if (detected !== "lobby") return { status: "SKIPPED", detected, confidence, message: NOT_GAME };
  return adopt(c, image, "SLOT_LIST", ex, detected, confidence);
}

/** An interval frame must show this twice before it may end a live match. */
export const RESULTS_SEEN = "Results screen seen — waiting for one more frame to confirm the match is over";
const CONFIRM_WINDOW_MS = 90_000;

/**
 * Live: an interval (auto) frame ends the match only when it is clearly the final results — rank 1 is on it (every
 * results page shows ranks 1 and 2) — and another frame within 90 s was a results screen too. In-game overlays that
 * look like results never pass both. An operator's manual capture is taken as asked.
 */
async function finalResultsDoubt(c: Capture, ex: ExtractionResult): Promise<string | null> {
  if (c.match.status !== "LIVE" || c.trigger === "manual") return null;
  if (!ex.rows.some((r) => r.rank === 1)) return "Not the final results — no winner (rank 1) on this screen, so the match is still going";
  const t = c.capturedAt.getTime();
  const other = await prisma.liveCapture.count({
    where: {
      matchId: c.matchId,
      id: { not: c.id },
      detected: "results",
      // another final-results candidate (rank 1 on it), not just any frame the reader took for results
      OR: [{ message: RESULTS_SEEN }, { status: "APPLIED" }],
      capturedAt: { gte: new Date(t - CONFIRM_WINDOW_MS), lte: new Date(t + CONFIRM_WINDOW_MS) },
    },
  });
  return other ? null : RESULTS_SEEN;
}

/** Live or ended: a results screen fills ranks (and ends a live match); a team list after the end is ignored. */
async function readResults(c: Capture, image: Buffer, ex: ExtractionResult): Promise<Done> {
  const detected = detectedOf(ex);
  const confidence = ex.needsReview ? UNSURE : SURE;
  if (detected === "lobby") return { status: "SKIPPED", detected, confidence, message: "Team list, but this match has ended. Show the results screen." };
  if (detected !== "results") return { status: "SKIPPED", detected, confidence, message: NOT_GAME };
  const doubt = await finalResultsDoubt(c, ex);
  if (doubt) return { status: "SKIPPED", detected, confidence, message: doubt };
  return adopt(c, image, "RESULTS", ex, detected, confidence);
}

async function adopt(c: Capture, image: Buffer, kind: ScreenshotKind, ex: ExtractionResult, detected: CaptureDetected, confidence: number): Promise<Done> {
  const { screenshotId, changed } = await adoptScreenshot(c.matchId, kind, image, c.mimeType, ex);
  const n = kind === "SLOT_LIST" ? ex.teams.filter((t) => t.players.length).length : ex.rows.length;
  const what = kind === "SLOT_LIST" ? `Lobby ✓ ${plural(n, "team")}` : `Results ✓ ${plural(n, "rank")}`;
  const ended = kind === "RESULTS" && c.match.status === "LIVE" && changed > 0 ? " — the match has ended" : "";
  return { status: "APPLIED", detected, confidence, changes: changed, screenshotId, message: changed ? `${what}${ended}` : `${what} (nothing new)` };
}

/** Live: the team list updates players' states and kills; a results screen may end the match; else the spectator HUD. */
async function readWhileLive(c: Capture, image: Buffer, ex: ExtractionResult): Promise<Done> {
  const detected = detectedOf(ex);
  const confidence = ex.needsReview ? UNSURE : SURE;
  if (detected === "results") return readResults(c, image, ex);
  if (detected === "lobby") {
    const out = await applyTeamList(c.matchId, c.capturedAt, ex.teams);
    if (out.status === "SKIPPED") return { status: "SKIPPED", detected, confidence, message: `Team list — not applied (${out.reason})` };
    if (out.skipped.length) logger.info({ captureId: c.captureId, matchId: c.matchId, skipped: out.skipped }, "studio capture: team list values not applied");
    const n = ex.teams.filter((t) => t.players.length).length;
    const parts = [out.changes ? plural(out.changes, "update") : "no changes", ...(out.filled ? [`${plural(out.filled, "team")} added to the lineup`] : [])];
    return { status: "APPLIED", detected, confidence, changes: out.changes + out.filled, message: `Team list ✓ ${plural(n, "team")}, ${parts.join(", ")}` };
  }
  // neither: maybe the spectator HUD (alive bars)
  const slots = await registeredTeams(c.match);
  const read = await extractor.readLive(image, c.mimeType, slots.map((s) => ({ slot: s.slotNumber, name: s.team.name, tag: s.team.tag })));
  if (read.screen !== "spectator_hud" || !read.teams.length) return { status: "SKIPPED", detected, confidence, message: NOT_GAME };
  const outcome = await applyCapture(c.matchId, c.capturedAt, read.teams);
  const hud = Math.min(...read.teams.map((t) => t.confidence));
  if (outcome.status === "SKIPPED") return { status: "SKIPPED", detected: "in_game", confidence: hud, message: `In-game — not applied (${outcome.reason})` };
  if (outcome.skipped.length) logger.info({ captureId: c.captureId, matchId: c.matchId, skipped: outcome.skipped }, "studio capture: values not applied");
  return {
    status: "APPLIED",
    detected: "in_game",
    confidence: hud,
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
    let done: Done;
    if (s === "PUBLISHED") done = { status: "SKIPPED", detected: null, message: "The results of this match are published." };
    else {
      const ex = await extractor.readFrame(image, c.mimeType, await rosterForMatch(c.match, s === "SCHEDULED" || s === "LINEUP_REVIEW" ? "SLOT_LIST" : "RESULTS"));
      done = s === "LIVE" ? await readWhileLive(c, image, ex) : s === "RESULTS_REVIEW" ? await readResults(c, image, ex) : await readBeforeStart(c, image, ex);
    }
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
