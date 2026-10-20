/**
 * Phase 6b: the broadcast output for one device = phone video (from MediaMTX) + layout overlay → one H.264 stream,
 * published back to MediaMTX as live/out_<deviceId> (7xen viewers, via the HLS proxy). Each destination (YouTube,
 * Facebook, RTMP) gets its own copy-only relay ffmpeg reading that output, so a slow or dead destination never stalls
 * the 7xen output or the other destinations, and each one reconnects on its own.
 *
 * The overlay is rendered here (render.ts) twice a second and piped into ffmpeg as PNG frames (image2pipe; both inputs
 * use wall-clock timestamps so they line up). ffmpeg exits when the phone stops → we retry every few seconds while the
 * output is wanted. The wanted state lives in Device.outputOn so outputs come back after an API restart.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { OUTPUT_HEIGHT, OUTPUT_WIDTH, type DeviceOutput, type GameMap, type OutputState } from "@7xen/shared";
import { env } from "../../env.js";
import { prisma } from "../../db.js";
import { logger } from "../../logger.js";
import { matchContext } from "../matchContext.js";
import { ownerInclude } from "../matches.js";
import { devicePath, deviceStreamReady, internalCredentials, outputPath } from "../media.js";
import { overlayDataForMatch, sampleOverlayData, type OverlayData } from "./data.js";
import { destinationTargets, loadLayout, sponsorPaths } from "./layout.js";
import { renderOverlay } from "./render.js";
import { endMatchBroadcast, startMatchBroadcast, YoutubeError, type MatchBroadcast } from "../youtube.js";

const OVERLAY_EVERY_MS = 500;
const RETRY_MS = 4_000;
const VIDEO_KBPS = 3000;

interface Runner {
  deviceId: string;
  managerId: string;
  destIds: string[];
  destinations: { id: string; name: string; kind: DeviceOutput["destinations"][number]["kind"]; ok: boolean }[];
  state: OutputState;
  startedAt: Date;
  /** when the composed stream last went live (LIVE timer) */
  liveSince: Date | null;
  error: string | null;
  proc: ChildProcess | null;
  relays: Map<string, { proc: ChildProcess | null; retry: NodeJS.Timeout | null }>;
  overlayTimer: NodeJS.Timeout | null;
  retryTimer: NodeJS.Timeout | null;
  stopping: boolean;
  rendering: boolean;
  /** phase 7b: this output's broadcast on the site YouTube channel (kept across reconnects) */
  yt: { matchId: string; broadcast: MatchBroadcast | null; error: string | null; triedAt: number } | null;
}

const runners = new Map<string, Runner>();
const SITE_YOUTUBE_ID = "site-youtube";
/** after YouTube refused, wait this long before asking again (quota) */
const YT_RETRY_MS = 60_000;

/** The site YouTube channel as an extra relay target, when it's connected and the device shows a match. */
async function youtubeTargets(r: Runner): Promise<{ id: string; name: string; kind: "YOUTUBE"; target: string }[]> {
  const d = await prisma.device.findUnique({ where: { id: r.deviceId }, select: { matchId: true } });
  const matchId = d?.matchId ?? null;
  const asTarget = (b: MatchBroadcast) => [{ id: SITE_YOUTUBE_ID, name: "AirBattleground YouTube", kind: "YOUTUBE" as const, target: b.target }];
  if (!matchId) return [];
  if (r.yt && r.yt.matchId === matchId) {
    if (r.yt.broadcast) return asTarget(r.yt.broadcast);
    if (Date.now() - r.yt.triedAt < YT_RETRY_MS) return [];
  } else if (r.yt?.broadcast) {
    void endMatchBroadcast(r.yt.broadcast.broadcastId); // the device moved to another match between reconnects
  }
  try {
    const b = await startMatchBroadcast(matchId);
    r.yt = { matchId, broadcast: b, error: null, triedAt: Date.now() };
    return b ? asTarget(b) : [];
  } catch (err) {
    r.yt = { matchId, broadcast: null, error: err instanceof YoutubeError ? err.message : "Couldn't reach YouTube.", triedAt: Date.now() };
    return [];
  }
}

