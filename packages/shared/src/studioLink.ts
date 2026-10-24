/**
 * Studio link — a standalone 7XEN Studio app (studio-app/) connected to a manager's account. A "connected studio" IS a
 * StudioWorker row: its key (`sw_…`) authenticates every call (header X-Studio-Key, X-Worker-Key also accepted).
 * The app renders + encodes itself and pushes to the outputs (box mode: this server runs no relays).
 *
 * Connect QR: `7xen-studio://connect?host=<site origin>&key=<sw_… key>`
 *
 * KEY AUTH (no cookies)
 *   GET    /api/studio-link/me                         → StudioLinkMe
 *   GET    /api/studio-link/matches                    → { items: StudioLinkMatch[] }
 *   GET    /api/studio-link/outputs                    → StudioLinkOutputs
 *   POST   /api/studio-link/broadcasts                 StudioLinkBroadcastInput → StudioLinkBroadcast  (409 when busy)
 *   POST   /api/studio-link/broadcasts/:id/heartbeat   StudioLinkHeartbeatInput → { stop: boolean }
 *   POST   /api/studio-link/broadcasts/:id/stop        → 204
 *   POST   /api/studio-link/matches/:id/start          → StudioLinkLive  (confirms the lineup; the match goes live)
 *   POST   /api/studio-link/matches/:id/stop           → StudioLinkLive  (the match ends; results screenshots next)
 *          Both 409 with a message when the match's control.state doesn't allow it. The manager publishes results.
 *   POST   /api/studio-link/matches/:id/screenshots    multipart: one image ≤ 2 MB + captureId, capturedAt, sequence,
 *          sessionId [, kind=AUTO, trigger, hint, sceneId, sceneName, width, height] → 202 LiveCaptureAccepted
 *          (200 + duplicate for a repeat captureId; 200 + reason "busy" for an auto frame while too many of this match's
 *          frames wait to be read). Frames are read in parallel. The server detects what each shows and merges it — the
 *          team list ("lobby"; the list scrolls, every frame adds the teams it shows): before Start it fills the
 *          lineup, while live it updates each player's alive/eliminated state and kills; the results screen (also
 *          scrolled): while live it ends the match (an interval frame only when it shows rank 1 and another results
 *          frame confirms it), then every page fills ranks; in_game (spectator HUD) updates alive counts. Anything else
 *          is ignored. kind=LIVE_STATUS means the same as AUTO. kind=SLOT_LIST | RESULTS (old builds): multipart `files`
 *          → 201 { count }, read as that kind.
 *          409 = match published, or locked and the hint isn't lobby; 409 code CAPTURE_DONE (interval frames) = every
 *          team that played has its rank, auto capture can stop; 413 = over 2 MB; 429 + Retry-After above 1 upload per
 *          2 s per studio per match.
 *   GET    /api/studio-link/matches/:id/captures/:captureId → StudioCaptureStatus  (what the reader made of it)
 *   GET    /api/studio-link/matches/:id/live           → StudioLinkLive  (Team Status board, on-screen texts, summary,
 *          winner; poll every ~3 s; the final state stays available after the match)
 *          ETag = `version`; If-None-Match equal to it → 304. 403 = another manager's match, 404 = unknown match,
 *          429 + Retry-After above 1 request/s per studio key.
 *
 * LIVE TEAM STATUS (Match Center, cookie auth; also under /api/admin for any match)
 *   GET    /api/manager/matches/:matchId/team-status   → StudioLinkLive
 *   PATCH  /api/manager/matches/:matchId/team-status   SaveLiveTeamInput → StudioLinkLive  (players / kills / points;
 *          only while the match is LIVE)
 *   PATCH  /api/manager/matches/:matchId/team-status/auto  { paused } → StudioLinkLive  (pause auto capture updates)
 *   GET    /api/manager/matches/:matchId/captures/:id/image → the captured image (kept 24 h)
 */
import { z } from "zod";

