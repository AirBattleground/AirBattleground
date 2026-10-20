/**
 * Phase 8 — Studio (shared/studio.ts). The manager's browser mixes the show and POSTs ~1 s WebM/Matroska chunks;
 * here each show's chunks are fed, strictly in order, into one ffmpeg that publishes the broadcast to MediaMTX
 * (live/show_<id>, H.264 + AAC). Once that path is up, copy-only relays push it to the manager's stream-key
 * destinations and (when connected) the site YouTube channel. No chunk for a while → the show ends by itself.
 *
 * A Matroska stream only carries its header in the first chunk, so a recorder session can't be resumed mid-way:
 * if the server doesn't know the session (API restarted, ffmpeg died), it answers RESTART and the browser starts a
 * fresh recorder session (seq 0).
 */
import { spawn, type ChildProcess } from "node:child_process";
import type { Prisma, StudioShow as DbShow } from "@prisma/client";
import type { CreateShowInput, IngestQuery, LiveBroadcastCard, ShowState, StudioOutputs, StudioShow, StudioShowRow, StudioStatus, UpdateShowInput } from "@7xen/shared";
import { env } from "../env.js";
import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { AppError, conflict, notFound } from "../lib/errors.js";
import { brandingUrl } from "../lib/serialize.js";
import { matchContext } from "./matchContext.js";
import { ownerInclude } from "./matches.js";
import { internalCredentials, pathReady, showPath } from "./media.js";
import { destinationTargets, listDestinations } from "./broadcast/layout.js";
import { endMatchBroadcast, getYoutubeStatus, startShowBroadcast, YoutubeError, type MatchBroadcast } from "./youtube.js";

const SHOW_NOT_FOUND = "Show not found";
/** no chunk for this long → the show ends */
const IDLE_END_MS = 25_000;
const RETRY_MS = 4_000;
const VIDEO_KBPS = 6000;

// ---------------------------------------------------------------- CRUD

async function loadOwn(id: string, managerId: string): Promise<DbShow> {
  const s = await prisma.studioShow.findUnique({ where: { id } });
  if (!s || s.managerId !== managerId) throw notFound(SHOW_NOT_FOUND);
  return s;
}

async function matchInfo(matchId: string | null): Promise<StudioShowRow["match"]> {
  if (!matchId) return null;
  const m = await prisma.match.findUnique({ where: { id: matchId }, include: ownerInclude });
  if (!m) return null;
  const ctx = matchContext(m);
  return { id: m.id, title: ctx.title, subtitle: ctx.subtitle };
}

async function toRow(s: DbShow): Promise<StudioShowRow> {
  return {
    id: s.id,
    title: s.title,
    state: s.state as ShowState,
    match: await matchInfo(s.matchId),
    liveSince: s.liveSince?.toISOString() ?? null,
    updatedAt: s.updatedAt.toISOString(),
  };
}

async function toShow(s: DbShow): Promise<StudioShow> {
  return {
    ...(await toRow(s)),
    destinationIds: s.destinationIds,
    publicListing: s.publicListing,
    siteYoutube: s.siteYoutube,
    config: (s.config ?? {}) as Record<string, unknown>,
    watchPath: `/watch/s_${s.id}`,
  };
}

/** The match must belong to this manager (scrim or tournament they run). */
async function assertOwnMatch(matchId: string, managerId: string) {
  const m = await prisma.match.findUnique({ where: { id: matchId }, include: ownerInclude });
  const owner = m?.session?.scrim.managerId ?? m?.group?.stage.tournament.managerId;
  if (!m || owner !== managerId) throw new AppError("VALIDATION_ERROR", "Pick one of your own matches", { matchId: "Not one of your matches" });
}

export async function listShows(managerId: string): Promise<StudioShowRow[]> {
  const rows = await prisma.studioShow.findMany({ where: { managerId }, orderBy: { updatedAt: "desc" }, take: 100 });
  return Promise.all(rows.map(toRow));
}

export async function createShow(managerId: string, input: CreateShowInput): Promise<StudioShow> {
  if (input.matchId) await assertOwnMatch(input.matchId, managerId);
  const s = await prisma.studioShow.create({ data: { managerId, title: input.title, matchId: input.matchId ?? null } });
  return toShow(s);
}

export async function getShow(id: string, managerId: string): Promise<StudioShow> {
  return toShow(await loadOwn(id, managerId));
}

