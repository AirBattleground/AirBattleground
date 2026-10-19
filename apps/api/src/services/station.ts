/**
 * Phase 4b: 7XEN Station integration — the manager (or admin) runs a match on the station PC's emulator,
 * which records it (MatchRecording, deviceName "7XEN Station") and streams it live over HLS to the
 * manager, the admin and the teams playing in that match.
 *
 * The station writes the HLS files into STORAGE_DIR/live/<matchId>/ and the final MP4 into VIDEO_DIR;
 * the API serves the former (viewer auth below) and post-processes the latter (complete hook).
 */
import { readFile, rm, stat } from "node:fs/promises";
import type { MatchRecording, Prisma } from "@prisma/client";
import {
  STATION_DEVICE_NAME,
  type GameMap,
  type MatchLive,
  type MatchLiveInfo,
  type RecordingEvent,
  type ScreenshotKind,
  type ScreenshotRow,
  type StationCaptureResponse,
  type StationCompleteInput,
  type StationDeviceStartInput,
  type StationDeviceStopInput,
  type StationFailInput,
  type StationInput,
  type StationPrepareInput,
  type StationStatus,
  type TeamLiveCard,
} from "@7xen/shared";
import { prisma } from "../db.js";
import { AppError, conflict, notFound } from "../lib/errors.js";
import { fetchStationStatus, stationCall, stationOffline } from "../lib/stationClient.js";
import { imageInfo, resolveKey, sha256 } from "../lib/storage.js";
import type { UploadedImage } from "../lib/upload.js";
import { resolveVideoKey, videoKeyFor } from "../lib/video.js";
import { matchContext } from "./matchContext.js";
import { loadOwnMatch, ownerInclude, ownerManagerId, toScreenshotRow, uploadScreenshots, type MatchWithOwner } from "./matches.js";
import { eventsOf, MAX_EVENTS, processVideo, startRecording } from "./recordings.js";

const ACTIVE_PHASES: StationStatus["phase"][] = ["STARTING_EMULATOR", "LAUNCHING_BGMI", "LIVE", "STOPPING"];
/** after a stop, the final playlist stays watchable this long (the station deletes the files after ~10 min) */
const REPLAY_WINDOW_MS = 15 * 60_000;

const hlsUrlFor = (matchId: string) => `/api/live/${matchId}/index.m3u8`;
export const MATCH_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const titleOf = (m: MatchWithOwner) => {
  const ctx = matchContext(m);
  return `${ctx.title} · ${ctx.subtitle}`;
};

async function latestStationRecording(matchId: string): Promise<MatchRecording | null> {
  return prisma.matchRecording.findFirst({ where: { matchId, deviceName: STATION_DEVICE_NAME }, orderBy: { startedAt: "desc" } });
}

async function addEvents(id: string, events: RecordingEvent[], data: Prisma.MatchRecordingUpdateInput = {}) {
  const r = await prisma.matchRecording.findUnique({ where: { id } });
  if (!r) return null;
  return prisma.matchRecording.update({
    where: { id },
    data: { ...data, events: [...eventsOf(r.events), ...events].slice(-MAX_EVENTS) as unknown as Prisma.InputJsonValue },
  });
}

const event = (type: RecordingEvent["type"], detail: string | null = null): RecordingEvent => ({ at: new Date().toISOString(), type, detail });

// ---------------------------------------------------------------- status

/** Station status (never throws) with the busy match's title filled in. */
export async function stationStatus(): Promise<StationStatus> {
  const s = await fetchStationStatus();
  s.matchTitle = null;
  if (s.matchId && MATCH_ID_RE.test(s.matchId)) {
    const m = await prisma.match.findUnique({ where: { id: s.matchId }, include: ownerInclude });
    s.matchTitle = m ? titleOf(m) : null;
  }
  return s;
}

function toMatchLive(matchId: string, station: StationStatus, rec: MatchRecording | null): MatchLive {
  const streaming = station.online && station.matchId === matchId && station.phase === "LIVE";
  return {
    matchId,
    streaming,
    hlsUrl: streaming ? hlsUrlFor(matchId) : null,
    startedAt: streaming ? station.startedAt : null,
    recordingId: (station.matchId === matchId ? station.recordingId : null) ?? rec?.id ?? null,
    station,
  };
}

