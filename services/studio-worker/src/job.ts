/**
 * Job runner: keeps the show the API asked for running.
 *
 *   setJob(null)            → stop whatever runs (idle)
 *   setJob(new showId)      → stop the old show, start the new one (starting → live once chunks flow and ffmpeg sends)
 *   setJob(same showId)     → keep running (the fresh job — new publish token — is used on the next restart)
 *   tick() (twice a second) → no chunk for 10 s (30 s right after a start) → restart; retries back off 2,4,8..30 s
 *
 * A "pipeline" is Chrome + ffmpeg together: the WebM header only comes in the page recorder's first chunk, so the
 * two always restart as a pair. Everything is serialized through one queue so a poll and a crash never race.
 */
import type { RenderStatus, WorkerJob, WorkerPollInput, WorkerState } from "@7xen/shared";
import { log } from "./log.js";

export interface PipelineHooks {
  /** a chunk reached ffmpeg */
  chunk(): void;
  status(s: RenderStatus): void;
  /** Chrome or ffmpeg died */
  exit(reason: string): void;
}

export interface Pipeline {
  /** what ffmpeg is sending (kbps) */
  kbps(): number | null;
  /** optional: the output is really going out (ffmpeg connected and writing) — "live" waits for it */
  flowing?(): boolean;
  /** optional: a non-fatal problem to report (e.g. one of several destinations failed) */
  warning?(): string | null;
  stop(): Promise<void>;
}

export type StartPipeline = (job: WorkerJob, hooks: PipelineHooks) => Promise<Pipeline>;

export interface RunnerOpts {
  now?: () => number;
  /** no chunk for this long while running → restart */
  stallMs?: number;
  /** allowance for Chrome to start and the page to send its first chunk */
  firstChunkMs?: number;
  /** live this long without trouble → the retry backoff starts over */
  healthyMs?: number;
}

export function backoffMs(failures: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(1, failures));
}

export class JobRunner {
  state: WorkerState = "idle";
  job: WorkerJob | null = null;
  error: string | null = null;
  private pageFps: number | null = null;
  private pageError: string | null = null;
  private pipeline: Pipeline | null = null;
  private gen = 0;
  private failures = 0;
  private nextAttemptAt: number | null = null;
  private startedAt = 0;
  private lastChunkAt: number | null = null;
  private liveSince: number | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  private readonly stallMs: number;
  private readonly firstChunkMs: number;
  private readonly healthyMs: number;

  constructor(
    private readonly start: StartPipeline,
    opts: RunnerOpts = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.stallMs = opts.stallMs ?? 10_000;
    this.firstChunkMs = opts.firstChunkMs ?? 30_000;
    this.healthyMs = opts.healthyMs ?? 30_000;
  }

  private enqueue(fn: () => Promise<void> | void): Promise<void> {
    this.queue = this.queue.then(fn).catch((err) => log.error("runner error", { err }));
    return this.queue;
  }

  /** What the poll reports. */
  snapshot(): Pick<WorkerPollInput, "state" | "showId" | "fps" | "bitrateKbps" | "error"> {
    return {
      state: this.state,
      showId: this.job?.showId ?? null,
      fps: this.pipeline ? this.pageFps : null,
      bitrateKbps: this.pipeline ? this.pipeline.kbps() : null,
      error: (this.error ?? (this.pipeline ? (this.pageError ?? this.pipeline.warning?.() ?? null) : null))?.slice(0, 300) ?? null,
    };
  }

  setJob(job: WorkerJob | null): Promise<void> {
    return this.enqueue(async () => {
      if (!job) {
        if (this.job) log.info("Show stopped", { showId: this.job.showId });
        await this.teardown();
        this.job = null;
        this.state = "idle";
        this.error = null;
        this.failures = 0;
        this.nextAttemptAt = null;
        return;
      }
      if (this.job?.showId === job.showId) {
        this.job = job;
        return;
      }
      if (this.job) log.info("Switching show", { from: this.job.showId, to: job.showId });
      await this.teardown();
      this.job = job;
      this.failures = 0;
      this.error = null;
      log.info("Starting show", { showId: job.showId, title: job.title });
      await this.launch();
    });
  }

  tick(): Promise<void> {
    return this.enqueue(async () => {
      const now = this.now();
      if (!this.job) return;
      if (!this.pipeline) {
        if (this.nextAttemptAt !== null && now >= this.nextAttemptAt) await this.launch();
        return;
      }
      const since = this.lastChunkAt ?? this.startedAt;
      const limit = this.lastChunkAt === null ? this.firstChunkMs : this.stallMs;
      if (now - since > limit) {
        await this.fail(
          this.lastChunkAt === null
            ? `The render page sent no video within ${Math.round(limit / 1000)} s`
            : `No video from the render page for ${Math.round(limit / 1000)} s`,
          this.gen,
        );
        return;
      }
      this.maybeLive();
      if (this.state === "live" && this.liveSince !== null && now - this.liveSince > this.healthyMs) this.failures = 0;
    });
  }

  /** Stop everything (shutdown). */
  shutdown(): Promise<void> {
    return this.setJob(null);
  }

  private maybeLive() {
    if (this.state !== "starting" || this.lastChunkAt === null || !this.pipeline) return;
    if (this.pipeline.flowing && !this.pipeline.flowing()) return;
    this.state = "live";
    this.liveSince = this.now();
    this.error = null;
    log.info("Live", { showId: this.job?.showId });
  }

  private async launch() {
    const job = this.job;
    if (!job) return;
    const g = ++this.gen;
    this.state = "starting";
    this.nextAttemptAt = null;
    this.startedAt = this.now();
    this.lastChunkAt = null;
    this.liveSince = null;
    this.pageFps = null;
    this.pageError = null;
    const hooks: PipelineHooks = {
      chunk: () => {
        if (g !== this.gen) return;
        this.lastChunkAt = this.now();
        this.maybeLive();
      },
      status: (s) => {
        if (g !== this.gen) return;
        this.pageFps = s.fps;
        this.pageError = s.error;
      },
      exit: (reason) => {
        if (g === this.gen) void this.enqueue(() => this.fail(reason, g));
      },
    };
    try {
      const p = await this.start(job, hooks);
      if (g !== this.gen) {
        // something failed (or the job changed) while we were starting
        await p.stop();
        return;
      }
      this.pipeline = p;
      this.maybeLive();
    } catch (err) {
      await this.fail(err instanceof Error ? err.message : String(err), g);
    }
  }

  private async fail(reason: string, g: number) {
    if (g !== this.gen || !this.job) return;
    await this.teardown();
    this.failures++;
    this.state = "error";
    this.error = reason.slice(0, 300);
    const wait = backoffMs(this.failures);
    this.nextAttemptAt = this.now() + wait;
    log.warn(`${reason} — retrying in ${Math.round(wait / 1000)} s`, { showId: this.job.showId });
  }

  private async teardown() {
    this.gen++;
    const p = this.pipeline;
    this.pipeline = null;
    this.lastChunkAt = null;
    this.liveSince = null;
    if (p) await p.stop().catch((err) => log.warn("stop failed", { err }));
  }
}