export async function updateShow(id: string, managerId: string, input: UpdateShowInput): Promise<StudioShow> {
  await loadOwn(id, managerId);
  if (input.matchId) await assertOwnMatch(input.matchId, managerId);
  const s = await prisma.studioShow.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.matchId !== undefined ? { matchId: input.matchId } : {}),
      ...(input.destinationIds !== undefined ? { destinationIds: input.destinationIds } : {}),
      ...(input.publicListing !== undefined ? { publicListing: input.publicListing } : {}),
      ...(input.siteYoutube !== undefined ? { siteYoutube: input.siteYoutube } : {}),
      ...(input.config !== undefined ? { config: input.config as Prisma.InputJsonValue } : {}),
    },
  });
  return toShow(s);
}

export async function deleteShow(id: string, managerId: string): Promise<void> {
  const s = await loadOwn(id, managerId);
  if (runners.has(id) || s.state === "LIVE") throw conflict("End the show before deleting it.");
  await prisma.studioShow.delete({ where: { id } });
}

// ---------------------------------------------------------------- ingest → broadcast

interface Relay {
  id: string;
  name: string;
  target: string;
  ok: boolean;
  proc: ChildProcess | null;
  retry: NodeJS.Timeout | null;
}

interface Runner {
  showId: string;
  managerId: string;
  session: string;
  proc: ChildProcess;
  nextSeq: number;
  pending: Map<number, Buffer>;
  lastChunkAt: number;
  relays: Map<string, Relay>;
  relaysStarted: boolean;
  yt: { broadcast: MatchBroadcast | null; error: string | null } | null;
  error: string | null;
  stopping: boolean;
  readyTimer: NodeJS.Timeout | null;
}

const runners = new Map<string, Runner>();

const rtmpInternal = (path: string) => {
  const { user, pass } = internalCredentials();
  return `${env.MEDIA_RTMP_INTERNAL.replace(/\/+$/, "")}/${path}?user=${user}&pass=${pass}`;
};

function ffmpegArgs(showId: string, codec: IngestQuery["codec"]): string[] {
  const video =
    codec === "h264"
      ? ["-c:v", "copy"]
      : ["-c:v", "libx264", "-preset", "superfast", "-tune", "zerolatency", "-b:v", `${VIDEO_KBPS}k`, "-maxrate", `${VIDEO_KBPS}k`, "-bufsize", `${VIDEO_KBPS * 2}k`, "-force_key_frames", "expr:gte(t,n_forced*2)", "-g", "240", "-keyint_min", "60", "-sc_threshold", "0", "-pix_fmt", "yuv420p"];
  return [
    "-hide_banner",
    "-loglevel", "warning",
    "-fflags", "+genpts+discardcorrupt",
    "-f", "matroska",
    "-i", "pipe:0",
    "-map", "0:v:0",
    "-map", "0:a:0?",
    ...video,
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
    "-f", "flv", rtmpInternal(showPath(showId)),
  ];
}