export function outputStateOf(deviceId: string): OutputState {
  return runners.get(deviceId)?.state ?? "OFF";
}

const rtmpInternal = (path: string) => {
  const { user, pass } = internalCredentials();
  return `${env.MEDIA_RTMP_INTERNAL.replace(/\/+$/, "")}/${path}?user=${user}&pass=${pass}`;
};

/** The device's current overlay data: its match, or sample data when none is picked. */
async function overlayData(deviceId: string, managerId: string): Promise<OverlayData> {
  const d = await prisma.device.findUnique({ where: { id: deviceId }, select: { matchId: true } });
  return d?.matchId ? overlayDataForMatch(d.matchId, managerId) : sampleOverlayData(managerId);
}

async function renderFor(r: Runner): Promise<Buffer> {
  const [layout, data] = await Promise.all([loadLayout(r.managerId), overlayData(r.deviceId, r.managerId)]);
  return renderOverlay(layout.config, data, { sponsorPaths: sponsorPaths(layout.config, layout.sponsors), liveSince: r.liveSince });
}

function ffmpegArgs(deviceId: string): string[] {
  const W = OUTPUT_WIDTH;
  const H = OUTPUT_HEIGHT;
  return [
    "-hide_banner",
    "-loglevel", "warning",
    // 0: the phone (live RTMP from MediaMTX)
    "-use_wallclock_as_timestamps", "1",
    "-rw_timeout", "10000000",
    "-i", rtmpInternal(devicePath(deviceId)),
    // 1: overlay PNGs written to stdin (tiny probe: the default 5 MB probe would wait ~25 s for PNGs to pile up)
    "-use_wallclock_as_timestamps", "1",
    "-probesize", "32", "-analyzeduration", "0",
    "-f", "image2pipe", "-c:v", "png",
    "-i", "pipe:0",
    "-filter_complex",
    `[0:v]setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,fps=30[bg];` +
      `[1:v]setpts=PTS-STARTPTS,scale=${W}:${H},format=rgba[ov];` +
      `[bg][ov]overlay=0:0:eof_action=repeat:repeatlast=1:format=auto,format=yuv420p[out]`,
    "-map", "[out]",
    "-map", "0:a?",
    "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
    "-b:v", `${VIDEO_KBPS}k`, "-maxrate", `${VIDEO_KBPS}k`, "-bufsize", `${VIDEO_KBPS * 2}k`,
    "-g", "60", "-keyint_min", "60", "-sc_threshold", "0",
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
    "-f", "flv", rtmpInternal(outputPath(deviceId)),
  ];
}

const plainError = (line: string): string | null => {
  if (/401|unauthorized|authentication/i.test(line)) return "A destination refused the stream key. Check the key and start again.";
  if (/Connection refused|timed out|Network is unreachable|Input\/output error/i.test(line)) return "Couldn't reach a destination. Retrying…";
  return null;
};

