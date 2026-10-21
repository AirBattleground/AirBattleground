/**
 * 7XEN Studio worker — runs Studio shows on this computer.
 * Polls the website every 2 s; when a manager starts a show "on this worker" it opens the show's render page in
 * headless Chrome, encodes it with ffmpeg (GPU when possible) and publishes it to the site's media server.
 */
import os from "node:os";
import { STUDIO_FPS, WORKER_VIDEO_KBPS } from "@7xen/shared";
import { makeBoxInfo, makePoll } from "./api.js";
import { ConfigError, loadConfig } from "./config.js";
import { detectEncoder } from "./encoder.js";
import { JobRunner } from "./job.js";
import { log } from "./log.js";
import { makePollStep } from "./loop.js";
import { realPipeline } from "./pipeline.js";

async function main() {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      log.error(err.message);
      process.exit(1);
    }
    throw err;
  }
  log.info(`7XEN Studio worker ${cfg.version}`, { api: cfg.apiUrl, cpus: os.cpus().length, platform: process.platform });

  const det = await detectEncoder(cfg.ffmpegPath, { override: cfg.encoder, fps: STUDIO_FPS, kbps: WORKER_VIDEO_KBPS });
  for (const [enc, why] of Object.entries(det.skipped)) log.info(`encoder ${enc} not usable`, { why });
  log.info(`Using encoder ${det.encoder}${det.encoder === "libx264" ? " (CPU — a GPU encoder would be lighter)" : " (GPU)"}`);

  const runner = new JobRunner(
    realPipeline({ ffmpegPath: cfg.ffmpegPath, chromePath: cfg.chromePath, chromeArgs: cfg.chromeArgs, encoder: det.encoder, publishBase: cfg.publishBase, localHlsBase: cfg.localHlsBase, boxPublishBase: cfg.boxPublishBase, recordDir: cfg.recordDir }),
  );
  if (cfg.boxUrl) log.info(`Studio Box mode: reporting the box at ${cfg.boxUrl}`);
  const step = makePollStep({
    poll: makePoll(cfg.apiUrl, cfg.workerKey),
    runner,
    version: cfg.version,
    encoder: det.encoder,
    boxInfo: cfg.boxUrl ? makeBoxInfo(cfg.boxUrl) : undefined,
  });

  let stopping = false;
  const health = setInterval(() => void runner.tick(), 500);
  let pollTimer: NodeJS.Timeout | null = null;

  const loop = async () => {
    if (stopping) return;
    const wait = await step().catch((err) => {
      log.error("poll failed", { err });
      return 2000;
    });
    if (!stopping) pollTimer = setTimeout(loop, wait);
  };

  const shutdown = async (signal: string) => {
    if (stopping) process.exit(1); // second Ctrl+C: leave now
    stopping = true;
    log.info(`${signal}: shutting down`);
    clearInterval(health);
    if (pollTimer) clearTimeout(pollTimer);
    await runner.shutdown();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  void loop();
}

main().catch((err) => {
  log.error("Worker crashed", { err });
  process.exit(1);
});
