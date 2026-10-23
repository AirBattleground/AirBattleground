/**
 * PHASE 4 CONTRACT — 7XEN Manager App (Android): live match operations.
 * Plan: docs/phase4/MANAGER_APP.md. Native module interface: apps/mobile/modules/gameops/src/GameOps.types.ts.
 *
 * AUTH (mobile)
 *   POST   /api/auth/token        LoginInput (+ deviceName?)        → MobileTokenResponse  (MANAGER only; same rules as /login)
 *   All /api/manager/* (and /api/auth/me) also accept `Authorization: Bearer <token>` (cookies keep working for the web).
 *
 * MANAGER — match day
 *   GET    /api/manager/live/today?days=2                           → ListResponse<LiveMatchCard>  (own scrim + tournament matches, today…+days, soonest first)
 *   GET    /api/manager/matches/:matchId/room                       → RoomDetails | null
 *   PUT    /api/manager/matches/:matchId/room   SaveRoomInput       → RoomDetails
 *   DELETE /api/manager/matches/:matchId/room                       → 204
 *   POST   /api/manager/matches/:matchId/recordings  StartRecordingInput → RecordingRow (201; one LIVE recording per match at a time)
 *   GET    /api/manager/matches/:matchId/recordings                 → ListResponse<RecordingRow>
 *   PATCH  /api/manager/recordings/:id          RecordingEventInput → RecordingRow   (status changes + event log: room_created, capture, stop…)
 *   Resumable video upload (tus-like, raw bytes, max 4 GB):
 *   POST   /api/manager/recordings/:id/upload   CreateUploadInput   → UploadState  (idempotent; returns current offset)
 *   HEAD   /api/manager/recordings/:id/upload                       → 204 with `Upload-Offset` header
 *   PATCH  /api/manager/recordings/:id/upload   body: application/octet-stream, header `Upload-Offset` (must equal current offset)
 *                                                                   → UploadState  (409 OFFSET_MISMATCH with the real offset)
 *   POST   /api/manager/recordings/:id/upload/complete              → RecordingRow (verifies size; status PROCESSING → READY after ffmpeg poster/duration)
 *   GET    /api/manager/recordings/:id/video    (HTTP Range)        → video/mp4 stream
 *   GET    /api/manager/recordings/:id/poster                       → image/jpeg
 *   Screenshots from the app reuse POST /api/manager/matches/:matchId/screenshots with an extra multipart field
 *   `source` = "APP_AUTO" | "APP_MANUAL" (default "WEB").
 *   GET    /api/manager/recipes                                     → ListResponse<Recipe>  (admin defaults + this manager's taught recipes)
 *   PUT    /api/manager/recipes/:key            SaveRecipeInput     → Recipe  (upsert the manager's own version of a recipe)
 *   GET    /api/app/manager/latest              (public)            → AppRelease | null
 *
 *   GET    /api/app/manager/download        (public)            → the APK (application/vnd.android.package-archive); 404 when none
 *
 * Errors added in phase 4: 409 OFFSET_MISMATCH (body = UploadOffsetMismatchBody, also an `Upload-Offset` header),
 *   507 STORAGE_FULL (not enough disk space for a video), 409 CONFLICT (a LIVE recording already exists / upload busy).
 *
 * TEAM
 *   GET    /api/team/rooms                                          → ListResponse<TeamRoomCard>  (upcoming matches of the team; room shown once revealed)
 *
 * ADMIN
 *   GET    /api/admin/recordings?status=&q=                         → ListResponse<AdminRecordingRow>
 *   DELETE /api/admin/recordings/:id                                → 204 (deletes the video file)
 *   GET    /api/admin/recordings/:id/video | /poster                → same as manager
 *   GET    /api/admin/settings                                      → AppSettings
 *   PATCH  /api/admin/settings                  UpdateSettingsInput → AppSettings
 *   GET    /api/admin/recipes                                       → ListResponse<Recipe>  (defaults + every manager's, `manager` set)
 *   PUT    /api/admin/recipes/:key              SaveRecipeInput     → Recipe  (the default version every manager starts from)
 *   DELETE /api/admin/recipes/:id                                   → 204
 */
import { z } from "zod";
import type { GameMap } from "./enums";
import type { MatchStatus, ScreenshotKind } from "./phase2";
import type { SessionUser } from "./dto";

