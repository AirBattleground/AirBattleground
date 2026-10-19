/**
 * PHASE 4b CONTRACT — AirBattleground Station: an Android emulator on the host PC that plays BGMI for a match,
 * records it, and streams it live (HLS) to the manager, the teams in that match, and the admin.
 *
 * Pieces:
 *   services/station (Node/TS, runs on the HOST, not in Docker: needs /dev/kvm, DISPLAY, adb, scrcpy, ffmpeg)
 *     - emulator lifecycle (AVD "bgmi14" in ~/.local/share/7xen-android/avd), BGMI launch (com.pubg.imobile)
 *     - capture pipeline: scrcpy --record=<fifo>.mkv → ffmpeg -c copy tee → (a) MP4 recording in VIDEO_DIR,
 *       (b) HLS live stream in STORAGE_DIR/live/<matchId>/ (2–5 s segments)
 *     - screenshots (adb exec-out screencap), remote input (adb shell input tap/swipe/keyevent/text)
 *     - HTTP API on STATION_PORT (default 4500), every request needs header `X-Station-Token: $STATION_TOKEN`
 *   apps/api talks to the station at STATION_URL (prod container: http://host.docker.internal:4500) and is the only
 *   thing browsers talk to.
 *
 * STATION (internal HTTP, called by apps/api only)
 *   GET  /health                                → StationStatus
 *   POST /sessions        StationPrepareRequest → StationStatus   (409 if busy with another match)
 *   POST /sessions/stop   { matchId }           → StationStatus   (finalises MP4, then calls the API complete hook)
 *   POST /sessions/capture { matchId, kind }    → { file: string } (PNG/JPEG path relative to STORAGE_DIR)
 *   POST /sessions/input  StationInput          → 204
 *   POST /bgmi/launch                           → 204
 *
 * API — manager (owner of the match) and admin (/api/admin/... same paths)
 *   GET  /api/manager/station                              → StationStatus (online=false when unreachable; never throws)
 *   POST /api/manager/matches/:matchId/station/prepare     → MatchLive   (creates a MatchRecording deviceName "7XEN Station",
 *                                                                          starts emulator → BGMI → recording + stream)
 *   POST /api/manager/matches/:matchId/station/stop        → MatchLive   (recording → PROCESSING → READY via existing ffmpeg poster)
 *   POST /api/manager/matches/:matchId/station/capture  { kind: "SLOT_LIST"|"RESULTS" } → ScreenshotRow (source "STATION")
 *   POST /api/manager/matches/:matchId/station/input    StationInput → 204   (remote control from the web player)
 *   GET  /api/manager/matches/:matchId/live                → MatchLive
 * API — viewers (manager owner, admin, and TEAMS in that match's lineup/approved slots/group)
 *   GET  /api/live/:matchId/index.m3u8                     → HLS playlist (no-cache)   (404 when not streaming)
 *   GET  /api/live/:matchId/:segment.ts                    → MPEG-TS segment
 *   GET  /api/team/live                                    → ListResponse<TeamLiveCard> (matches of the team streaming now)
 * API — internal hooks for the station (header X-Station-Token)
 *   POST /api/internal/station/recordings/:id/complete  { videoKey, sizeBytes, durationSec? } → 204
 *        (the MP4 was written straight into VIDEO_DIR by the station; API runs the same poster/duration step as uploads)
 *   POST /api/internal/station/matches/:matchId/screenshots  multipart files[] + kind → ListResponse<ScreenshotRow> (source STATION)
 */
import { z } from "zod";
import type { GameMap } from "./enums";

export type EmulatorState = "OFF" | "BOOTING" | "READY" | "ERROR";
export type StationPhase = "IDLE" | "STARTING_EMULATOR" | "LAUNCHING_BGMI" | "LIVE" | "STOPPING" | "ERROR";

export interface StationStatus {
  online: boolean;
  emulator: EmulatorState;
  bgmiInstalled: boolean;
  phase: StationPhase;
  /** match currently using the station */
  matchId: string | null;
  recordingId: string | null;
  startedAt: string | null;
  /** device screen size, e.g. { width: 1080, height: 2280 } (portrait natural size; BGMI runs landscape) */
  screen: { width: number; height: number } | null;
  /** current orientation reported by the device */
  rotation: 0 | 1 | 2 | 3 | null;
  error: string | null;
  version: string;
  /** (additive) title of the busy match, e.g. "Evening Scrim · Sat, 18 Oct · Match 2"; filled in by the API */
  matchTitle?: string | null;
  /** (additive) the Android device the station drives */
  device?: StationDevice;
}

/**
 * (additive) Game device. Local AVD on the station PC, or a REMOTE device over Wi-Fi: BlueStacks / Android emulator
 * on another machine running scripts/mac-adb-relay.py (address "host:port"), or a phone with wireless debugging.
 */
