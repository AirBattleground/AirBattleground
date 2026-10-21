/** The real pipeline: ffmpeg first (so it's ready for the WebM header), then Chrome on the render page. */
import os from "node:os";
import type { WorkerJob } from "@7xen/shared";
import { RenderBrowser } from "./browser.js";
import type { Encoder } from "./encoder.js";
import { FfmpegPipe } from "./ffmpeg.js";
import type { Pipeline, PipelineHooks, StartPipeline } from "./job.js";

export interface PipelineConfig {
  ffmpegPath: string;
  chromePath: string | null;
  chromeArgs: string[];
  encoder: Encoder;
  /** override the job's publish URL (smoke test writes a local file) */
  output?: string;
  /** RTMP base to publish to instead of the job's (see Config.publishBase) */
  publishBase?: string | null;
  /** local media server HLS base for the phone feeds (see Config.localHlsBase) */
  localHlsBase?: string | null;
}

/** rtmp://host:1935/live/show_x?wtoken=… + rtmp://127.0.0.1:1937/live → rtmp://127.0.0.1:1937/live/show_x?wtoken=… */
export function publishTarget(publishUrl: string, base: string | null | undefined): string {
  if (!base) return publishUrl;
  const i = publishUrl.lastIndexOf("/");
  return i < 0 ? publishUrl : `${base}${publishUrl.slice(i)}`;
}

export async function startRealPipeline(cfg: PipelineConfig, job: WorkerJob, hooks: PipelineHooks): Promise<Pipeline> {
  const ffmpeg = new FfmpegPipe({
    ffmpegPath: cfg.ffmpegPath,
    encoder: cfg.encoder,
    fps: job.fps,
    kbps: job.videoKbps,
    cores: os.cpus().length,
    output: cfg.output ?? publishTarget(job.publishUrl, cfg.publishBase),
    onExit: hooks.exit,
  });
  const browser = new RenderBrowser({
    url: job.renderUrl,
    chromePath: cfg.chromePath,
    extraArgs: cfg.chromeArgs,
    cookie: { name: job.session.cookieName, value: job.session.token },
    deviceHls: cfg.localHlsBase && job.mediaReadToken ? { base: cfg.localHlsBase, token: job.mediaReadToken } : null,
    onChunk: async (buf) => {
      await ffmpeg.write(buf);
      hooks.chunk();
    },
    onStatus: hooks.status,
    onExit: hooks.exit,
  });
  const stop = async () => {
    await browser.stop();
    await ffmpeg.stop(3000);
  };
  try {
    await browser.start();
  } catch (err) {
    await stop();
    throw err;
  }
  return { kbps: () => ffmpeg.meter.kbps, flowing: () => ffmpeg.alive && ffmpeg.meter.outSeconds > 0, stop };
}

export const realPipeline =
  (cfg: PipelineConfig): StartPipeline =>
  (job, hooks) =>
    startRealPipeline(cfg, job, hooks);