export const STUDIO_LINK_KEY_HEADER = "X-Studio-Key";
/** a connected studio counts as online for this long after its last call (heartbeats come every ~10 s) */
export const STUDIO_LINK_ONLINE_MS = 30_000;
/** the connect QR's scheme */
export const STUDIO_CONNECT_SCHEME = "7xen-studio://connect";

export const studioConnectLink = (host: string, key: string) =>
  `${STUDIO_CONNECT_SCHEME}?host=${encodeURIComponent(host)}&key=${encodeURIComponent(key)}`;

export interface StudioLinkMe {
  manager: { name: string };
  org: { name: string } | null;
}

export type StudioLinkMatchStatus = "upcoming" | "live" | "done";
export interface StudioLinkMatch {
  id: string;
  title: string;
  subtitle: string;
  /** ISO instant (null = not scheduled) */
  startsAt: string | null;
  status: StudioLinkMatchStatus;
  /** what the studio may do with this match */
  control: StudioMatchControl;
}

/**
 * locked = registration still open and slots not full (Start disabled); ready = the studio may Start;
 * live = running (Stop); ended = stopped, waiting for results screenshots; published = read-only.
 */
export type StudioControlState = "locked" | "ready" | "live" | "ended" | "published";
export interface StudioMatchControl {
  state: StudioControlState;
  /** when a locked match unlocks (registration closes); null once unlocked */
  unlocksAt: string | null;
  /** why it's locked, for the operator (null otherwise) */
  reason: string | null;
  /** teams in the match / slots */
  teams: number;
  slots: number;
}

export interface StudioLinkOutputs {
  /** the AirBattleground Live page is always offered */
  livePage: true;
  /** the site YouTube channel (null = not connected / auto-stream off) */
  siteYoutube: { channelTitle: string } | null;
  destinations: { id: string; name: string; kind: "YOUTUBE" | "FACEBOOK" | "CUSTOM" }[];
}

export const studioLinkBroadcastSchema = z.object({
  matchId: z.string().trim().min(1).max(60).nullable().default(null),
  title: z.string().trim().min(1, "Give the broadcast a title").max(120),
  livePage: z.boolean().default(true),
  siteYoutube: z.boolean().default(false),
  destinationIds: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
});
export type StudioLinkBroadcastInput = z.input<typeof studioLinkBroadcastSchema>;

export interface StudioLinkTarget {
  /** a destination id, "site-youtube" or "live-page" */
  id: string;
  name: string;
  /** full RTMP URL incl. the stream key / token */
  url: string;
}

export interface StudioLinkBroadcast {
  /** the StudioShow id (= broadcastId) */
  id: string;
  targets: StudioLinkTarget[];
  /** where viewers watch it (YouTube video or the AirBattleground watch page); null = nowhere public */
  watchUrl: string | null;
}

export const studioLinkHeartbeatSchema = z.object({
  /** the app's own status word (e.g. starting, live, reconnecting, error) */
  state: z.string().trim().max(30).default("live"),
  fps: z.number().nonnegative().max(1000).nullable().default(null),
  bitrateKbps: z.number().nonnegative().max(1_000_000).nullable().default(null),
});
export type StudioLinkHeartbeatInput = z.input<typeof studioLinkHeartbeatSchema>;

export interface StudioLinkHeartbeatResponse {
  /** true = the broadcast was ended on the website (or is no longer live): stop pushing */
  stop: boolean;
}

export interface StudioLinkScreenshotsResponse {
  count: number;
}

// ---------------------------------------------------------------- live team status (Team Status board)

export const LIVE_PLAYER_STATES = ["alive", "knocked", "eliminated"] as const;
export type LivePlayerState = (typeof LIVE_PLAYER_STATES)[number];
/** bars per team on the board */
export const LIVE_TEAM_SIZE = 4;

/** scheduled = lineup not confirmed yet; live = lineup confirmed; summary = results being reviewed; finished = published */
export type StudioLinkLiveState = "scheduled" | "live" | "summary" | "finished";

export type LiveStateSource = "manager" | "auto";

export interface StudioLinkLivePlayer {
  /** the player's IGN (omitted when unknown) */
  name?: string;
  state: LivePlayerState;
  /** who set the state last (omitted = never changed) */
  source?: LiveStateSource;
  /** ISO instant of that change */
  updatedAt?: string;
}