export interface StationDevice {
  /** "LOCAL_AVD" when no address is configured, else "REMOTE"; "BLUESTACKS" = BlueStacks on a Mac driven through its stream API */
  mode: "LOCAL_AVD" | "REMOTE" | "BLUESTACKS";
  /** configured remote "host:port" (null in LOCAL_AVD mode) */
  address: string | null;
  /** adb serial in use (null when not connected) */
  serial: string | null;
  /** adb connection state: "device" | "offline" | "unauthorized" | null (not found) */
  state: string | null;
  /** e.g. "BlueStacks · Samsung SM-S908E · Android 13" (manufacturer + model + release), null when unknown */
  label: string | null;
  /**
   * (additive) BLUESTACKS mode only: the background launch/quit job on the Mac. `phase` is idle | running | done | error;
   * poll the status while it is "running". Absent in other modes.
   */
  job?: StationDeviceJob | null;
  /**
   * (additive) true when the device can be started/stopped and watched/controlled live straight from the web
   * (BLUESTACKS mode). The web then shows Start emulator → control → Start match instead of a single Prepare.
   */
  controllable?: boolean;
  /** (additive) BLUESTACKS: is BGMI running on the device right now */
  gameRunning?: boolean;
}

export interface StationDeviceJob {
  name: string;
  phase: "idle" | "running" | "done" | "error";
  error: string | null;
}

/**
 * Admin sets the game device. address "host:port" (IPv4 or hostname, port 1-65535) or null = local AVD.
 *   API:     PUT /api/admin/station/device  { address } → StationStatus   (admin only; 503 when the station is offline;
 *            409 while a match is live on the station)
 *   Station: PUT /config/device              { address } → StationStatus   (persisted in STATION_WORK_DIR/device.json,
 *            overrides REMOTE_DEVICE from .env; connects right away with `adb connect`)
 */
export const stationDeviceInputSchema = z.object({
  address: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9.-]+:\d{1,5}$/, "Use the form 192.168.0.50:5556")
    .refine((a) => {
      const port = Number(a.split(":")[1]);
      return port >= 1 && port <= 65535;
    }, "Port must be 1-65535")
    .nullable(),
});
export type StationDeviceInput = z.infer<typeof stationDeviceInputSchema>;

/** (additive) body of POST .../station/prepare — `{}` is fine (launchBgmi defaults to true) */
export const stationPrepareInputSchema = z
  .object({
    launchBgmi: z.boolean().default(true),
    bitrateMbps: z.number().min(1).max(20).optional(),
    maxFps: z.number().int().min(10).max(60).optional(),
  })
  .default({});
export type StationPrepareInput = z.infer<typeof stationPrepareInputSchema>;

export interface StationPrepareRequest {
  matchId: string;
  recordingId: string;
  title: string;
  /** relative to VIDEO_DIR, e.g. "2026/10/<recordingId>.mp4" */
  videoKey: string;
  launchBgmi: boolean;
  /** video bitrate in Mbps (default 6) and max fps (default 30) */
  bitrateMbps?: number;
  maxFps?: number;
}