async function launch(r: Runner) {
  if (r.stopping) return;
  if (!(await deviceStreamReady(r.deviceId))) {
    r.state = "RECONNECTING";
    r.error = "Waiting for the phone's video…";
    r.retryTimer = setTimeout(() => void launch(r), RETRY_MS);
    return;
  }
  const targets = [...(await destinationTargets(r.managerId, r.destIds)), ...(await youtubeTargets(r))];
  // not ok until a relay is actually sending
  r.destinations = targets.map((t) => ({ id: t.id, name: t.name, kind: t.kind, ok: false }));

  let first: Buffer;
  try {
    first = await renderFor(r);
  } catch (err) {
    logger.error({ err, deviceId: r.deviceId }, "overlay render failed");
    r.state = "ERROR";
    r.error = "Couldn't draw the layout. Check the layout settings.";
    r.retryTimer = setTimeout(() => void launch(r), RETRY_MS * 2);
    return;
  }

  const proc = spawn(env.FFMPEG_PATH, ffmpegArgs(r.deviceId), { stdio: ["pipe", "ignore", "pipe"] });
  r.proc = proc;
  r.state = "STARTING";
  r.error = null;
  proc.stdin!.on("error", () => undefined); // ffmpeg exited; the exit handler takes over
  proc.stdin!.write(first);

  // LIVE once the video server is receiving the composed stream
  let liveTimer: NodeJS.Timeout | null = setInterval(() => {
    if (r.proc !== proc || r.state === "LIVE") return;
    void deviceStreamReady(r.deviceId, true).then((ready) => {
      if (ready && r.proc === proc) {
        r.state = "LIVE";
        r.error = null;
        r.liveSince ??= new Date();
        for (const t of targets) if (!r.relays.has(t.id)) startRelay(r, t);
      }
    });
  }, 1_000);

  r.overlayTimer = setInterval(() => {
    if (r.rendering || r.proc !== proc || !proc.stdin || proc.stdin.destroyed) return;
    r.rendering = true;
    renderFor(r)
      .then((png) => {
        if (r.proc === proc && proc.stdin && !proc.stdin.destroyed) proc.stdin.write(png);
      })
      .catch((err) => logger.warn({ err: (err as Error).message, deviceId: r.deviceId }, "overlay render failed"))
      .finally(() => {
        r.rendering = false;
      });
  }, OVERLAY_EVERY_MS);

  let tail = "";
  proc.stderr!.setEncoding("utf8");
  proc.stderr!.on("data", (chunk: string) => {
    tail = (tail + chunk).slice(-4000);
  });

  proc.on("exit", (code, signal) => {
    if (liveTimer) clearInterval(liveTimer);
    liveTimer = null;
    if (r.overlayTimer) clearInterval(r.overlayTimer);
    r.overlayTimer = null;
    if (r.proc === proc) r.proc = null;
    if (r.stopping) return;
    stopRelays(r);
    logger.warn({ deviceId: r.deviceId, code, signal, tail: tail.slice(-600) }, "broadcast output ffmpeg exited");
    r.state = "RECONNECTING";
    r.error = plainError(tail) ?? "The phone's video stopped. Reconnecting when it's back…";
    r.retryTimer = setTimeout(() => void launch(r), RETRY_MS);
  });
}