export async function getMatchLive(matchId: string, userId: string, bypass = false): Promise<MatchLive> {
  await loadOwnMatch(matchId, userId, bypass);
  const [station, rec] = await Promise.all([stationStatus(), latestStationRecording(matchId)]);
  return toMatchLive(matchId, station, rec);
}

// ---------------------------------------------------------------- prepare / stop

export async function prepare(matchId: string, userId: string, input: StationPrepareInput, bypass = false): Promise<MatchLive> {
  const m = await loadOwnMatch(matchId, userId, bypass);
  const station = await stationStatus();
  if (!station.online) throw stationOffline();
  if (ACTIVE_PHASES.includes(station.phase)) {
    if (station.matchId === matchId && station.phase !== "STOPPING") return toMatchLive(matchId, station, await latestStationRecording(matchId));
    throw conflict(
      station.phase === "STOPPING" && station.matchId === matchId
        ? "The station is still saving this match's recording. Try again in a moment."
        : `The station is busy with ${station.matchTitle ?? "another match"}. Stop that match first.`,
    );
  }
  const owner = ownerManagerId(m) ?? userId;
  const row = await startRecording(matchId, owner, { deviceName: STATION_DEVICE_NAME, appVersion: station.version ? `station ${station.version}` : undefined }, true);
  const videoKey = videoKeyFor(row.id, "mp4", new Date(row.startedAt));
  let next: StationStatus;
  try {
    next = await stationCall<StationStatus>(
      "POST",
      "/sessions",
      { matchId, recordingId: row.id, title: titleOf(m), videoKey, launchBgmi: input.launchBgmi, bitrateMbps: input.bitrateMbps, maxFps: input.maxFps },
      30_000,
    );
  } catch (err) {
    await addEvents(row.id, [event("error", (err as Error).message.slice(0, 300))], { status: "FAILED", endedAt: new Date(), error: (err as Error).message.slice(0, 300) });
    throw err;
  }
  next = { ...next, online: true, matchTitle: titleOf(m) };
  return toMatchLive(matchId, next, await prisma.matchRecording.findUnique({ where: { id: row.id } }));
}

export async function stop(matchId: string, userId: string, bypass = false): Promise<MatchLive> {
  await loadOwnMatch(matchId, userId, bypass);
  const station = await stationStatus();
  if (!station.online) throw stationOffline();
  const rec = await latestStationRecording(matchId);
  if (station.matchId !== matchId || !ACTIVE_PHASES.includes(station.phase)) {
    // nothing running here; a recording still marked LIVE was lost (station restarted without it)
    if (rec?.status === "LIVE") {
      await addEvents(rec.id, [event("error", "The station is no longer recording this match")], {
        status: "FAILED",
        endedAt: new Date(),
        error: "The station stopped recording unexpectedly",
      });
    }
    return toMatchLive(matchId, station, await latestStationRecording(matchId));
  }
  const recId = station.recordingId ?? rec?.id;
  if (recId) {
    const r = await prisma.matchRecording.findUnique({ where: { id: recId } });
    if (r?.status === "LIVE") await addEvents(recId, [event("stop")], { status: "STOPPED", endedAt: new Date() });
  }
  const next = await stationCall<StationStatus>("POST", "/sessions/stop", { matchId });
  return toMatchLive(matchId, { ...next, online: true, matchTitle: station.matchTitle }, recId ? await prisma.matchRecording.findUnique({ where: { id: recId } }) : rec);
}

// ---------------------------------------------------------------- BlueStacks device (start/stop the emulator on its own)

/** Station must be reachable and not held by ANOTHER match. */
async function deviceGate(matchId: string): Promise<StationStatus> {
  const station = await stationStatus();
  if (!station.online) throw stationOffline();
  if (ACTIVE_PHASES.includes(station.phase) && station.matchId !== matchId) {
    throw conflict(`The station is busy with ${station.matchTitle ?? "another match"}. Stop that match first.`);
  }
  return station;
}

export async function deviceStart(matchId: string, userId: string, input: StationDeviceStartInput, bypass = false): Promise<StationStatus> {
  await loadOwnMatch(matchId, userId, bypass);
  await deviceGate(matchId);
  const next = await stationCall<StationStatus>("POST", "/device/start", input, 30_000);
  return { ...next, online: true, matchTitle: null };
}