// ---------- auth ----------
export interface MobileTokenResponse {
  token: string;
  expiresAt: string;
  user: SessionUser;
}
export const mobileLoginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
  deviceName: z.string().trim().max(80).optional(),
});
export type MobileLoginInput = z.infer<typeof mobileLoginSchema>;

// ---------- room ----------
export interface RoomDetails {
  roomId: string;
  password: string;
  /** when teams can see it; null = immediately */
  revealAt: string | null;
  updatedAt: string;
}
export const saveRoomSchema = z.object({
  roomId: z.string().trim().regex(/^\d{4,12}$/, "Room ID is 4–12 digits"),
  password: z.string().trim().min(1, "Enter the room password").max(20),
  /** minutes before the match start that teams see the room; null = now */
  revealMinutesBefore: z.number().int().min(0).max(240).nullable().default(15),
});
export type SaveRoomInput = z.infer<typeof saveRoomSchema>;

// ---------- today ----------
export interface LiveMatchCard {
  matchId: string;
  kind: "SCRIM" | "TOURNAMENT";
  /** scrim title or tournament title */
  title: string;
  /** e.g. "Sat, 18 Oct · Match 2" or "Qualifier · Group C · Match 3" */
  subtitle: string;
  number: number;
  map: GameMap;
  /** ISO instant the match is planned to start */
  startsAt: string | null;
  status: MatchStatus;
  teamsCount: number;
  slotRange: { first: number; last: number };
  room: RoomDetails | null;
  recording: RecordingRow | null;
  screenshotCounts: { slotList: number; results: number };
}

// ---------- recordings ----------
export const RECORDING_STATUSES = ["LIVE", "STOPPED", "UPLOADING", "PROCESSING", "READY", "FAILED", "DELETED"] as const;
export type RecordingStatus = (typeof RECORDING_STATUSES)[number];
export interface RecordingEvent {
  at: string;
  type: "start" | "room_created" | "screen" | "capture" | "pause" | "resume" | "stop" | "error" | "note";
  detail: string | null;
}
export interface RecordingRow {
  id: string;
  matchId: string;
  status: RecordingStatus;
  deviceName: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
  sizeBytes: number | null;
  uploadedBytes: number;
  width: number | null;
  height: number | null;
  hasPoster: boolean;
  events: RecordingEvent[];
  captures: { slotList: number; results: number };
  error: string | null;
}
export const startRecordingSchema = z.object({
  deviceName: z.string().trim().max(80).optional(),
  appVersion: z.string().trim().max(40).optional(),
});
export type StartRecordingInput = z.infer<typeof startRecordingSchema>;
export const recordingEventSchema = z.object({
  status: z.enum(["LIVE", "STOPPED", "FAILED"]).optional(),
  events: z
    .array(z.object({ at: z.string().datetime({ offset: true }), type: z.enum(["start", "room_created", "screen", "capture", "pause", "resume", "stop", "error", "note"]), detail: z.string().max(300).nullable().default(null) }))
    .max(200)
    .default([]),
  durationSec: z.number().int().min(0).max(6 * 3600).optional(),
  error: z.string().max(300).optional(),
});
export type RecordingEventInput = z.infer<typeof recordingEventSchema>;
export const MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024;
export const createUploadSchema = z.object({
  sizeBytes: z.number().int().min(1).max(MAX_VIDEO_BYTES),
  mimeType: z.literal("video/mp4").default("video/mp4"),
  width: z.number().int().min(1).max(4096).optional(),
  height: z.number().int().min(1).max(4096).optional(),
});
export type CreateUploadInput = z.infer<typeof createUploadSchema>;
/** Largest PATCH chunk the server accepts (HTTP 413 above it). */
export const MAX_UPLOAD_CHUNK_BYTES = 16 * 1024 * 1024;
/** Chunk size the server suggests (UploadState.chunkSize). */
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
/** Body of a 409 OFFSET_MISMATCH: resume from `offset`. */
export interface UploadOffsetMismatchBody {
  error: { code: "OFFSET_MISMATCH"; message: string };
  offset: number;
}
export const liveTodayQuerySchema = z.object({ days: z.coerce.number().int().min(0).max(14).default(2) });
export const adminRecordingsQuerySchema = z.object({
  status: z.enum(RECORDING_STATUSES).optional().or(z.literal("").transform(() => undefined)),
  q: z.string().trim().max(60).optional(),
});
export interface AdminRecordingRow extends RecordingRow {
  manager: { id: string; displayName: string };
  /** e.g. "Evening Scrim · Sat, 18 Oct · Match 2" */
  matchTitle: string;
}
export interface UploadState {
  recordingId: string;
  offset: number;
  sizeBytes: number;
  /** server's preferred chunk size */
  chunkSize: number;
  complete: boolean;
}
/** DEVICE (phase 6): captured from a streaming iPhone in Match Center */
/** STUDIO = uploaded by 7XEN Studio; STUDIO_AUTO = a Studio auto capture taken before the match started (read as a team list) */
export type ScreenshotSource = "WEB" | "APP_AUTO" | "APP_MANUAL" | "STATION" | "DEVICE" | "STUDIO" | "STUDIO_AUTO";

