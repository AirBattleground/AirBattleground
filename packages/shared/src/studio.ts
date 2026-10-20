/**
 * Phase 8 — Studio: a manager produces a live show in the browser from several sources (iPhone device streams,
 * webcam + mic, prop videos, the match scorecard, MVP card), switching between scenes with cut/fade transitions.
 * The browser mixes everything on a canvas and sends the finished video to the server in ~1 s chunks; the server
 * turns it into a broadcast (MediaMTX path live/show_<id>) that the public Live/Watch pages play and that is relayed
 * to the manager's channels and the site YouTube channel.
 *
 * MANAGER (role MANAGER; own shows only)
 *   GET    /api/manager/studio/shows                         → ListResponse<StudioShowRow>
 *   POST   /api/manager/studio/shows      CreateShowInput    → StudioShow (201)
 *   GET    /api/manager/studio/shows/:id                     → StudioShow
 *   PATCH  /api/manager/studio/shows/:id  UpdateShowInput    → StudioShow
 *   DELETE /api/manager/studio/shows/:id                     → 204 (not while live)
 *   POST   /api/manager/studio/shows/:id/ingest?session=&seq=&codec=   raw body (a WebM/Matroska chunk)
 *                                                            → { ok: true, live: boolean }  (seq 0 of a new session
 *                                                              starts the broadcast; chunks are applied in seq order)
 *   POST   /api/manager/studio/shows/:id/stop                → StudioStatus (ends the broadcast)
 *   GET    /api/manager/studio/shows/:id/status              → StudioStatus
 * PUBLIC (no sign-in)
 *   Live shows appear in GET /api/live/ as LiveBroadcastCard with `studio: true` (matchId = "s_<showId>") and play at
 *   GET /api/live/s/:showId/<hls file>.
 */
import { z } from "zod";

export const STUDIO_WIDTH = 1280;
export const STUDIO_HEIGHT = 720;
export const STUDIO_FPS = 30;
/** a chunk body may not exceed this (≈ 1 s of video at the studio bitrate, with room to spare) */
export const MAX_INGEST_CHUNK_BYTES = 8 * 1024 * 1024;

/** Saved show setup (scenes etc.). Opaque to the server: the Studio page owns its shape (version it). */
export const studioConfigSchema = z.record(z.unknown());
export type StudioConfig = z.infer<typeof studioConfigSchema>;

export const createShowSchema = z.object({
  title: z.string().trim().min(2, "At least 2 characters").max(80),
  matchId: z.string().min(1).nullable().optional(),
});
export type CreateShowInput = z.infer<typeof createShowSchema>;

export const updateShowSchema = z.object({
  title: z.string().trim().min(2, "At least 2 characters").max(80).optional(),
  matchId: z.string().min(1).nullable().optional(),
  /** stream-key destinations (StreamDestination ids) to relay to while live */
  destinationIds: z.array(z.string()).max(5).optional(),
  config: studioConfigSchema.optional(),
});
export type UpdateShowInput = z.infer<typeof updateShowSchema>;

export const ingestQuerySchema = z.object({
  session: z.string().regex(/^[A-Za-z0-9_-]{6,40}$/),
  seq: z.coerce.number().int().min(0),
  /** what the browser's recorder produced: the server copies H.264 and re-encodes anything else */
  codec: z.enum(["h264", "vp8", "vp9", "av1"]).default("vp8"),
});
export type IngestQuery = z.infer<typeof ingestQuerySchema>;

export type ShowState = "IDLE" | "LIVE" | "ENDED";

export interface StudioShowRow {
  id: string;
  title: string;
  state: ShowState;
  match: { id: string; title: string; subtitle: string } | null;
  liveSince: string | null;
  updatedAt: string;
}

export interface StudioShow extends StudioShowRow {
  destinationIds: string[];
  config: StudioConfig;
  /** public watch link while live */
  watchPath: string;
}

export interface StudioStatus {
  state: ShowState;
  liveSince: string | null;
  /** the server is receiving chunks right now */
  receiving: boolean;
  /** seconds since the last chunk (null = none yet) */
  lastChunkAgo: number | null;
  destinations: { id: string; name: string; ok: boolean }[];
  youtube: { title: string; watchUrl: string | null; ok: boolean; error: string | null } | null;
  error: string | null;
}