function startRelay(r: Runner, relay: Relay) {
  if (r.stopping) return;
  const proc = spawn(
    env.FFMPEG_PATH,
    ["-hide_banner", "-loglevel", "warning", "-nostats", "-progress", "pipe:1", "-stats_period", "2", "-rw_timeout", "10000000", "-i", rtmpInternal(showPath(r.showId)), "-c", "copy", "-f", "flv", "-rw_timeout", "15000000", relay.target],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  relay.proc = proc;
  let lastSize = 0;
  let tail = "";
  proc.stderr!.setEncoding("utf8");
  proc.stderr!.on("data", (c: string) => (tail = (tail + c).slice(-1500)));
  proc.stdout!.setEncoding("utf8");
  proc.stdout!.on("data", (c: string) => {
    const m = /total_size=(\d+)/.exec(c);
    if (!m || relay.proc !== proc) return;
    const size = Number(m[1]);
    relay.ok = size > lastSize;
    lastSize = size;
  });
  proc.on("exit", (code) => {
    if (relay.proc === proc) relay.proc = null;
    relay.ok = false;
    if (r.stopping || runners.get(r.showId) !== r) return;
    logger.warn({ showId: r.showId, dest: relay.name, code, tail: tail.slice(-300) }, "studio relay exited");
    relay.retry = setTimeout(() => startRelay(r, relay), RETRY_MS);
  });
}

/** Once MediaMTX has the show's stream, start the relays (stream keys + site YouTube). */
async function startRelays(r: Runner) {
  if (r.relaysStarted || r.stopping) return;
  r.relaysStarted = true;
  const show = await prisma.studioShow.findUnique({ where: { id: r.showId } });
  if (!show) return;
  const targets = await destinationTargets(r.managerId, show.destinationIds);
  for (const t of targets) r.relays.set(t.id, { id: t.id, name: t.name, target: t.target, ok: false, proc: null, retry: null });
  if (show.siteYoutube) try {
    const b = await startShowBroadcast({ title: show.title, matchId: show.matchId });
    r.yt = { broadcast: b, error: null };
    if (b) r.relays.set("site-youtube", { id: "site-youtube", name: "AirBattleground YouTube", target: b.target, ok: false, proc: null, retry: null });
  } catch (err) {
    r.yt = { broadcast: null, error: err instanceof YoutubeError ? err.message : "Couldn't reach YouTube." };
  }
  for (const relay of r.relays.values()) startRelay(r, relay);
}

function watchReady(r: Runner) {
  r.readyTimer = setInterval(() => {
    if (r.stopping || r.relaysStarted) return;
    void pathReady(showPath(r.showId)).then((ready) => {
      if (ready && runners.get(r.showId) === r) void startRelays(r);
    });
  }, 1_500);
}

function startRunner(showId: string, managerId: string, session: string, codec: IngestQuery["codec"]): Runner {
  const proc = spawn(env.FFMPEG_PATH, ffmpegArgs(showId, codec), { stdio: ["pipe", "ignore", "pipe"] });
  const r: Runner = {
    showId,
    managerId,
    session,
    proc,
    nextSeq: 0,
    pending: new Map(),
    lastChunkAt: Date.now(),
    relays: new Map(),
    relaysStarted: false,
    yt: null,
    error: null,
    stopping: false,
    readyTimer: null,
  };
  let tail = "";
  proc.stderr!.setEncoding("utf8");
  proc.stderr!.on("data", (c: string) => (tail = (tail + c).slice(-3000)));
  proc.stdin!.on("error", () => undefined); // ffmpeg exited; the exit handler takes over
  proc.on("exit", (code, signal) => {
    if (r.stopping || runners.get(showId) !== r) return;
    logger.warn({ showId, code, signal, tail: tail.slice(-600) }, "studio ffmpeg exited");
    // the browser's next chunk gets RESTART and begins a fresh session
    void teardown(r, false);
  });
  runners.set(showId, r);
  watchReady(r);
  return r;
}

/** Stop a runner's processes. `end` = the show is over (else just this session; the browser restarts it). */
async function teardown(r: Runner, end: boolean) {
  r.stopping = true;
  if (runners.get(r.showId) === r) runners.delete(r.showId);
  if (r.readyTimer) clearInterval(r.readyTimer);
  for (const relay of r.relays.values()) {
    if (relay.retry) clearTimeout(relay.retry);
    if (relay.proc && relay.proc.exitCode === null) relay.proc.kill("SIGINT");
  }
  if (r.proc.exitCode === null) {
    r.proc.stdin?.end();
    setTimeout(() => r.proc.exitCode === null && r.proc.kill("SIGKILL"), 3_000);
  }
  if (end) {
    if (r.yt?.broadcast) void endMatchBroadcast(r.yt.broadcast.broadcastId);
    await prisma.studioShow.update({ where: { id: r.showId }, data: { state: "ENDED" } }).catch(() => undefined);
  }
}

export type IngestResult = { ok: true; live: boolean } | { restart: true };

/** One chunk from the browser. Chunks of a session are written to ffmpeg strictly in seq order. */
export async function ingestChunk(showId: string, managerId: string, q: IngestQuery, body: Buffer): Promise<IngestResult> {
  let r = runners.get(showId);
  if (!r || r.session !== q.session) {
    if (q.seq !== 0) return { restart: true }; // unknown session mid-stream → browser starts over
    await loadOwn(showId, managerId);
    if (r) await teardown(r, false);
    r = startRunner(showId, managerId, q.session, q.codec);
    await prisma.studioShow.update({ where: { id: showId }, data: { state: "LIVE", liveSince: new Date() } });
  }
  if (r.managerId !== managerId) throw notFound(SHOW_NOT_FOUND);
  r.lastChunkAt = Date.now();
  if (q.seq < r.nextSeq) return { ok: true, live: true }; // duplicate (a retried request)
  r.pending.set(q.seq, body);
  while (r.pending.has(r.nextSeq)) {
    const chunk = r.pending.get(r.nextSeq)!;
    r.pending.delete(r.nextSeq);
    r.nextSeq++;
    if (r.proc.stdin && !r.proc.stdin.destroyed) r.proc.stdin.write(chunk);
  }
  if (r.pending.size > 20) {
    // a chunk went missing for good — the stream can't continue without it
    await teardown(r, false);
    return { restart: true };
  }
  return { ok: true, live: true };
}

export async function stopShow(showId: string, managerId: string): Promise<StudioStatus> {
  await loadOwn(showId, managerId);
  const r = runners.get(showId);
  if (r) await teardown(r, true);
  else await prisma.studioShow.update({ where: { id: showId }, data: { state: "ENDED" } });
  return showStatus(showId, managerId);
}

export async function showStatus(showId: string, managerId: string): Promise<StudioStatus> {
  const s = await loadOwn(showId, managerId);
  const r = runners.get(showId);
  const ago = r ? Math.round((Date.now() - r.lastChunkAt) / 1000) : null;
  return {
    state: s.state as ShowState,
    liveSince: s.liveSince?.toISOString() ?? null,
    receiving: !!r && ago !== null && ago < 5,
    lastChunkAgo: ago,
    destinations: r ? [...r.relays.values()].filter((x) => x.id !== "site-youtube").map((x) => ({ id: x.id, name: x.name, ok: x.ok })) : [],
    youtube: r?.yt
      ? r.yt.broadcast
        ? { title: r.yt.broadcast.title, watchUrl: r.yt.broadcast.watchUrl, ok: r.relays.get("site-youtube")?.ok ?? false, error: null }
        : r.yt.error
          ? { title: "AirBattleground YouTube", watchUrl: null, ok: false, error: r.yt.error }
          : null
      : null,
    error: r?.error ?? null,
  };
}

/** Watchdog: end shows whose browser stopped sending. Started once at boot. */
export function startStudioWatchdog() {
  // shows left LIVE by a previous process have no runner any more
  void prisma.studioShow.updateMany({ where: { state: "LIVE" }, data: { state: "IDLE" } }).catch(() => undefined);
  setInterval(() => {
    for (const r of [...runners.values()]) {
      if (Date.now() - r.lastChunkAt > IDLE_END_MS) {
        logger.info({ showId: r.showId }, "studio show idle — ending");
        void teardown(r, true);
      }
    }
  }, 5_000).unref();
}

export async function shutdownStudio() {
  await Promise.all([...runners.values()].map((r) => teardown(r, false)));
}

// ---------------------------------------------------------------- public live list

/** Live Studio shows as Live-page cards (newest first). */
/** Live Studio shows: the public ones, plus `ownerId`'s private (unlisted) ones when given. */
export async function liveShows(ownerId?: string | null): Promise<LiveBroadcastCard[]> {
  const shows = await prisma.studioShow.findMany({
    where: { state: "LIVE", id: { in: [...runners.keys()] }, OR: [{ publicListing: true }, ...(ownerId ? [{ managerId: ownerId }] : [])] },
    include: { manager: { select: { displayName: true, orgName: true, orgLogoKey: true } } },
    orderBy: { liveSince: "desc" },
    take: 50,
  });
  const out: LiveBroadcastCard[] = [];
  for (const s of shows) {
    const m = s.matchId ? await prisma.match.findUnique({ where: { id: s.matchId }, include: ownerInclude }) : null;
    const ctx = m ? matchContext(m) : null;
    out.push({
      matchId: `s_${s.id}`,
      kind: ctx?.kind ?? "SCRIM",
      title: s.title,
      subtitle: ctx ? `${ctx.title} · ${ctx.subtitle}` : "Live show",
      number: m?.number ?? 0,
      map: (m?.map ?? "ERANGEL") as LiveBroadcastCard["map"],
      startedAt: (s.liveSince ?? new Date()).toISOString(),
      hlsUrl: `/api/live/s/${s.id}/index.m3u8`,
      overlayUrl: "",
      organizer: { name: s.manager.orgName ?? s.manager.displayName, logoUrl: brandingUrl(s.manager.orgLogoKey) },
      tournamentId: m?.group?.stage.tournament.id ?? null,
      studio: true,
      ...(s.publicListing ? {} : { unlisted: true }),
    });
  }
  return out;
}

/** Is this show broadcasting publicly (public HLS gate)? Private test streams aren't served. */
/** The manager whose show is live right now (private shows are watchable by them only). */
export const liveShowOwner = (showId: string): string | null => runners.get(showId)?.managerId ?? null;

const listedCache = new Map<string, { at: number; listed: boolean }>();
/** Public HLS gate (called for every playlist/segment request): the listing flag is cached for 3 s. */
export async function showIsLive(showId: string): Promise<boolean> {
  if (!runners.has(showId)) return false;
  const c = listedCache.get(showId);
  if (c && Date.now() - c.at < 3000) return c.listed;
  const s = await prisma.studioShow.findUnique({ where: { id: showId }, select: { publicListing: true } });
  if (listedCache.size > 500) listedCache.clear();
  listedCache.set(showId, { at: Date.now(), listed: !!s?.publicListing });
  return !!s?.publicListing;
}

/** What a manager's show can go out to. */
export async function studioOutputs(managerId: string): Promise<StudioOutputs> {
  const yt = await getYoutubeStatus();
  const dests = await listDestinations(managerId);
  return {
    siteYoutube: yt.connected && yt.autoStream && yt.channel ? { channelTitle: yt.channel.title, channelUrl: yt.channel.url } : null,
    destinations: dests.map((d) => ({ id: d.id, name: d.name, kind: d.kind })),
  };
}