/** Copy the composed output to one destination; reconnects every few seconds while the output runs. */
function startRelay(r: Runner, t: { id: string; name: string; target: string }) {
  const slot = r.relays.get(t.id) ?? { proc: null, retry: null };
  r.relays.set(t.id, slot);
  if (r.stopping) return;
  const dest = r.destinations.find((x) => x.id === t.id);
  const proc = spawn(
    env.FFMPEG_PATH,
    [
      "-hide_banner", "-loglevel", "warning", "-nostats", "-progress", "pipe:1", "-stats_period", "2",
      "-rw_timeout", "10000000", "-i", rtmpInternal(outputPath(r.deviceId)),
      "-c", "copy", "-f", "flv", "-rw_timeout", "15000000", t.target,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  slot.proc = proc;
  let tail = "";
  proc.stderr!.setEncoding("utf8");
  proc.stderr!.on("data", (c: string) => (tail = (tail + c).slice(-2000)));
  // healthy = bytes are actually leaving for the destination (total_size keeps growing)
  let lastSize = 0;
  proc.stdout!.setEncoding("utf8");
  proc.stdout!.on("data", (c: string) => {
    const m = /total_size=(\d+)/.exec(c);
    if (!m || slot.proc !== proc || !dest) return;
    const size = Number(m[1]);
    const ok = size > lastSize;
    lastSize = size;
    dest.ok = ok;
    if (!ok) r.error = `${t.name} isn't taking the stream. Retrying…`;
    else if (r.error && r.destinations.every((d) => d.ok)) r.error = null;
  });
  proc.on("exit", (code) => {
    if (slot.proc === proc) slot.proc = null;
    // stopped on purpose (output stopped, or the compositor restarted and cleared its relays)
    if (r.stopping || runners.get(r.deviceId) !== r || r.relays.get(t.id) !== slot) return;
    if (dest) dest.ok = false;
    r.error = plainError(tail) ?? `${t.name} stopped receiving the stream. Retrying…`;
    logger.warn({ deviceId: r.deviceId, dest: t.name, code, tail: tail.slice(-300) }, "broadcast relay exited");
    slot.retry = setTimeout(() => startRelay(r, t), RETRY_MS);
  });
}

function stopRelays(r: Runner) {
  for (const slot of r.relays.values()) {
    if (slot.retry) clearTimeout(slot.retry);
    if (slot.proc && slot.proc.exitCode === null) slot.proc.kill("SIGINT");
  }
  r.relays.clear();
}

// ---------------------------------------------------------------- public

/** Start (or restart with new destinations) the output of a device the caller owns. */
export async function startOutput(deviceId: string, managerId: string, destIds: string[]): Promise<void> {
  await stopRunner(deviceId);
  const r: Runner = {
    deviceId,
    managerId,
    destIds,
    destinations: [],
    state: "STARTING",
    startedAt: new Date(),
    liveSince: null,
    error: null,
    proc: null,
    relays: new Map(),
    overlayTimer: null,
    retryTimer: null,
    stopping: false,
    rendering: false,
    yt: null,
  };
  runners.set(deviceId, r);
  await prisma.device.update({ where: { id: deviceId }, data: { outputOn: true, outputDestIds: destIds, outputStartedAt: r.startedAt } });
  await launch(r);
}

async function stopRunner(deviceId: string) {
  const r = runners.get(deviceId);
  if (!r) return;
  r.stopping = true;
  stopRelays(r);
  if (r.yt?.broadcast) void endMatchBroadcast(r.yt.broadcast.broadcastId);
  if (r.retryTimer) clearTimeout(r.retryTimer);
  if (r.overlayTimer) clearInterval(r.overlayTimer);
  const p = r.proc;
  if (p && p.exitCode === null) {
    await new Promise<void>((resolve) => {
      const kill = setTimeout(() => p.kill("SIGKILL"), 3_000);
      p.once("exit", () => {
        clearTimeout(kill);
        resolve();
      });
      p.stdin?.end();
      p.kill("SIGINT");
    });
  }
  runners.delete(deviceId);
}

export async function stopOutput(deviceId: string): Promise<void> {
  await stopRunner(deviceId);
  await prisma.device.update({ where: { id: deviceId }, data: { outputOn: false, outputStartedAt: null } }).catch(() => undefined);
}

export async function outputInfo(deviceId: string): Promise<DeviceOutput> {
  const r = runners.get(deviceId);
  const d = await prisma.device.findUnique({ where: { id: deviceId }, include: { match: { include: ownerInclude } } });
  const ctx = d?.match ? matchContext(d.match) : null;
  const match = d?.match && ctx ? { id: d.match.id, title: ctx.title, subtitle: ctx.subtitle, map: d.match.map as GameMap } : null;
  return {
    state: r?.state ?? "OFF",
    startedAt: r?.startedAt.toISOString() ?? null,
    destinations: r?.destinations ?? [],
    error: r?.error ?? null,
    hlsUrl: r ? `/api/manager/devices/${deviceId}/output/live/index.m3u8` : null,
    match,
    youtube: r?.yt
      ? r.yt.broadcast
        ? {
            title: r.yt.broadcast.title,
            watchUrl: r.yt.broadcast.watchUrl,
            ok: r.destinations.find((x) => x.id === SITE_YOUTUBE_ID)?.ok ?? false,
            error: null,
          }
        : r.yt.error
          ? { title: "AirBattleground YouTube", watchUrl: null, ok: false, error: r.yt.error }
          : null
      : null,
  };
}

/** Bring back outputs that were on before the API restarted. */
export async function resumeOutputs(): Promise<void> {
  const on = await prisma.device.findMany({ where: { outputOn: true }, select: { id: true, managerId: true, outputDestIds: true } });
  for (const d of on) {
    logger.info({ deviceId: d.id }, "resuming broadcast output");
    void startOutput(d.id, d.managerId, d.outputDestIds).catch((err) => logger.error({ err, deviceId: d.id }, "resume output failed"));
  }
}

/** Stop every output (API shutdown) without changing what's wanted in the DB. */
export async function shutdownOutputs(): Promise<void> {
  await Promise.all([...runners.keys()].map(stopRunner));
}
