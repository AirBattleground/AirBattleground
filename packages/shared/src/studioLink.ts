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
 *   POST   /api/studio-link/matches/:id/screenshots    multipart `files` + `kind` (SLOT_LIST | RESULTS) → { count }
 *   GET    /api/studio-link/matches/:id/live           → StudioLinkLive  (Team Status board; poll every ~3 s)
 *          ETag = `version`; If-None-Match equal to it → 304. 403 = another manager's match, 404 = unknown match,
 *          429 + Retry-After above 1 request/s per studio key.
 *
 * LIVE TEAM STATUS (Match Center, cookie auth; also under /api/admin for any match)
 *   GET    /api/manager/matches/:matchId/team-status   → StudioLinkLive
 *   PATCH  /api/manager/matches/:matchId/team-status   SaveLiveTeamInput → StudioLinkLive  (only while the match is LIVE)
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

/** scheduled = lineup not confirmed yet; live = lineup confirmed; finished = results being reviewed or published */
export type StudioLinkLiveState = "scheduled" | "live" | "finished";

export interface StudioLinkLivePlayer {
  /** the player's IGN (omitted when unknown) */
  name?: string;
  state: LivePlayerState;
}

export interface StudioLinkLiveTeam {
  id: string;
  slot: number;
  name: string;
  /** absolute URL (omitted when the team has no logo) */
  logo?: string;
  /** players alive, 0..4 (= players with state "alive") */
  status: number;
  /** up to 4, always in the same order (the confirmed lineup, else the team's roster) */
  players: StudioLinkLivePlayer[];
}

export interface StudioLinkLive {
  /** bumped whenever anything below changes; also the ETag */
  version: number;
  /** ISO instant (UTC, Z) of the last change */
  updatedAt: string;
  match: { id: string; title: string; state: StudioLinkLiveState; map: string };
  /** every registered team (eliminated ones too), sorted by slot */
  teams: StudioLinkLiveTeam[];
}

export const saveLiveTeamSchema = z.object({
  teamId: z.string().trim().min(1).max(60),
  /** the team's players in board order */
  players: z
    .array(z.enum(LIVE_PLAYER_STATES, { errorMap: () => ({ message: "Each player is alive, knocked or eliminated" }) }))
    .min(1)
    .max(LIVE_TEAM_SIZE),
});
export type SaveLiveTeamInput = z.infer<typeof saveLiveTeamSchema>;
