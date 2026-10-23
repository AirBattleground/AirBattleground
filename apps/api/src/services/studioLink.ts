/**
 * Studio link (shared/studioLink.ts): a standalone 7XEN Studio app connected with a Studio worker key. It renders and
 * encodes the show itself and pushes to every output (stream keys, site-YouTube ingest, the Live page's AWS copy),
 * so its broadcasts are StudioShows started in BOX mode on the key's worker — the server runs no relays for them.
 * Heartbeats count as the worker's poll: the existing watchdog ends the show when they stop for WORKER_GONE_MS.
 */
import type { StudioWorker as DbWorker } from "@prisma/client";
import type {
  StudioLinkBroadcast,
  StudioLinkBroadcastInput,
  StudioLinkHeartbeatInput,
  StudioLinkHeartbeatResponse,
  StudioLinkLive,
  StudioLinkMatch,
  StudioLinkMatchStatus,
  StudioLinkMe,
  StudioLinkOutputs,
  StudioLinkTarget,
  WorkerState,
  MatchStatus,
} from "@7xen/shared";
import { env } from "../env.js";
import { prisma } from "../db.js";
import { conflict, notFound } from "../lib/errors.js";
import type { UploadedImage } from "../lib/upload.js";
import { liveToday } from "./live.js";
import { boardForStudio, controlOf, studioMatch, teamCounts } from "./liveStatus.js";
import { ownerInclude, ownerManagerId, saveLineup, startLineup, uploadScreenshots } from "./matches.js";
import { boxJobOutputs, createShow, endShow, startWorkerShow, studioOutputs, workerRunning } from "./studio.js";
import { publishTokenFor } from "./studioWorkers.js";
import { publicUrl } from "./youtube.js";

const BROADCAST_NOT_FOUND = "Broadcast not found";
const MATCHES_BACK_DAYS = 2;
const MATCHES_AHEAD_DAYS = 14;
const MAX_MATCHES = 100;

/** Every authenticated studio-link call: the connected studio shows online on the website. */
export async function touch(worker: DbWorker): Promise<void> {
  const now = new Date();
  await prisma.studioWorker.update({ where: { id: worker.id }, data: { linkSeenAt: now, lastSeenAt: now } });
}

export async function me(worker: DbWorker): Promise<StudioLinkMe> {
  const m = await prisma.user.findUniqueOrThrow({ where: { id: worker.managerId }, select: { displayName: true, orgName: true } });
  return { manager: { name: m.displayName }, org: m.orgName ? { name: m.orgName } : null };
}

function linkStatus(s: MatchStatus): StudioLinkMatchStatus {
  if (s === "LIVE") return "live";
  if (s === "RESULTS_REVIEW" || s === "PUBLISHED") return "done";
  return "upcoming";
}

const ORDER: Record<StudioLinkMatchStatus, number> = { live: 0, upcoming: 1, done: 2 };

/** Recent + upcoming matches: live first, then upcoming (soonest first), then done (latest first); each with its control. */
export async function matches(worker: DbWorker, now = new Date()): Promise<StudioLinkMatch[]> {
  const cards = await liveToday(worker.managerId, MATCHES_AHEAD_DAYS, now, MATCHES_BACK_DAYS);
  const rows = await prisma.match.findMany({ where: { id: { in: cards.map((c) => c.matchId) } }, include: ownerInclude });
  const counts = await teamCounts(rows);
  const control = new Map(rows.map((m) => [m.id, controlOf(m, counts.get(m.id) ?? 0, now)]));
  const items = cards
    .filter((c) => control.has(c.matchId))
    .map((c) => ({ id: c.matchId, title: c.title, subtitle: c.subtitle, startsAt: c.startsAt, status: linkStatus(c.status), control: control.get(c.matchId)! }));
  items.sort((a, b) => {
    if (a.status !== b.status) return ORDER[a.status] - ORDER[b.status];
    const cmp = (a.startsAt ?? "9999").localeCompare(b.startsAt ?? "9999");
    return a.status === "done" ? -cmp : cmp;
  });
  return items.slice(0, MAX_MATCHES);
}

export async function outputs(worker: DbWorker): Promise<StudioLinkOutputs> {
  const o = await studioOutputs(worker.managerId);
  return { livePage: true, siteYoutube: o.siteYoutube ? { channelTitle: o.siteYoutube.channelTitle } : null, destinations: o.destinations };
}