export interface StudioLinkLiveTeam {
  id: string;
  slot: number;
  name: string;
  /** absolute URL (omitted when the team has no logo) */
  logo?: string;
  /** players alive, 0..4 (= players with state "alive") */
  status: number;
  /** finishes (the board's FIN. column); 0 before the match */
  kills: number;
  /** the board's TOT. PTS. column: placement + kill points once placed, else kill points (or the manager's figure) */
  totalPoints: number;
  /** up to 4, always in the same order (the confirmed lineup, else the team's roster padded to 4 before the match) */
  players: StudioLinkLivePlayer[];
}

export interface StudioLinkSummaryTeam {
  slot: number;
  name: string;
  logo?: string;
  kills: number;
  /** null = not placed (yet) */
  placement: number | null;
  placementPoints: number;
  killPoints: number;
  totalPoints: number;
}

export interface StudioLinkMvp {
  name: string;
  team: string;
  kills: number;
  /** absolute URL of the player's photo (omitted when none) */
  photo?: string;
}

export interface StudioLinkSummary {
  /** every team of the match, sorted by totalPoints desc, then kills desc */
  teams: StudioLinkSummaryTeam[];
  /** the player with the most kills (null = no kills read yet) */
  mvp: StudioLinkMvp | null;
}

export interface StudioLinkWinner {
  slot: number;
  name: string;
  logo?: string;
  kills: number;
  totalPoints: number;
  /** `photo`: the player's profile picture, only when the name matched a team member's account */
  players: { name: string; kills: number; photo?: string }[];
}

export interface StudioLinkLive {
  /** bumped whenever anything below changes; also the ETag */
  version: number;
  /** ISO instant (UTC, Z) of the last change */
  updatedAt: string;
  /** auto capture from the studio (not part of `version`: it changes on every capture) */
  autoCapture?: LiveAutoCapture;
  /** what the studio may do with this match (same as on GET /matches) */
  control?: StudioMatchControl;
  match: {
    id: string;
    title: string;
    state: StudioLinkLiveState;
    /** ISO instant the match is planned to start (null = not scheduled) */
    startsAt: string | null;
    /** ISO instant the match went live (null = not yet) */
    liveAt: string | null;
    /** tournament stage (e.g. "Grand Finals"); null for scrims */
    round: string | null;
    matchNumber: number;
    map: string;
  };
  /** every registered team (eliminated ones too), sorted by slot */
  teams: StudioLinkLiveTeam[];
  /** once the match ended (state summary / finished) */
  summary?: StudioLinkSummary;
  /** once results are published (state finished) */
  winner?: StudioLinkWinner;
  /**
   * additive: results progress once the match has ended (state summary / finished). `teams` = teams in the lineup,
   * `placed` = those with a rank so far; `complete` = every one has its rank (or the results are published). While
   * not complete the studio shows "processing" instead of the standings and keeps capturing the results screen.
   */
  results?: StudioLinkResultsProgress;
}

export interface StudioLinkResultsProgress {
  complete: boolean;
  placed: number;
  teams: number;
}

export const saveLiveTeamSchema = z
  .object({
    teamId: z.string().trim().min(1).max(60),
    /** the team's players in board order */
    players: z
      .array(z.enum(LIVE_PLAYER_STATES, { errorMap: () => ({ message: "Each player is alive, knocked or eliminated" }) }))
      .min(1)
      .max(LIVE_TEAM_SIZE)
      .optional(),
    /** finishes so far (FIN.) */
    kills: z.number({ invalid_type_error: "Kills must be a number" }).int("Kills must be a whole number").min(0, "Kills can't be negative").max(99).optional(),
    /** total points so far (TOT. PTS.); null = work it out from the kills again */
    totalPoints: z.number({ invalid_type_error: "Points must be a number" }).int("Points must be a whole number").min(0, "Points can't be negative").max(999).nullable().optional(),
  })
  .refine((v) => v.players !== undefined || v.kills !== undefined || v.totalPoints !== undefined, { message: "Nothing to change", path: ["players"] });