export const stationInputSchema = z.discriminatedUnion("type", [
  /** x,y are 0..1 fractions of the CURRENT displayed frame (as the viewer sees it) */
  z.object({ type: z.literal("tap"), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  z.object({
    type: z.literal("swipe"),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    x2: z.number().min(0).max(1),
    y2: z.number().min(0).max(1),
    durationMs: z.number().int().min(50).max(3000).default(300),
  }),
  z.object({ type: z.literal("key"), key: z.enum(["BACK", "HOME", "APP_SWITCH", "ENTER", "DEL"]) }),
  z.object({ type: z.literal("text"), text: z.string().min(1).max(64) }),
]);
export type StationInput = z.infer<typeof stationInputSchema>;
export const stationCaptureSchema = z.object({ kind: z.enum(["SLOT_LIST", "RESULTS"]) });

export interface MatchLive {
  matchId: string;
  streaming: boolean;
  /** "/api/live/<matchId>/index.m3u8" while streaming */
  hlsUrl: string | null;
  startedAt: string | null;
  recordingId: string | null;
  station: StationStatus;
}

export interface TeamLiveCard {
  matchId: string;
  title: string;
  subtitle: string;
  number: number;
  map: GameMap;
  startedAt: string;
  hlsUrl: string;
  /** (additive) tournament id for tournament matches, null for scrims */
  tournamentId?: string | null;
  /** (additive, phase 6c) the organiser's layout as a transparent PNG to draw over the video (iPhone broadcasts) */
  overlayUrl?: string | null;
}

// ---------------------------------------------------------------- additions (phase 4b, additive)
/*
 * Additional internal hook (station → API, header X-Station-Token):
 *   POST /api/internal/station/recordings/:id/fail  { error, durationSec? } → 204
 *        (the station could not produce any video: the recording becomes FAILED with that error)
 * Station request bodies (API → station):
 *   POST /sessions/stop     StationStopRequest           (answers at once with phase STOPPING; finalising runs in the background)
 *   POST /sessions/capture  StationCaptureRequest        → StationCaptureResponse
 *   POST /sessions/input    StationSessionInput          → 204 (409 when `matchId` is not the active session)
 * HLS (viewer endpoints) are served while the match's station recording is LIVE, and for ~10 minutes after it
 * stopped (the playlist then carries #EXT-X-ENDLIST); afterwards 404.
 * LiveMatchCard (GET /api/manager/live/today) gains an optional `live: MatchLiveInfo | null`.
 */

/** MatchRecording.deviceName of recordings made by the station. */
export const STATION_DEVICE_NAME = "7XEN Station";
/** Error code (HTTP 503) when the station PC can't be reached. */
export const STATION_OFFLINE_CODE = "STATION_OFFLINE" as const;
export type StationErrorCode = typeof STATION_OFFLINE_CODE;
export const STATION_OFFLINE_MESSAGE = "The AirBattleground Station PC isn't running. Start it on the station PC, then try again.";
/** Header carrying the shared secret on every API ↔ station call. */
export const STATION_TOKEN_HEADER = "X-Station-Token";

export interface StationStopRequest {
  matchId: string;
}
export interface StationCaptureRequest {
  matchId: string;
  kind: "SLOT_LIST" | "RESULTS";
}
export interface StationCaptureResponse {
  /** PNG path relative to STORAGE_DIR */
  file: string;
}
export type StationSessionInput = StationInput & { matchId: string };

export const stationCompleteSchema = z.object({
  videoKey: z.string().min(1).max(300),
  sizeBytes: z.number().int().min(0),
  durationSec: z.number().int().min(0).max(24 * 3600).optional(),
});
export type StationCompleteInput = z.infer<typeof stationCompleteSchema>;
export const stationFailSchema = z.object({
  error: z.string().min(1).max(300),
  durationSec: z.number().int().min(0).max(24 * 3600).optional(),
});
export type StationFailInput = z.infer<typeof stationFailSchema>;

/** Live-stream info added to LiveMatchCard (and used by the web player). */
export interface MatchLiveInfo {
  streaming: boolean;
  hlsUrl: string | null;
  startedAt: string | null;
}

// ---------------------------------------------------------------- BlueStacks device control (additive)
/*
 * BlueStacks mode (station env BLUESTACKS_URL + BLUESTACKS_TOKEN): the game device is BlueStacks on a Mac, driven
 * through its H.264 stream API. The emulator is started/stopped on its own, BEFORE and independent of a match
 * recording, so the manager can watch and play it first and press "Start match" (= prepare) when ready.
 *
 *   Station:  POST /device/start  { launchBgmi }  → StationStatus   (starts BlueStacks (+BGMI) in the background)
 *             POST /device/stop   { target }      → StationStatus   (409 while a match is live on the station)
 *             GET  /device/stream  (WebSocket)    low-latency H.264 for the manager, see below
 *   API:      POST /api/manager/matches/:matchId/station/device/start  → StationStatus
 *             POST /api/manager/matches/:matchId/station/device/stop   → StationStatus
 *             GET  /api/manager/matches/:matchId/station/stream        (WebSocket upgrade, session cookie/bearer)
 *             (all mirrored under /api/admin/...; 409 when another match holds the station)
 *   prepare in this mode starts BlueStacks first when it isn't running (phases STARTING_EMULATOR → LAUNCHING_BGMI),
 *   then the recording + HLS. stop ends only the recording; the emulator keeps running until device/stop.
 *
 * STREAM WebSocket (browser ↔ API ↔ station ↔ Mac) — the Mac's own protocol, passed through:
 *   server → client  text JSON  {type:"hello"} | {type:"mode",...} | {type:"config", codec, stream}
 *                    binary     [flag u8 (1=key,0=delta)][capture time µs f64 BE][H.264 Annex-B]
 *   client → server  binary     [0, action(0 down,1 up,2 move), id, x u16, y u16, w u16, h u16]  touch, x/y 0..65535
 *                               [2]                      request a keyframe (send after connecting)
 *                               [3, action, "KeyName"…]  Enter, Backspace, Delete, Tab, Escape, arrows, …
 *                               [4, utf8…]               type text (≤300 bytes)
 *   Anything else from the client is dropped. Only the owner of the match (or an admin) may connect, and only while
 *   the station is idle or running THAT match (409 on the upgrade otherwise). The socket stays open across device
 *   restarts: when the emulator isn't running no frames arrive (show "emulator off" after a few seconds without
 *   frames); a new "config" message + keyframe follow when it comes back.
 */
export const stationDeviceStartSchema = z.object({ launchBgmi: z.boolean().default(true) }).default({});
export type StationDeviceStartInput = z.infer<typeof stationDeviceStartSchema>;
export const stationDeviceStopSchema = z.object({ target: z.enum(["game", "all"]).default("all") }).default({});
export type StationDeviceStopInput = z.infer<typeof stationDeviceStopSchema>;
/** Path (below /api/manager or /api/admin) of the stream WebSocket of a match. */
export const stationStreamPath = (matchId: string) => `/matches/${matchId}/station/stream`;
