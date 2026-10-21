/**
 * Phase 8b — Studio worker: a manager's own (powerful) computer runs the Studio show instead of the browser tab.
 *
 *   iPhone ──► EC2 media ──► worker PC: headless Chrome renders /studio-render/:showId (the same StudioMixer the
 *   console uses) → MediaRecorder chunks → local ffmpeg (GPU H.264 when available) ──► RTMP live/show_<id> on EC2
 *   ──► EC2 relays it unchanged (no re-encode) to the Live page, the site YouTube channel and stream keys.
 *
 * The Studio console works exactly as before; when a show "runs on" a worker, the console's actions (take a scene,
 * overlays, scenes, match) are mirrored to the worker through the show's control state, and closing the console
 * doesn't stop the show — only "End show" (or the worker going away for 60 s) does.
 *
 * MANAGER (role MANAGER; own workers / shows only)
 *   GET    /api/manager/studio/workers                         → ListResponse<StudioWorkerRow>
 *   POST   /api/manager/studio/workers        { name }         → { worker: StudioWorkerRow; key: string } (201; the key
 *                                                                is shown once — the worker sends it as X-Worker-Key)
 *   DELETE /api/manager/studio/workers/:id                     → 204 (stops its show if one is running)
 *   POST   /api/manager/studio/shows/:id/start-worker  { workerId }  → StudioStatus
 *                                                                (409 CONFLICT: worker offline / busy / show live in a
 *                                                                browser; sets show.runOn = "worker", state LIVE)
 *   PATCH  /api/manager/studio/shows/:id/control  ShowControlInput → { version: number }
 *   GET    /api/manager/studio/shows/:id/control?since=<version>   → ShowControlState
 *                                                                (long-poll: answers at once when version > since,
 *                                                                else waits up to 25 s and answers with the same state)
 *   POST   /api/manager/studio/shows/:id/stop   (existing) also ends a worker-run show.
 *   PATCH  /api/manager/studio/shows/:id  { config | matchId | title } (existing) bumps the control version too.
 *
 * WORKER (header X-Worker-Key: <key>; no cookies)
 *   POST   /api/studio-worker/poll   WorkerPollInput           → WorkerPollResponse   (every ~2 s; 401 bad key)
 *
 * MEDIA: the worker publishes to WorkerJob.publishUrl = rtmp://<host>:1935/live/show_<showId>?wtoken=<exp>.<sig>;
 *   MediaMTX's auth hook accepts it while the show is LIVE, runs on that worker, and the token hasn't expired.
 *
 * RENDER PAGE (web, /studio-render/:showId, signed in as the show's manager via WorkerJob.session):
 *   The worker exposes two functions on window before the page loads:
 *     window.__swChunk(base64: string): Promise<void>   — one MediaRecorder chunk (WebM, VP8/VP9 + Opus)
 *     window.__swStatus(s: RenderStatus): void           — about once a second
 *   The page renders the program from ShowControlState and records the canvas at RENDER_VIDEO_BPS / STUDIO_FPS.
 */
import { z } from "zod";
import { boxPollInfoSchema, type BoxInfo, type BoxOutput } from "./studioBox";

/** a worker counts as online when it polled within this window */
export const WORKER_ONLINE_MS = 10_000;
/** a worker-run show ends by itself when its worker has been silent this long */
export const WORKER_GONE_MS = 60_000;
/** what the render page records (local, so it can be generous — the worker's ffmpeg sets the broadcast bitrate) */
export const RENDER_VIDEO_BPS = 25_000_000;
/** broadcast video bitrate the worker encodes to (kbps) */
export const WORKER_VIDEO_KBPS = 6000;

export type ShowRunOn = "browser" | "worker";
export type WorkerState = "idle" | "starting" | "live" | "error";

export const createWorkerSchema = z.object({ name: z.string().trim().min(2, "At least 2 characters").max(40) });
export type CreateWorkerInput = z.infer<typeof createWorkerSchema>;

export interface StudioWorkerRow {
  id: string;
  name: string;
  online: boolean;
  state: WorkerState;
  /** ffmpeg encoder in use, e.g. "h264_nvenc" (GPU) or "libx264" (CPU) */
  encoder: string | null;
  /** worker app version */
  version: string | null;
  /** show it's running now */
  showId: string | null;
  lastSeenAt: string | null;
  error: string | null;
  /** phase 8c: set when this worker is a Studio Box */
  box?: BoxInfo | null;
}

export const startWorkerSchema = z.object({ workerId: z.string().min(1) });
export type StartWorkerInput = z.infer<typeof startWorkerSchema>;

/** Live switching state the console mirrors to the worker (config/match/title live on the show itself). */
export const showControlSchema = z.object({
  /** scene on air */
  programId: z.string().max(80).nullable(),
  /** bumped on every Take (so re-taking the same scene, or a fade, replays) */
  takeSeq: z.number().int().min(0),
});
export type ShowControlInput = z.infer<typeof showControlSchema>;

export interface ShowControlState extends ShowControlInput {
  version: number;
  title: string;
  matchId: string | null;
  /** the show's StudioConfig (scenes, overlays, transition, introPropId) */
  config: Record<string, unknown>;
  state: "IDLE" | "LIVE" | "ENDED";
}

export const workerPollSchema = z.object({
  version: z.string().max(40),
  encoder: z.string().max(40).nullable(),
  state: z.enum(["idle", "starting", "live", "error"]),
  showId: z.string().max(40).nullable(),
  /** frames the render page drew in the last second */
  fps: z.number().min(0).max(240).nullable(),
  /** what ffmpeg is sending (kbps) */
  bitrateKbps: z.number().min(0).max(100_000).nullable(),
  error: z.string().max(300).nullable(),
  /** phase 8c: sent by a Studio Box (studioBox.ts) */
  box: boxPollInfoSchema.optional(),
});
export type WorkerPollInput = z.infer<typeof workerPollSchema>;

export interface WorkerJob {
  showId: string;
  title: string;
  /** absolute URL of the render page */
  renderUrl: string;
  /** session cookie for the render page (the show's manager) */
  session: { cookieName: string; token: string };
  /** where to publish the finished stream (RTMP, includes the publish token) */
  publishUrl: string;
  videoKbps: number;
  fps: number;
  /**
   * (additive) token that lets the worker read the manager's phone streams straight from a media server on its own
   * machine (HLS ?rtoken=…), instead of through the API — see the worker's LOCAL_HLS_BASE.
   */
  mediaReadToken?: string;
  /** phase 8c (box only): destinations the box pushes the finished show to (stream keys + site-YouTube ingest) */
  outputs?: BoxOutput[];
  /** phase 8c (box only): also publish publishUrl to AWS for the Live page (false = the Live page embeds YouTube) */
  sendToAws?: boolean;
}

export interface WorkerPollResponse {
  worker: { id: string; name: string };
  /** the show to run now (null = run nothing; stop whatever is running) */
  job: WorkerJob | null;
}

/** What the render page reports through window.__swStatus. */
export interface RenderStatus {
  /** frames drawn in the last second */
  fps: number;
  /** recorder running and chunks flowing */
  recording: boolean;
  error: string | null;
}

/** Added to StudioStatus (GET /shows/:id/status) — additive. */
export interface StudioWorkerStatus {
  runOn: ShowRunOn;
  worker: { id: string; name: string; online: boolean; state: WorkerState; fps: number | null; encoder: string | null; bitrateKbps: number | null; error: string | null } | null;
}