export type SaveLiveTeamInput = z.infer<typeof saveLiveTeamSchema>;

// ---------------------------------------------------------------- auto capture (kind=LIVE_STATUS)

/** "AUTO": the server decides what the screenshot shows. LIVE_STATUS (older name) means the same. */
export const STUDIO_CAPTURE_KINDS = ["AUTO", "LIVE_STATUS"] as const;
/** what the reader found on a studio screenshot */
export const CAPTURE_DETECTED = ["lobby", "results", "in_game", "other"] as const;
export type CaptureDetected = (typeof CAPTURE_DETECTED)[number];
export const MAX_LIVE_CAPTURE_BYTES = 2 * 1024 * 1024;
/** auto updates only apply values read with at least this confidence */
export const LIVE_MIN_CONFIDENCE = 0.8;
/** a manager edit locks that player against auto updates for this long */
export const LIVE_MANAGER_LOCK_MS = 60_000;
/** auto capture counts as active while captures keep arriving within this window */
export const LIVE_CAPTURE_ACTIVE_MS = 30_000;

export interface LiveAutoCapture {
  /** a capture arrived in the last 30 s */
  active: boolean;
  /** the manager paused auto updates (captures are accepted, nothing is applied) */
  paused: boolean;
  lastCaptureAt: string | null;
  lastAppliedAt: string | null;
  /** what the newest read capture showed (null = none read yet) */
  lastDetected: CaptureDetected | null;
  /** the newest capture failed to read (cleared by the next good one) */
  lastError: string | null;
  /** Match Center only: the newest captured image (cookie auth) */
  latestImageUrl?: string | null;
}

export const liveCaptureFieldsSchema = z.object({
  captureId: z.string({ required_error: "captureId is required" }).uuid("captureId must be a UUID"),
  capturedAt: z.string({ required_error: "capturedAt is required" }).datetime({ message: "capturedAt must be an ISO 8601 UTC time" }),
  sequence: z.coerce.number({ required_error: "sequence is required" }).int().min(0),
  sessionId: z.string({ required_error: "sessionId is required" }).uuid("sessionId must be a UUID"),
  sceneId: z.string().trim().max(100).optional(),
  sceneName: z.string().trim().max(100).optional(),
  width: z.coerce.number().int().min(1).max(10_000).optional(),
  height: z.coerce.number().int().min(1).max(10_000).optional(),
  /** auto = interval capture (the newest wins when the reader is busy); manual = operator pressed Send (always read) */
  trigger: z.enum(["auto", "manual"], { errorMap: () => ({ message: "trigger is auto or manual" }) }).default("auto"),
  /** what the operator says it shows — stored as a training label; the server still decides */
  hint: z.enum(["lobby", "results", "in_game"], { errorMap: () => ({ message: "hint is lobby, results or in_game" }) }).optional(),
});
export type LiveCaptureFields = z.infer<typeof liveCaptureFieldsSchema>;

export interface LiveCaptureAccepted {
  captureId: string;
  accepted: boolean;
  duplicate?: true;
  /** "busy" = too many frames of this match are waiting to be read; this one was dropped (auto captures only) */
  reason?: "busy";
  /** captures of other matches waiting ahead of this one */
  queuePosition?: number;
  /** seconds until the studio's next upload (2..30) */
  nextIntervalSeconds?: number;
}

export const liveAutoSchema = z.object({ paused: z.boolean() });
export type LiveAutoInput = z.infer<typeof liveAutoSchema>;

export type StudioCaptureState = "queued" | "reading" | "applied" | "ignored" | "failed";
export interface StudioCaptureStatus {
  captureId: string;
  status: StudioCaptureState;
  /** null until read (or when it was skipped unread) */
  detected: CaptureDetected | null;
  /** rough: ~0.97 when the reader was sure, ~0.6 when it flagged something */
  confidence: number | null;
  /** one line for the operator, e.g. "Lobby ✓ 14 teams" */
  message: string | null;
}
