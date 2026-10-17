/**
 * Capture pipeline: scrcpy records the device screen as Matroska into a FIFO, ffmpeg copies the H.264
 * stream (no re-encode) into two outputs with the tee muxer:
 *   (a) a fragmented MP4 "part" in the session work dir (crash-safe: every keyframe is a fragment)
 *   (b) a live HLS playlist + MPEG-TS segments in STORAGE_DIR/live/<matchId>/
 *
 * Rotation: scrcpy follows the display rotation and restarts its encoder with the new size; the new
 * SPS/PPS travel in-band, so ffmpeg keeps going and both outputs carry the size change (tested on the
 * bgmi14 AVD). If scrcpy or ffmpeg dies anyway (adb hiccup, encoder error), the pipeline restarts as a new
 * part: the MP4 continues in part N+1 (joined on stop) and the HLS playlist is appended to
 * (`append_list` → #EXT-X-DISCONTINUITY) with segment names p<N>-xxxxx.ts.
 */
import { EventEmitter } from "node:events";
import { constants as fsc } from "node:fs";
import { appendFile, mkdir, open, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { log } from "./log.js";
import { run, terminate, waitExit, type Proc, type Spawner } from "./proc.js";

export interface PipelineOptions {
  spawner: Spawner;
  scrcpy: string;
  scrcpyServer: string;
  adb: string;
  ffmpeg: string;
  serial: string;
  /** session work dir: FIFOs + MP4 parts */
  workDir: string;
  /** HLS output dir (STORAGE_DIR/live/<matchId>) */
  liveDir: string;
  maxSize: number;
  bitrateMbps: number;
  maxFps: number;
  hlsTime: number;
  hlsListSize: number;
  maxRestarts: number;
  /** how long both processes must stay up for a part to count as started */
  settleMs?: number;
  restartDelayMs?: number;
  /** test hooks */
  mkfifo?: (file: string) => Promise<void>;
  unblockFifo?: (file: string) => Promise<void>;
}

export const PLAYLIST = "index.m3u8";

async function realMkfifo(file: string) {
  await rm(file, { force: true });
  const r = await run("mkfifo", ["-m", "600", file], { timeoutMs: 5000 });
  if (r.code !== 0) throw new Error(`mkfifo failed: ${r.stderr}`);
}

/** If ffmpeg is still blocked opening the FIFO (scrcpy never connected), give it an EOF. */
async function realUnblockFifo(file: string) {
  try {
    const fh = await open(file, fsc.O_WRONLY | fsc.O_NONBLOCK);
    await fh.close();
  } catch {
    /* no reader (ENXIO) or already gone: nothing to unblock */
  }
}

export function scrcpyArgs(o: Pick<PipelineOptions, "serial" | "maxSize" | "bitrateMbps" | "maxFps">, fifo: string): string[] {
  const args = [
    `--serial=${o.serial}`,
    "--no-window",
    "--no-audio",
    "--no-control",
    `--record=${fifo}`,
    "--record-format=mkv",
    `--max-fps=${o.maxFps}`,
    `--video-bit-rate=${o.bitrateMbps}M`,
    // ~1 s keyframes → ~2 s HLS segments (the integer form is ignored by the emulator's encoder)
    "--video-codec-options=i-frame-interval:float=0.5",
  ];
  if (o.maxSize > 0) args.push(`--max-size=${o.maxSize}`);
  return args;
}

export function ffmpegArgs(o: Pick<PipelineOptions, "hlsTime" | "hlsListSize" | "liveDir">, fifo: string, partFile: string, part: number): string[] {
  const flags = ["delete_segments", "independent_segments", "omit_endlist", ...(part > 0 ? ["append_list"] : [])].join("+");
  const hls = [
    "f=hls",
    "onfail=ignore", // a broken live stream must never stop the recording
    `hls_time=${o.hlsTime}`,
    `hls_list_size=${o.hlsListSize}`,
    `hls_flags=${flags}`,
    `hls_segment_filename=${path.join(o.liveDir, `p${part}-%05d.ts`)}`,
  ].join(":");
  return [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-fflags",
    "+genpts",
    "-i",
    fifo,
    "-map",
    "0:v",
    "-c",
    "copy",
    "-f",
    "tee",
    `[f=mp4:movflags=+frag_keyframe+empty_moov]${partFile}|[${hls}]${path.join(o.liveDir, PLAYLIST)}`,
  ];
}

/** Make sure a (final) playlist ends with #EXT-X-ENDLIST. */
export async function endPlaylist(liveDir: string): Promise<void> {
  const file = path.join(liveDir, PLAYLIST);
  try {
    const text = await readFile(file, "utf8");
    if (!text.includes("#EXT-X-ENDLIST")) await appendFile(file, (text.endsWith("\n") ? "" : "\n") + "#EXT-X-ENDLIST\n");
  } catch {
    /* no playlist was written */
  }
}

/**
 * Events: "restart" (part, reason) after an unexpected exit was recovered; "failed" (message) when the
 * pipeline gave up (restarts exhausted). After "failed" the existing parts are still there to finalise.
 */
export class CapturePipeline extends EventEmitter {
  readonly parts: string[] = [];
  private scrcpy: Proc | null = null;
  private ffmpeg: Proc | null = null;
  private fifo = "";
  private stopping = false;
  private dead = false;
  private restarts = 0;
  private restarting: Promise<void> | null = null;
  private readonly mkfifo: (f: string) => Promise<void>;
  private readonly unblock: (f: string) => Promise<void>;

  constructor(private readonly o: PipelineOptions) {
    super();
    this.mkfifo = o.mkfifo ?? realMkfifo;
    this.unblock = o.unblockFifo ?? realUnblockFifo;
  }

  get pids(): number[] {
    return [this.scrcpy?.pid, this.ffmpeg?.pid].filter((p): p is number => typeof p === "number");
  }

  get running(): boolean {
    return !this.dead && !!this.scrcpy && !this.scrcpy.exited;
  }

  async start(): Promise<void> {
    await mkdir(this.o.workDir, { recursive: true });
    await mkdir(this.o.liveDir, { recursive: true });
    await this.startPart();
  }

  private async startPart(): Promise<void> {
    const n = this.parts.length;
    const fifo = path.join(this.o.workDir, `cap-${n}.mkv`);
    const part = path.join(this.o.workDir, `part-${String(n).padStart(3, "0")}.mp4`);
    await this.mkfifo(fifo);
    this.fifo = fifo;
    this.parts.push(part);

    const ffmpeg = this.o.spawner(this.o.ffmpeg, ffmpegArgs(this.o, fifo, part, n));
    const scrcpy = this.o.spawner(this.o.scrcpy, scrcpyArgs(this.o, fifo), {
      env: { ...process.env, ADB: this.o.adb, SCRCPY_SERVER_PATH: this.o.scrcpyServer },
    });
    this.ffmpeg = ffmpeg;
    this.scrcpy = scrcpy;
    log.info("capture part started", { part: n, scrcpy: scrcpy.pid, ffmpeg: ffmpeg.pid });

    let handled = false; // scrcpy and ffmpeg usually die together: recover once per part
    const onExit = (who: "scrcpy" | "ffmpeg") => (code: number | null, signal: string | null) => {
      if (handled || this.stopping || this.dead || this.scrcpy !== scrcpy) return;
      handled = true;
      const proc = who === "scrcpy" ? scrcpy : ffmpeg;
      const reason = `${who} exited (${signal ?? code}): ${proc.output().trim().split("\n").slice(-3).join(" | ")}`;
      log.warn("capture process died", { part: n, reason });
      this.restarting = this.recover(reason);
    };
    scrcpy.once("exit", onExit("scrcpy"));
    ffmpeg.once("exit", onExit("ffmpeg"));

    // both must survive the first moments (device found, encoder started, FIFO opened)
    const settle = this.o.settleMs ?? 1500;
    const early = await Promise.race([
      waitExit(scrcpy, settle).then((x) => (x ? "scrcpy" : null)),
      waitExit(ffmpeg, settle).then((x) => (x ? "ffmpeg" : null)),
    ]);
    if (early && n === 0) {
      // the very first start failed: report instead of retrying blindly
      const out = (early === "scrcpy" ? scrcpy : ffmpeg).output().trim().split("\n").slice(-4).join(" | ");
      this.dead = true;
      await this.killCurrent();
      throw new Error(`${early} could not start: ${out || "no output"}`);
    }
  }

  private async killCurrent() {
    const { scrcpy, ffmpeg, fifo } = this;
    if (scrcpy) await terminate(scrcpy, "SIGINT", 5000);
    if (ffmpeg && !ffmpeg.exited) {
      if (!(await waitExit(ffmpeg, 10_000))) {
        await this.unblock(fifo);
        if (!(await waitExit(ffmpeg, 3000))) await terminate(ffmpeg, "SIGINT", 5000);
      }
    }
  }

  private async recover(reason: string): Promise<void> {
    await this.killCurrent();
    if (this.stopping) return;
    if (this.restarts >= this.o.maxRestarts) {
      this.dead = true;
      this.emit("failed", `Capture stopped after ${this.restarts} restarts: ${reason}`);
      return;
    }
    this.restarts++;
    await new Promise((r) => setTimeout(r, this.o.restartDelayMs ?? 1000));
    if (this.stopping) return;
    try {
      await this.startPart();
      this.emit("restart", this.parts.length - 1, reason);
    } catch (err) {
      this.restarting = this.recover(err instanceof Error ? err.message : String(err));
    }
  }

  /** Stop recording: scrcpy gets SIGINT (finalises the Matroska stream), ffmpeg drains and exits. */
  async stop(): Promise<string[]> {
    this.stopping = true;
    if (this.restarting) await this.restarting.catch(() => {});
    await this.killCurrent();
    await endPlaylist(this.o.liveDir);
    await rm(this.fifo, { force: true }).catch(() => {});
    return [...this.parts];
  }
}
