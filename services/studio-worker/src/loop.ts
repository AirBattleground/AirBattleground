/** The poll loop: report state every 2 s, apply the job the API answers with. */
import { WORKER_GONE_MS, type WorkerPollInput } from "@7xen/shared";
import type { BoxInfoSource, Poll } from "./api.js";
import type { JobRunner } from "./job.js";
import { log } from "./log.js";

export const POLL_MS = 2000;
export const UNAUTHORIZED_RETRY_MS = 30_000;

export interface LoopDeps {
  poll: Poll;
  runner: JobRunner;
  version: string;
  encoder: string;
  /** phase 8c: the Studio Box on this machine (BOX_URL) — reported in every poll as `box` */
  boxInfo?: BoxInfoSource;
  now?: () => number;
}

/** One poll round; returns how long to wait before the next one. */
export function makePollStep(d: LoopDeps) {
  const now = d.now ?? Date.now;
  let lastOkAt = now();
  let warnedOffline = false;
  let announced = false;
  let boxDown = false;

  return async function step(): Promise<number> {
    const body: WorkerPollInput = { version: d.version, encoder: d.encoder, ...d.runner.snapshot() };
    if (d.boxInfo) {
      const box = await d.boxInfo();
      if (box) body.box = box;
      if (!box && !boxDown) log.warn("The Studio box on this computer isn't answering (BOX_URL) — is studio-box running?");
      else if (box && boxDown) log.info("Studio box found", { lanUrl: box.lanUrl });
      boxDown = !box;
    }
    const r = await d.poll(body);
    if (r.kind === "ok") {
      lastOkAt = now();
      if (!announced || warnedOffline) log.info(`Connected as worker "${r.res.worker.name}"`);
      announced = true;
      warnedOffline = false;
      void d.runner.setJob(r.res.job); // queued — starting Chrome mustn't hold up the next poll
      return POLL_MS;
    }
    if (r.kind === "unauthorized") {
      log.error("Unknown worker key — copy it from Studio → Workers on the website into .env (WORKER_KEY)");
      await d.runner.setJob(null);
      return UNAUTHORIZED_RETRY_MS;
    }
    // network trouble: the show keeps going (the stream still flows to the media server) unless it lasts too long
    const down = now() - lastOkAt;
    if (!warnedOffline) log.warn("Can't reach the website, retrying", { error: r.message });
    warnedOffline = true;
    if (down > WORKER_GONE_MS && d.runner.job) {
      log.warn(`Website unreachable for ${Math.round(down / 1000)} s — stopping the show`);
      await d.runner.setJob(null);
    }
    return POLL_MS;
  };
}