export async function deviceStop(matchId: string, userId: string, input: StationDeviceStopInput, bypass = false): Promise<StationStatus> {
  await loadOwnMatch(matchId, userId, bypass);
  const station = await deviceGate(matchId);
  if (ACTIVE_PHASES.includes(station.phase)) throw conflict("A match is recording on the station. End the match first, then shut down the emulator.");
  const next = await stationCall<StationStatus>("POST", "/device/stop", input, 30_000);
  return { ...next, online: true, matchTitle: null };
}

// ---------------------------------------------------------------- capture / input

/** Store a station PNG as a STATION screenshot (normal reader pipeline). A repeat of the same image returns the existing row. */
async function ingestStationImage(m: MatchWithOwner, kind: ScreenshotKind, buf: Buffer): Promise<ScreenshotRow> {
  const info = imageInfo(buf);
  if (!info) throw new AppError("INTERNAL", "The station sent an unreadable screenshot", undefined, 502);
  const hash = sha256(buf);
  const existing = await prisma.screenshot.findFirst({ where: { matchId: m.id, sha256: hash } });
  if (existing) return toScreenshotRow(existing);
  const img: UploadedImage = { buffer: buf, originalName: "station.png", info, sha256: hash };
  const { items } = await uploadScreenshots(m.id, ownerManagerId(m) ?? "", kind, [img], true, "STATION");
  if (items[0]) return items[0];
  const again = await prisma.screenshot.findFirst({ where: { matchId: m.id, sha256: hash } });
  if (!again) throw new AppError("INTERNAL", "The screenshot couldn't be saved");
  return toScreenshotRow(again);
}

export async function capture(matchId: string, userId: string, kind: ScreenshotKind, bypass = false): Promise<ScreenshotRow> {
  const m = await loadOwnMatch(matchId, userId, bypass);
  if (m.status === "PUBLISHED") throw conflict("Results are published. Unpublish the match to add screenshots.");
  const { file } = await stationCall<StationCaptureResponse>("POST", "/sessions/capture", { matchId, kind }, 45_000);
  if (typeof file !== "string" || !file.startsWith("station/captures/")) throw new AppError("INTERNAL", "The station returned an invalid file", undefined, 502);
  const abs = resolveKey(file);
  let buf: Buffer;
  try {
    buf = await readFile(abs);
  } catch {
    throw new AppError("INTERNAL", "The station's screenshot couldn't be read. Check that the station and the API share the same storage folder.", undefined, 502);
  }
  const row = await ingestStationImage(m, kind, buf);
  await rm(abs, { force: true });
  const rec = await latestStationRecording(matchId);
  if (rec?.status === "LIVE") await addEvents(rec.id, [event("capture", kind)]);
  return row;
}

export async function input(matchId: string, userId: string, data: StationInput, bypass = false): Promise<void> {
  await loadOwnMatch(matchId, userId, bypass);
  await stationCall<void>("POST", "/sessions/input", { matchId, ...data }, 15_000);
}

// ---------------------------------------------------------------- internal hooks (station → API)

async function loadStationRecording(id: string) {
  const r = await prisma.matchRecording.findUnique({ where: { id } });
  if (!r || r.deviceName !== STATION_DEVICE_NAME) throw notFound("Recording not found");
  return r;
}

export async function completeHook(id: string, input: StationCompleteInput): Promise<void> {
  const r = await loadStationRecording(id);
  if (r.status === "READY" || r.status === "PROCESSING") return; // repeat (station retry)
  if (r.status === "DELETED") throw conflict("This recording was deleted");
  const abs = resolveVideoKey(input.videoKey);
  let size: number;
  try {
    const st = await stat(abs);
    if (!st.isFile()) throw new Error("not a file");
    size = st.size;
  } catch {
    throw new AppError("VALIDATION_ERROR", "The video file isn't in the video folder");
  }
  await addEvents(id, r.status === "LIVE" ? [event("stop")] : [], {
    status: "PROCESSING",
    videoKey: input.videoKey,
    sizeBytes: BigInt(size),
    uploadedBytes: BigInt(size),
    endedAt: r.endedAt ?? new Date(),
    ...(input.durationSec != null ? { durationSec: input.durationSec } : {}),
    ...(r.status === "FAILED" ? { error: null } : {}),
  });
  await processVideo(id, input.videoKey, r.startedAt);
}

