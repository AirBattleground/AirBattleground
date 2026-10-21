/**
 * Phase 8b — Studio workers (shared/studioWorker.ts): a manager's own PC that renders + encodes their Studio shows.
 * The worker polls every ~2 s with its key; the answer carries the show to run (render page URL + session, RTMP
 * publish URL with a worker publish token) or null (stop whatever is running).
 */
import { createHash, randomBytes } from "node:crypto";
import type { StudioWorker as DbWorker } from "@prisma/client";
import { APP_COOKIE, STUDIO_FPS, WORKER_VIDEO_KBPS, type StudioWorkerRow, type WorkerJob, type WorkerPollInput, type WorkerPollResponse, type WorkerState } from "@7xen/shared";
import { env } from "../env.js";
import { prisma } from "../db.js";
import { signMobileToken } from "../lib/auth.js";
import { notFound } from "../lib/errors.js";
import { workerPublishToken, workerReadToken } from "./media.js";
import { boxJobOutputs, endShow, workerOnline, workerRunning } from "./studio.js";
import { publicUrl } from "./youtube.js";

const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

function toRow(w: DbWorker): StudioWorkerRow {
  return {
    id: w.id,
    name: w.name,
    online: workerOnline(w.lastSeenAt),
    state: w.state as WorkerState,
    encoder: w.encoder,
    version: w.version,
    showId: w.showId,
    lastSeenAt: w.lastSeenAt?.toISOString() ?? null,
    error: w.error,
    box: w.boxLanUrl ? { name: w.name, lanUrl: w.boxLanUrl, devices: w.boxDevices ?? 0, streaming: w.boxStreaming ?? 0 } : null,
  };
}

export async function createWorker(managerId: string, name: string): Promise<{ worker: StudioWorkerRow; key: string }> {
  const key = `sw_${randomBytes(32).toString("base64url")}`;
  const w = await prisma.studioWorker.create({ data: { managerId, name, keyHash: hashKey(key) } });
  return { worker: toRow(w), key };
}

export async function listWorkers(managerId: string): Promise<StudioWorkerRow[]> {
  const rows = await prisma.studioWorker.findMany({ where: { managerId }, orderBy: { createdAt: "asc" } });
  return rows.map(toRow);
}

/** Remove a worker (its key stops working); a show it is running ends. */
export async function deleteWorker(id: string, managerId: string): Promise<void> {
  const w = await prisma.studioWorker.findUnique({ where: { id } });
  if (!w || w.managerId !== managerId) throw notFound("Studio worker not found");
  const live = await prisma.studioShow.findMany({ where: { workerId: id, runOn: "worker", state: "LIVE" }, select: { id: true } });
  for (const s of live) await endShow(s.id);
  await prisma.studioWorker.delete({ where: { id } });
}

export async function workerByKey(key: string | undefined): Promise<DbWorker | null> {
  if (!key || !key.startsWith("sw_") || key.length > 100) return null;
  const w = await prisma.studioWorker.findUnique({ where: { keyHash: hashKey(key) } });
  if (!w) return null;
  const manager = await prisma.user.findUnique({ where: { id: w.managerId }, select: { isActive: true } });
  return manager?.isActive ? w : null;
}

/** Publish tokens per show (valid 12 h; re-minted when less than an hour is left or the worker changed). */
const tokenCache = new Map<string, { workerId: string; token: string; exp: number }>();
const sessionCache = new Map<string, { token: string; exp: number }>();

function publishTokenFor(showId: string, workerId: string): string {
  const c = tokenCache.get(showId);
  if (c && c.workerId === workerId && c.exp - Date.now() > 60 * 60_000) return c.token;
  const { token, expiresAt } = workerPublishToken(showId, workerId);
  if (tokenCache.size > 500) tokenCache.clear();
  tokenCache.set(showId, { workerId, token, exp: expiresAt.getTime() });
  return token;
}

const readCache = new Map<string, { token: string; exp: number }>();
function readTokenFor(workerId: string): string {
  const c = readCache.get(workerId);
  if (c && c.exp - Date.now() > 60 * 60_000) return c.token;
  const token = workerReadToken(workerId);
  if (readCache.size > 500) readCache.clear();
  readCache.set(workerId, { token, exp: Number(token.split(".")[1]) });
  return token;
}

function sessionFor(managerId: string): string {
  const c = sessionCache.get(managerId);
  if (c && c.exp - Date.now() > 24 * 60 * 60_000) return c.token;
  const { token, expiresAt } = signMobileToken({ sub: managerId, role: "MANAGER" });
  if (sessionCache.size > 500) sessionCache.clear();
  sessionCache.set(managerId, { token, exp: expiresAt.getTime() });
  return token;
}

export async function poll(worker: DbWorker, input: WorkerPollInput): Promise<WorkerPollResponse> {
  await prisma.studioWorker.update({
    where: { id: worker.id },
    data: {
      lastSeenAt: new Date(),
      state: input.state,
      encoder: input.encoder,
      version: input.version,
      showId: input.showId,
      fps: input.fps,
      bitrateKbps: input.bitrateKbps,
      error: input.error,
      // phase 8c: a Studio Box reports itself in every poll; a poll without `box` = a plain worker
      boxLanUrl: input.box ? input.box.lanUrl.replace(/\/+$/, "") : null,
      boxDevices: input.box?.devices ?? null,
      boxStreaming: input.box?.streaming ?? null,
    },
  });
  const show = await prisma.studioShow.findFirst({
    where: { workerId: worker.id, runOn: "worker", state: "LIVE" },
    orderBy: { liveSince: "desc" },
  });
  let job: WorkerJob | null = null;
  if (show && workerRunning(show.id, worker.id)) {
    job = {
      showId: show.id,
      title: show.title,
      renderUrl: `${publicUrl()}/studio-render/${show.id}`,
      session: { cookieName: APP_COOKIE, token: sessionFor(show.managerId) },
      publishUrl: `${env.MEDIA_RTMP_URL.replace(/\/+$/, "")}/show_${show.id}?wtoken=${publishTokenFor(show.id, worker.id)}`,
      videoKbps: WORKER_VIDEO_KBPS,
      fps: STUDIO_FPS,
      mediaReadToken: readTokenFor(worker.id),
    };
    // phase 8c: a box renders from its own copy of the site (which proxies /api here) and pushes to the outputs itself
    if (input.box) job.renderUrl = `${input.box.lanUrl.replace(/\/+$/, "")}/studio-render/${show.id}`;
    const box = await boxJobOutputs(show.id, worker.id);
    if (box && show.recordLocal) {
      // "Record on this box": the box only saves the show — nothing is sent anywhere
      job.outputs = [];
      job.sendToAws = false;
      job.record = true;
    } else if (box) {
      job.outputs = box.outputs;
      job.sendToAws = show.publicListing && !box.youtube;
    }
  }
  return { worker: { id: worker.id, name: worker.name }, job };
}
