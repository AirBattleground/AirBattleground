/**
 * Phase 6 — streaming devices (iPhone, view-only). Plan: docs/phase6/IPHONE_STREAMING.md, app brief: docs/phase6/IOS_APP_BRIEF.md.
 * A manager adds a device and gets its security key; the phone app sends that key on every call (X-Device-Key).
 * Status comes from the phone's heartbeats: no heartbeat for DEVICE_ONLINE_WINDOW_MS → OFFLINE.
 *
 * MANAGER (role MANAGER; own devices only)
 *   GET    /api/manager/devices                         → ListResponse<DeviceRow>   (newest first)
 *   POST   /api/manager/devices          DeviceNameInput → DeviceWithKey (201)       (max MAX_DEVICES_PER_MANAGER)
 *   GET    /api/manager/devices/:id                     → DeviceRow
 *   PATCH  /api/manager/devices/:id      DeviceNameInput → DeviceRow
 *   GET    /api/manager/devices/:id/key                  → DeviceKey
 *   POST   /api/manager/devices/:id/regenerate-key       → DeviceWithKey             (the old key stops working at once)
 *   DELETE /api/manager/devices/:id                      → 204
 *   POST   /api/manager/devices/:id/broadcast/start          → DeviceRow  (phase 6c: teams in the device's match can watch;
 *                                                          409 without a match or while the phone isn't sending video)
 *   POST   /api/manager/devices/:id/broadcast/stop           → DeviceRow  (also stops when the device's match changes)
 * VIEWERS (phase 6c/6d): once broadcast, a match is watchable by ANY signed-in user (player, manager, admin):
 *   GET /api/live                          → ListResponse<LiveBroadcastCard>  (every broadcast on now, newest first)
 *   GET /api/live/:matchId/d/index.m3u8    → HLS of the phone (+ files beside it)
 *   GET /api/live/:matchId/overlay.png     → the organiser's layout, transparent PNG (~1/s)
 *   GET /api/team/live also lists the player's own team's broadcast matches (TeamLiveCard with overlayUrl).
 *   POST   /api/manager/devices/:id/capture  DeviceCaptureInput → DeviceCaptureResponse (201; screenshot into the match's
 *                                                          reader pipeline. Asks the phone for a full-quality PNG, falls back
 *                                                          to a frame of the live stream. 409 when there's no video)
 *   GET    /api/manager/devices/:id/live/index.m3u8      → HLS (playlists + fMP4 segments under the same folder;
 *                                                          404 "The phone isn't streaming right now" when there's no video)
 *
 * DEVICE (header X-Device-Key; 401 DEVICE_KEY_INVALID on a wrong/removed key; rate-limited)
 *   POST   /api/device/hello             DeviceHelloInput     → DeviceHelloResponse
 *   POST   /api/device/heartbeat         DeviceHeartbeatInput → DeviceHeartbeatResponse
 *   POST   /api/device/stream/start      DeviceStreamStartInput → DeviceStreamStartResponse (RTMP target + 10-min publish token)
 *   POST   /api/device/stream/stop       DeviceStreamStopInput  → 204
 *   POST   /api/device/snapshots/:requestId  multipart "image" (PNG)  → 204   (answers a heartbeat's snapshotRequests)
 */
import { z } from "zod";
import type { ScreenshotRow } from "./phase2";
import type { GameMap } from "./enums";

export const DEVICE_KEY_HEADER = "X-Device-Key";
export const DEVICE_KEY_PREFIX = "7xk_";
export type DeviceErrorCode = "DEVICE_KEY_INVALID";
export const DEVICE_KEY_INVALID_MESSAGE = "This key doesn't work. Copy it again from your 7xen profile → Devices.";

/** A device counts as online while its last heartbeat is newer than this. */
export const DEVICE_ONLINE_WINDOW_MS = 30_000;
export const MAX_DEVICES_PER_MANAGER = 10;

export const DEVICE_PLATFORMS = ["IOS"] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export const DEVICE_STATUSES = ["OFFLINE", "ONLINE", "STREAMING"] as const;
/** OFFLINE: no recent heartbeat · ONLINE: app open, not streaming · STREAMING: broadcast running */
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export const STREAM_QUALITIES = ["480p", "720p", "1080p"] as const;
export type StreamQuality = (typeof STREAM_QUALITIES)[number];

export const THERMAL_STATES = ["nominal", "fair", "serious", "critical"] as const;
export type ThermalState = (typeof THERMAL_STATES)[number];

// ---------------------------------------------------------------- manager

export const deviceNameSchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(40, "At most 40 characters"),
});
export type DeviceNameInput = z.infer<typeof deviceNameSchema>;

export interface DeviceHealth {
  battery: number | null;
  charging: boolean | null;
  thermal: ThermalState | null;
  cpuPct: number | null;
  memMB: number | null;
  quality: StreamQuality | null;
  autoDowngraded: boolean;
  fps: number | null;
  bitrateKbps: number | null;
  width: number | null;
  height: number | null;
  network: "wifi" | "cellular" | null;
}