/** Create (or reuse an IDLE studio-link show for the same match) and start it in box mode on this studio. */
export async function startBroadcast(worker: DbWorker, input: Required<StudioLinkBroadcastInput>): Promise<StudioLinkBroadcast> {
  const managerId = worker.managerId;
  const busy = await prisma.studioShow.findFirst({ where: { state: "LIVE", runOn: "worker", workerId: worker.id }, select: { id: true } });
  if (busy) throw conflict("This studio is already broadcasting. Stop that broadcast first.");

  const reuse = input.matchId
    ? await prisma.studioShow.findFirst({ where: { managerId, matchId: input.matchId, studioLink: true, state: "IDLE" }, orderBy: { updatedAt: "desc" } })
    : null;
  const showId = reuse?.id ?? (await createShow(managerId, { title: input.title, matchId: input.matchId })).id;
  // public streams are visible to everyone: a show going out on the (public) site YouTube channel is always listed on
  // the Live page — it plays the YouTube video there — even when the studio switched the Live page output off
  const onSiteYoutube = input.siteYoutube && !!(await studioOutputs(managerId)).siteYoutube;
  await prisma.studioShow.update({
    where: { id: showId },
    data: {
      title: input.title,
      matchId: input.matchId,
      publicListing: input.livePage || onSiteYoutube,
      siteYoutube: input.siteYoutube,
      destinationIds: input.destinationIds,
      recordLocal: false,
      studioLink: true,
    },
  });
  await startWorkerShow(showId, managerId, worker.id, { box: true });
  await prisma.studioWorker.update({ where: { id: worker.id }, data: { showId, state: "starting", error: null } });

  const box = await boxJobOutputs(showId, worker.id);
  const targets: StudioLinkTarget[] = box?.outputs ?? [];
  if (input.livePage && !box?.youtube) {
    // the Live page plays its own copy from AirBattleground's media server (worker publish token)
    targets.push({
      id: "live-page",
      name: "AirBattleground Live page",
      url: `${env.MEDIA_RTMP_URL.replace(/\/+$/, "")}/show_${showId}?wtoken=${publishTokenFor(showId, worker.id)}`,
    });
  }
  const watchUrl = box?.youtubeWatchUrl ?? (input.livePage ? `${publicUrl()}/watch/s_${showId}` : null);
  return { id: showId, targets, watchUrl };
}

async function loadLinkShow(worker: DbWorker, showId: string) {
  const s = await prisma.studioShow.findUnique({ where: { id: showId } });
  if (!s || s.managerId !== worker.managerId) throw notFound(BROADCAST_NOT_FOUND);
  return s;
}

const WORKER_STATES: WorkerState[] = ["idle", "starting", "live", "error"];
function toWorkerState(state: string): WorkerState {
  const s = state.toLowerCase();
  if ((WORKER_STATES as string[]).includes(s)) return s as WorkerState;
  if (s === "streaming" || s === "running" || s === "on-air") return "live";
  if (s === "failed") return "error";
  return "starting"; // connecting / reconnecting / …
}

export async function heartbeat(worker: DbWorker, showId: string, input: Required<StudioLinkHeartbeatInput>): Promise<StudioLinkHeartbeatResponse> {
  const s = await loadLinkShow(worker, showId);
  const stop = s.state !== "LIVE" || s.workerId !== worker.id || !workerRunning(showId, worker.id);
  await prisma.studioWorker.update({
    where: { id: worker.id },
    data: stop
      ? { state: "idle", showId: null, fps: null, bitrateKbps: null }
      : { state: toWorkerState(input.state), showId, fps: input.fps, bitrateKbps: input.bitrateKbps, error: null },
  });
  return { stop };
}

export async function stopBroadcast(worker: DbWorker, showId: string): Promise<void> {
  const s = await loadLinkShow(worker, showId);
  if (s.state === "LIVE" && s.workerId === worker.id) await endShow(showId);
  await prisma.studioWorker.update({ where: { id: worker.id }, data: { state: "idle", showId: null, fps: null, bitrateKbps: null } });
}

export async function screenshots(worker: DbWorker, matchId: string, kind: "SLOT_LIST" | "RESULTS", images: UploadedImage[]): Promise<{ count: number }> {
  const { items } = await uploadScreenshots(matchId, worker.managerId, kind, images, false, "STUDIO");
  return { count: items.length };
}

// ---------------------------------------------------------------- start / stop (the studio runs the match)

/** Start: confirm the lineup (what was read from the lobby + registered rosters) — the match goes live. */
export async function startMatch(worker: DbWorker, matchId: string, now = new Date()): Promise<StudioLinkLive> {
  const m = await studioMatch(matchId, worker.managerId);
  const c = controlOf(m, (await teamCounts([m])).get(m.id) ?? 0, now);
  if (c.state === "locked") throw conflict(`Not yet — ${c.reason}. The match unlocks when registration closes or every slot is filled.`);
  if (c.state === "live") throw conflict("This match is already live.");
  if (c.state !== "ready") throw conflict("This match has ended. Pick the next match.");
  await saveLineup(matchId, ownerManagerId(m)!, await startLineup(matchId), true);
  return boardForStudio(matchId, worker.managerId);
}

/** Stop: the match ends and waits for results screenshots; the manager publishes. */
export async function stopMatch(worker: DbWorker, matchId: string): Promise<StudioLinkLive> {
  const m = await studioMatch(matchId, worker.managerId);
  const { count } = await prisma.match.updateMany({ where: { id: matchId, status: "LIVE" }, data: { status: "RESULTS_REVIEW" } });
  if (count === 0) throw conflict(m.status === "LIVE" ? "This match just changed. Try again." : "This match isn't live.");
  return boardForStudio(matchId, worker.managerId);
}
