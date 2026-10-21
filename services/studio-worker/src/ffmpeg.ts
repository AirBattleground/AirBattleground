/** One ffmpeg process: WebM chunks in on stdin (with backpressure), FLV out to RTMP, progress → kbps. */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { ffmpegArgs, ProgressMeter, type Encoder } from "./encoder.js";
import { log, rateLimited } from "./log.js";

export interface FfmpegOpts {
  ffmpegPath: string;
  encoder: Encoder;
  fps: number;
  kbps: number;
  cores: number;
  /** RTMP publish URL(s) (or a local file path for the smoke test); several → tee muxer, none → encode only */
  output: string | string[];
  /** tee muxer even for one output (box jobs) */
  tee?: boolean;
  /** display names of the outputs, same order (per-output health) */
  outputNames?: string[];
  /** called once when the process ends for any reason */
  onExit: (reason: string) => void;
}

/** ffmpeg output line safe to log: stream keys / publish tokens after the RTMP app name are cut off. */
export const redactKeys = (line: string) => line.replace(/(rtmps?:\/\/[^/\s]+\/[^/\s?']+\/)[^\s'|]+/g, "$1…");

export class FfmpegPipe {
  private child: ChildProcessWithoutNullStreams;
  private exited = false;
  /** stop() was called — the demuxer's "File ended prematurely" is expected then */
  private stopping = false;
  private lastStderr = "";
  readonly meter = new ProgressMeter();
  /** tee outputs that failed (their names); the others keep going */
  readonly failedOutputs: string[] = [];
  bytesIn = 0;

  constructor(private readonly opts: FfmpegOpts) {
    const args = ffmpegArgs(opts.encoder, { fps: opts.fps, kbps: opts.kbps, cores: opts.cores, output: opts.output, tee: opts.tee });
    log.debug("ffmpeg start", { args: args.join(" ").replace(/\?wtoken=[^\s|]+/g, "?wtoken=…") });
    this.child = spawn(opts.ffmpegPath, args, { stdio: ["pipe", "pipe", "pipe"] });
    const warn = rateLimited(10, 30_000);
    this.child.stdout.setEncoding("utf8").on("data", (t: string) => this.meter.feed(t));
    this.child.stderr.setEncoding("utf8").on("data", (t: string) => {
      for (const line of t.split("\n").map((l) => redactKeys(l.trim())).filter(Boolean)) {
        this.lastStderr = line;
        const failed = /Slave muxer #(\d+) failed/.exec(line);
        if (failed) {
          const name = opts.outputNames?.[Number(failed[1])] ?? `output ${Number(failed[1]) + 1}`;
          if (!this.failedOutputs.includes(name)) this.failedOutputs.push(name);
          log.warn(`Stopped sending to ${name}: ${line.replace(/^.*failed:\s*/, "")}`);
        }
        if (!this.stopping) warn((dropped) => log.warn(`ffmpeg: ${line}`, dropped ? { dropped } : undefined));
      }
    });
    // a broken pipe after ffmpeg died surfaces here — the exit handler reports it
    this.child.stdin.on("error", () => {});
    this.child.on("error", (err) => this.finish(`ffmpeg could not start: ${err.message}`));
    this.child.on("close", (code, signal) =>
      this.finish(`ffmpeg stopped (${signal ?? `code ${code}`})${this.lastStderr ? `: ${this.lastStderr}` : ""}`),
    );
  }

  get alive() {
    return !this.exited;
  }

  private finish(reason: string) {
    if (this.exited) return;
    this.exited = true;
    this.opts.onExit(reason.slice(0, 300));
  }

  /** Write one chunk; resolves once ffmpeg can take more (so the page slows down instead of us buffering). */
  async write(buf: Buffer): Promise<void> {
    if (this.exited || this.child.stdin.destroyed) return;
    this.bytesIn += buf.length;
    if (this.child.stdin.write(buf)) return;
    await new Promise<void>((resolve) => {
      const done = () => {
        this.child.stdin.off("drain", done);
        this.child.off("close", done);
        resolve();
      };
      this.child.stdin.once("drain", done);
      this.child.once("close", done);
    });
  }

  /** End stdin (ffmpeg flushes and closes the stream cleanly), kill after `graceMs`. */
  async stop(graceMs = 3000): Promise<void> {
    if (this.exited) return;
    this.stopping = true;
    const closed = new Promise<void>((r) => this.child.once("close", () => r()));
    this.child.stdin.end();
    const timer = setTimeout(() => this.child.kill("SIGKILL"), graceMs);
    await closed;
    clearTimeout(timer);
  }
}
