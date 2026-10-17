/**
 * PHASE 4b CONTRACT — 7XEN Station: an Android emulator on the host PC that plays BGMI for a match,
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
}

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
}
