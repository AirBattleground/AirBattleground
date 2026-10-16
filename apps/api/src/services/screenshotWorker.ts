/**
 * In-process screenshot worker. Polls QUEUED screenshots (SELECT … FOR UPDATE SKIP LOCKED, so several
 * API instances can share the queue), sends each to the extractor with the session roster, and merges the
 * result into the match draft. Max 2 in flight. Transient failures retry with backoff (3 attempts);
 * an unreachable extractor fails the screenshot straight away with a plain message the manager can act on.
 */
import { prisma } from "../db.js";
import { ExtractorHttpError, ExtractorOfflineError, OFFLINE_MESSAGE, extractor } from "../lib/extractor.js";
import { readBuffer } from "../lib/storage.js";
import { logger } from "../logger.js";
import { applyExtraction, rosterForScreenshot } from "./matches.js";

export const WORKER_CONCURRENCY = 2;
export const MAX_ATTEMPTS = 3;
const POLL_MS = 2_000;
const backoffMs = (attempt: number) => Math.min(60_000, 5_000 * 2 ** (attempt - 1));

/** id → earliest time it may be claimed again (in-memory backoff between attempts) */
const notBefore = new Map<string, number>();
let inFlight = 0;

/** Atomically claim up to `limit` queued screenshots (status → PROCESSING, attempts + 1). */
async function claim(limit: number): Promise<string[]> {
  if (limit <= 0) return [];
  const now = Date.now();
  const skip = [...notBefore].filter(([, t]) => t > now).map(([id]) => id);
  for (const [id, t] of notBefore) if (t <= now) notBefore.delete(id);
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "Screenshot" SET status = 'PROCESSING', attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM "Screenshot"
      WHERE status = 'QUEUED' AND NOT (id = ANY(${skip}::text[]))
      ORDER BY "createdAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;
  return rows.map((r) => r.id);
}

async function fail(id: string, error: string) {
  await prisma.screenshot.update({ where: { id }, data: { status: "FAILED", error, processedAt: new Date() } });
}

/** Read one claimed screenshot and merge it. Never throws. */
export async function processScreenshot(id: string): Promise<void> {
  const s = await prisma.screenshot.findUnique({ where: { id } });
  if (!s) return;
  try {
    let image: Buffer;
    try {
      image = await readBuffer(s.storageKey);
    } catch {
      await fail(id, "The screenshot file is missing. Delete it and upload it again.");
      return;
    }
    const roster = await rosterForScreenshot(id);
    const result = await extractor.extract(image, s.mimeType, s.kind, roster, s.storageKey.split("/").pop());
    await applyExtraction(id, result);
    notBefore.delete(id);
  } catch (e) {
    if (e instanceof ExtractorOfflineError) {
      await fail(id, OFFLINE_MESSAGE);
      return;
    }
    const retryable = e instanceof ExtractorHttpError ? e.retryable : true;
    logger.warn({ err: e, screenshotId: id, attempt: s.attempts }, "screenshot processing failed");
    if (retryable && s.attempts < MAX_ATTEMPTS) {
      notBefore.set(id, Date.now() + backoffMs(s.attempts));
      await prisma.screenshot.update({ where: { id }, data: { status: "QUEUED" } }).catch(() => undefined);
      return;
    }
    const detail = e instanceof ExtractorHttpError ? e.detail : "unexpected error";
    await fail(id, `Couldn't read this screenshot (${detail}). Enter the results by hand or retry.`).catch(() => undefined);
  }
}

/** One poll: claim what fits in the concurrency budget and process it. Resolves when those finish. */
export async function runWorkerOnce(): Promise<number> {
  const ids = await claim(WORKER_CONCURRENCY - inFlight);
  await Promise.all(
    ids.map(async (id) => {
      inFlight++;
      try {
        await processScreenshot(id);
      } finally {
        inFlight--;
      }
    }),
  );
  return ids.length;
}

/** Screenshots stuck in PROCESSING after a crash/restart go back to the queue. */
export async function requeueStale(olderThanMs = 10 * 60_000) {
  await prisma.$executeRaw`
    UPDATE "Screenshot" SET status = 'QUEUED'
    WHERE status = 'PROCESSING' AND "createdAt" < ${new Date(Date.now() - olderThanMs)}`;
}

export async function queueCounts() {
  const [queued, processing, failedLast24h] = await Promise.all([
    prisma.screenshot.count({ where: { status: "QUEUED" } }),
    prisma.screenshot.count({ where: { status: "PROCESSING" } }),
    prisma.screenshot.count({ where: { status: "FAILED", processedAt: { gte: new Date(Date.now() - 24 * 3600_000) } } }),
  ]);
  return { queued, processing, failedLast24h };
}

/** Start polling. Returns a stop function. */
export function startScreenshotWorker(): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  const tick = async () => {
    if (stopped) return;
    try {
      // claim without waiting for the batch, so a slow image doesn't block the other slot
      const ids = await claim(WORKER_CONCURRENCY - inFlight);
      for (const id of ids) {
        inFlight++;
        void processScreenshot(id).finally(() => {
          inFlight--;
          if (!stopped) setImmediate(() => void tick());
        });
      }
    } catch (e) {
      logger.error({ err: e }, "screenshot worker poll failed");
    }
    if (!stopped) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void tick(), POLL_MS);
      timer.unref();
    }
  };
  void requeueStale(0)
    .catch((e) => logger.warn({ err: e }, "could not requeue stale screenshots"))
    .finally(() => void tick());
  logger.info("screenshot worker started");
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