export async function failHook(id: string, input: StationFailInput): Promise<void> {
  const r = await loadStationRecording(id);
  if (r.status === "READY" || r.status === "PROCESSING" || r.status === "DELETED") return;
  await addEvents(id, [event("error", input.error)], {
    status: "FAILED",
    error: input.error,
    endedAt: r.endedAt ?? new Date(),
    ...(input.durationSec != null ? { durationSec: input.durationSec } : {}),
  });
}

export async function screenshotsHook(matchId: string, kind: ScreenshotKind, images: UploadedImage[]) {
  const m = await prisma.match.findUnique({ where: { id: matchId }, include: ownerInclude });
  if (!m) throw notFound("Match not found");
  return uploadScreenshots(matchId, ownerManagerId(m) ?? "", kind, images, true, "STATION");
}

// ---------------------------------------------------------------- viewers (HLS)

export type Viewer = { id: string; role: "ADMIN" | "MANAGER" | "PLAYER"; teamId: string | null };

/** Is the team playing in this match (approved slot in the scrim session, or in the tournament group)? */
async function teamInMatch(teamId: string, m: { sessionId: string | null; groupId: string | null }): Promise<boolean> {
  if (m.sessionId) {
    return !!(await prisma.registration.findFirst({ where: { sessionId: m.sessionId, teamId, status: "APPROVED", slotNumber: { not: null } }, select: { id: true } }));
  }
  if (m.groupId) return !!(await prisma.groupTeam.findFirst({ where: { groupId: m.groupId, teamId }, select: { id: true } }));
  return false;
}

/** May this viewer watch the match? (null = no such match) */
export async function mayWatch(viewer: Viewer, matchId: string): Promise<boolean | null> {
  const m = await prisma.match.findUnique({ where: { id: matchId }, include: ownerInclude });
  if (!m) return null;
  if (viewer.role === "ADMIN") return true;
  if (viewer.role === "MANAGER") return ownerManagerId(m) === viewer.id;
  return !!viewer.teamId && teamInMatch(viewer.teamId, m);
}

/** Is there a station stream (live, or just finished) for the match? */
export async function streamAvailable(matchId: string, now = Date.now()): Promise<boolean> {
  const rec = await latestStationRecording(matchId);
  if (!rec || rec.status === "DELETED") return false;
  if (rec.status === "LIVE") return true;
  return !!rec.endedAt && now - rec.endedAt.getTime() < REPLAY_WINDOW_MS;
}

/** Absolute path of a live HLS file, or 404. */
export function liveFile(matchId: string, name: string): string {
  if (!MATCH_ID_RE.test(matchId) || !/^(index\.m3u8|[A-Za-z0-9_-]{1,40}\.ts)$/.test(name)) throw notFound("Not found");
  return resolveKey(`live/${matchId}/${name}`);
}

// ---------------------------------------------------------------- team + manager cards

export async function teamLive(teamId: string): Promise<TeamLiveCard[]> {
  const recs = await prisma.matchRecording.findMany({
    where: { deviceName: STATION_DEVICE_NAME, status: "LIVE" },
    include: { match: { include: ownerInclude } },
    orderBy: { startedAt: "desc" },
    take: 20,
  });
  const cards: TeamLiveCard[] = [];
  const seen = new Set<string>();
  for (const r of recs) {
    if (seen.has(r.matchId) || !(await teamInMatch(teamId, r.match))) continue;
    seen.add(r.matchId);
    const ctx = matchContext(r.match);
    cards.push({
      matchId: r.matchId,
      title: ctx.title,
      subtitle: ctx.subtitle,
      number: r.match.number,
      map: r.match.map as GameMap,
      startedAt: r.startedAt.toISOString(),
      hlsUrl: hlsUrlFor(r.matchId),
      tournamentId: r.match.group?.stage.tournament.id ?? null,
    });
  }
  return cards;
}

/** `live` info for a manager's LiveMatchCard, from the match's latest recording. */
export function liveInfoFor(rec: Pick<MatchRecording, "matchId" | "deviceName" | "status" | "startedAt"> | undefined): MatchLiveInfo | null {
  if (!rec || rec.deviceName !== STATION_DEVICE_NAME || rec.status !== "LIVE") return null;
  return { streaming: true, hlsUrl: hlsUrlFor(rec.matchId), startedAt: rec.startedAt.toISOString() };
}