// ---------- recipes (assisted / automatic touch steps) ----------
export const RECIPE_KEYS = ["CREATE_ROOM", "OPEN_TEAM_LIST", "SCROLL_RESULTS"] as const;
export type RecipeKey = (typeof RECIPE_KEYS)[number];
/** A screen fingerprint: 64-bit dHash (hex) of a region of the game viewport, regions as 0..1 fractions. */
export const fingerprintSchema = z.object({ hash: z.string().regex(/^[0-9a-f]{16}$/), region: z.tuple([z.number(), z.number(), z.number(), z.number()]), maxDistance: z.number().int().min(0).max(32).default(10) });
export const recipeStepSchema = z.object({
  id: z.string().min(1).max(40),
  /** shown in the floating checklist, e.g. "Open Custom Room" */
  label: z.string().min(1).max(80),
  hint: z.string().max(200).optional(),
  /** wait until this screen is visible before the action (assisted mode ticks the step when seen) */
  expect: fingerprintSchema.optional(),
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("tap"), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
    z.object({ type: z.literal("swipe"), x: z.number().min(0).max(1), y: z.number().min(0).max(1), x2: z.number().min(0).max(1), y2: z.number().min(0).max(1), durationMs: z.number().int().min(50).max(3000).default(400) }),
    z.object({ type: z.literal("wait"), ms: z.number().int().min(100).max(30000) }),
    z.object({ type: z.literal("input_text"), field: z.enum(["roomPassword"]) }),
    z.object({ type: z.literal("read_text"), field: z.enum(["roomId", "roomPassword"]), region: z.tuple([z.number(), z.number(), z.number(), z.number()]) }),
    z.object({ type: z.literal("manual") }),
  ]),
  timeoutMs: z.number().int().min(500).max(120000).default(15000),
});
export type RecipeStep = z.infer<typeof recipeStepSchema>;
export interface Recipe {
  id: string;
  key: RecipeKey;
  name: string;
  version: number;
  /** DEFAULT = admin-maintained; MANAGER = taught by this manager on their device */
  scope: "DEFAULT" | "MANAGER";
  /** e.g. "2400x1080" — recipes are relative to the game viewport, this is informational */
  deviceProfile: string | null;
  steps: RecipeStep[];
  updatedAt: string;
  /** set on admin listings for MANAGER-scope recipes */
  manager?: { id: string; displayName: string } | null;
}
export const saveRecipeSchema = z.object({
  name: z.string().trim().min(2).max(60),
  deviceProfile: z.string().max(40).nullable().optional(),
  steps: z.array(recipeStepSchema).min(1).max(60),
});
export type SaveRecipeInput = z.infer<typeof saveRecipeSchema>;

// ---------- team ----------
export interface TeamRoomCard {
  matchId: string;
  title: string;
  subtitle: string;
  number: number;
  map: GameMap;
  startsAt: string | null;
  slotNumber: number | null;
  /** null until revealed */
  room: { roomId: string; password: string } | null;
  revealAt: string | null;
}

// ---------- admin ----------
export interface AppSettings {
  videoRetentionDays: number;
  videoStorage: { dir: string; usedBytes: number; freeBytes: number | null; videos: number };
}
export const updateSettingsSchema = z.object({ videoRetentionDays: z.number().int().min(1).max(3650) });
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
export interface AppRelease {
  version: string;
  versionCode: number;
  url: string;
  sizeBytes: number;
  notes: string | null;
  publishedAt: string;
}

/** BGMI Android package name */
export const BGMI_PACKAGE = "com.pubg.imobile";
export type { ScreenshotKind };
