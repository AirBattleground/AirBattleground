/** The real pipeline: ffmpeg first (so it's ready for the WebM header), then Chrome on the render page. */
import os from "node:os";
import type { WorkerJob } from "@7xen/shared";
import { RenderBrowser } from "./browser.js";
import type { Encoder } from "./encoder.js";
import { FfmpegPipe } from "./ffmpeg.js";
import { log } from "./log.js";
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
  /** phase 8c: RTMP base of the Studio Box's own media server (see Config.boxPublishBase) */
  boxPublishBase?: string | null;
}

/** rtmp://host:1935/live/show_x?wtoken=… + rtmp://127.0.0.1:1937/live → rtmp://127.0.0.1:1937/live/show_x?wtoken=… */
export function publishTarget(publishUrl: string, base: string | null | undefined): string {
  if (!base) return publishUrl;
  const i = publishUrl.lastIndexOf("/");
  return i < 0 ? publishUrl : `${base}${publishUrl.slice(i)}`;
}

export interface PublishPlan {
  /** RTMP URLs ffmpeg sends to (empty = encode only) */
  urls: string[];
  /** display name per URL (logs / per-output health) */
  names: string[];
  /** use the tee muxer (box jobs), even for one URL */
  tee: boolean;
}

/**
 * Where a job's finished stream goes.
 *   - no `outputs` (phase 8b website worker): job.publishUrl (or its PUBLISH_RTMP_BASE rewrite) — unchanged
 *   - box job: every output + publishUrl when sendToAws, all at once (tee), plus a copy on the box's own media server
 *     (BOX_RTMP_BASE) for the Studio preview. With no outputs and no AWS copy and no BOX_RTMP_BASE, PUBLISH_RTMP_BASE
 *     is used for that local copy; without either, the show is encoded but sent nowhere.
 */
export function publishPlan(job: WorkerJob, o: { publishBase?: string | null; boxPublishBase?: string | null }): PublishPlan {
  if (job.outputs === undefined) return { urls: [publishTarget(job.publishUrl, o.publishBase)], names: ["AirBattleground"], tee: false };
  const urls: string[] = [];
  const names: string[] = [];
  const add = (url: string, name: string) => {
    if (urls.includes(url)) return;
    urls.push(url);
    names.push(name);
  };
  for (const out of job.outputs) add(out.url, out.name);
  if (job.sendToAws) add(publishTarget(job.publishUrl, o.publishBase), "AirBattleground");
  const local = o.boxPublishBase ?? (urls.length === 0 ? o.publishBase : null);
  if (local) add(publishTarget(job.publishUrl, local), "Studio box preview");
  return { urls, names, tee: true };
}

export async function startRealPipeline(cfg: PipelineConfig, job: WorkerJob, hooks: PipelineHooks): Promise<Pipeline> {
  const plan: PublishPlan = cfg.output ? { urls: [cfg.output], names: ["file"], tee: false } : publishPlan(job, cfg);
  if (job.outputs !== undefined) {
    if (plan.urls.length) log.info(`Sending the show to ${plan.names.join(", ")}`, { showId: job.showId });
    else log.warn("No destinations for this show and no BOX_RTMP_BASE — encoding only, sending it nowhere", { showId: job.showId });
  }
  const ffmpeg = new FfmpegPipe({
    ffmpegPath: cfg.ffmpegPath,
    encoder: cfg.encoder,
    fps: job.fps,
    kbps: job.videoKbps,
    cores: os.cpus().length,
    output: plan.urls,
    tee: plan.tee,
    outputNames: plan.names,
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
  return {
    kbps: () => ffmpeg.meter.kbps,
    flowing: () => ffmpeg.alive && ffmpeg.meter.outSeconds > 0,
    warning: () => (ffmpeg.failedOutputs.length ? `Not sending to ${ffmpeg.failedOutputs.join(", ")} (destination refused or dropped)` : null),
    stop,
  };
}

export const realPipeline =
  (cfg: PipelineConfig): StartPipeline =>
  (job, hooks) =>
    startRealPipeline(cfg, job, hooks);