export interface DeviceRow {
  id: string;
  name: string;
  platform: DevicePlatform;
  /** "7xk_ab12" — enough to tell keys apart, never the whole key */
  keyPrefix: string;
  status: DeviceStatus;
  /** phone model / iOS / app version from the last hello; null until the phone has connected once */
  model: string | null;
  osVersion: string | null;
  appVersion: string | null;
  /** last hello or heartbeat; null = never connected */
  lastSeenAt: string | null;
  /** when the current broadcast started (status STREAMING) */
  streamingSince: string | null;
  /** the video server is receiving this phone's video right now (watchable) */
  videoReady: boolean;
  /** phase 6b: the match the broadcast layout shows (null = none picked) */
  match: { id: string; title: string; subtitle: string } | null;
  /** phase 6c: the manager pressed "Start broadcast": the teams in `match` can watch this stream */
  broadcastLive: boolean;
  broadcastStartedAt: string | null;
  /** phase 6b: the composed broadcast output */
  outputState: "OFF" | "STARTING" | "LIVE" | "RECONNECTING" | "ERROR";
  /** last reported health; null until the first heartbeat */
  health: DeviceHealth | null;
  createdAt: string;
}

export interface DeviceKey {
  key: string;
}

export interface DeviceWithKey extends DeviceRow, DeviceKey {}

/** Deep link for the iPhone app's QR scanner (host = the portal origin the manager is using). */
export const devicePairUrl = (host: string, key: string) =>
  `7xen://pair?host=${encodeURIComponent(host)}&key=${encodeURIComponent(key)}`;

// ---------------------------------------------------------------- device (phone → API)

export const deviceHelloSchema = z.object({
  deviceModel: z.string().trim().max(60).optional(),
  osVersion: z.string().trim().max(30).optional(),
  appVersion: z.string().trim().max(30).optional(),
});
export type DeviceHelloInput = z.infer<typeof deviceHelloSchema>;

export const deviceHeartbeatSchema = z.object({
  state: z.enum(["IDLE", "LIVE"]),
  quality: z.enum(STREAM_QUALITIES).optional(),
  autoDowngraded: z.boolean().optional(),
  battery: z.number().min(0).max(1).optional(),
  charging: z.boolean().optional(),
  thermal: z.enum(THERMAL_STATES).optional(),
  cpuPct: z.number().min(0).max(1000).optional(),
  memMB: z.number().min(0).max(100_000).optional(),
  fps: z.number().min(0).max(240).optional(),
  bitrateKbps: z.number().min(0).max(100_000).optional(),
  width: z.number().int().min(0).max(10_000).optional(),
  height: z.number().int().min(0).max(10_000).optional(),
  network: z.enum(["wifi", "cellular"]).optional(),
});
export type DeviceHeartbeatInput = z.infer<typeof deviceHeartbeatSchema>;

export interface DeviceAssignedMatch {
  id: string;
  title: string;
  broadcast: "PREVIEW" | "LIVE";
}

export interface DeviceHelloResponse {
  device: { id: string; name: string };
  manager: { name: string };
  assignedMatch: DeviceAssignedMatch | null;
}

export interface DeviceHeartbeatResponse {
  assignedMatch: DeviceAssignedMatch | null;
  snapshotRequests: { id: string }[];
}

export const deviceStreamStartSchema = z.object({ quality: z.enum(STREAM_QUALITIES).default("720p") });
export type DeviceStreamStartInput = z.infer<typeof deviceStreamStartSchema>;

export interface DeviceStreamStartResponse {
  /** e.g. rtmp://airbattleground.com:1935/live — HaishinKit: connect(rtmpUrl), then publish(streamName) */
  rtmpUrl: string;
  /** "dev_<deviceId>?token=…" */
  streamName: string;
  expiresAt: string;
}

export const deviceStreamStopSchema = z.object({ reason: z.string().trim().max(200).optional() });
export type DeviceStreamStopInput = z.infer<typeof deviceStreamStopSchema>;

/** Manager-side HLS URL for a device's live video. */
export const deviceLiveUrl = (deviceId: string) => `/api/manager/devices/${deviceId}/live/index.m3u8`;

export const deviceCaptureSchema = z.object({
  matchId: z.string().min(1),
  kind: z.enum(["SLOT_LIST", "RESULTS"]),
});
export type DeviceCaptureInput = z.infer<typeof deviceCaptureSchema>;

export interface DeviceCaptureResponse {
  /** ScreenshotRow of the new (or already uploaded identical) screenshot */
  screenshot: ScreenshotRow;
  /** PHONE = full-quality image from the app · STREAM = a frame of the live video (lower quality) */
  from: "PHONE" | "STREAM";
}

/** Phase 6d: a match being broadcast right now (Live page, sidebar count). */
export interface LiveBroadcastCard {
  /** the match id — or "s_<showId>" for a Studio show (studio: true) */
  matchId: string;
  kind: "SCRIM" | "TOURNAMENT";
  title: string;
  subtitle: string;
  /** match number (0 for a Studio show without a match) */
  number: number;
  map: GameMap;
  /** phase 8: a Studio show (produced in the browser; layout already in the video, overlayUrl is "") */
  studio?: boolean;
  /** phase 8c: the show is on the site YouTube channel — Live/Watch embed this video instead of playing hlsUrl */
  youtubeVideoId?: string;
  /** phase 8: a Studio show that's NOT on the public Live page — only its owner gets it (private test stream) */
  unlisted?: boolean;
  startedAt: string;
  hlsUrl: string;
  overlayUrl: string;
  organizer: { name: string; logoUrl: string | null };
  tournamentId: string | null;
}
