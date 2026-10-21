/**
 * ffmpeg command lines: which H.264 encoder this machine has (GPU first, CPU libx264 last) and the full
 * "WebM on stdin → H.264/AAC FLV over RTMP" argument list. Everything here except detectEncoder is pure.
 */
import { spawn } from "node:child_process";
import os from "node:os";
import { STUDIO_HEIGHT, STUDIO_WIDTH } from "@7xen/shared";

/**
 * libx264 "faster" only from this many logical cores. Measured on an 8-thread laptop: faster runs 720p60 at 1.1x
 * alone and falls behind real time next to Chrome (which takes ~2.7 cores); veryfast runs at 2.3x.
 */
export const X264_FASTER_CORES = 16;

export type Encoder = "h264_nvenc" | "h264_qsv" | "h264_amf" | "h264_videotoolbox" | "libx264" | (string & {});

export interface VideoOpts {
  fps: number;
  kbps: number;
  /** logical CPU cores (libx264 preset choice: Chrome needs ~3 of them too, so "faster" only with 16+) */
  cores: number;
}

/** Encoders worth trying on this platform, best first. */
export function candidates(platform: NodeJS.Platform = process.platform): Encoder[] {
  if (platform === "darwin") return ["h264_videotoolbox", "libx264"];
  if (platform === "win32") return ["h264_nvenc", "h264_qsv", "h264_amf", "libx264"];
  return ["h264_nvenc", "h264_qsv", "libx264"];
}

export function isHardware(encoder: Encoder): boolean {
  return encoder !== "libx264";
}

/** Video encoder arguments: constant bitrate, no B-frames, a keyframe every 2 s, constant frame rate. */
export function videoArgs(encoder: Encoder, o: VideoOpts): string[] {
  const k = Math.round(o.kbps);
  const rate = ["-b:v", `${k}k`, "-maxrate", `${k}k`, "-bufsize", `${k * 2}k`];
  const gop = ["-g", String(Math.round(o.fps * 2)), "-force_key_frames", "expr:gte(t,n_forced*2)"];
  let codec: string[];
  switch (encoder) {
    case "h264_nvenc":
      codec = ["-c:v", "h264_nvenc", "-preset", "p4", "-tune", "ll", "-rc", "cbr", "-bf", "0", "-profile:v", "high", "-spatial-aq", "1"];
      break;
    case "h264_qsv":
      codec = ["-c:v", "h264_qsv", "-preset", "veryfast", "-bf", "0", "-look_ahead", "0", "-profile:v", "high"];
      break;
    case "h264_amf":
      codec = ["-c:v", "h264_amf", "-usage", "lowlatency", "-quality", "speed", "-rc", "cbr", "-bf", "0", "-profile:v", "high"];
      break;
    case "h264_videotoolbox":
      codec = ["-c:v", "h264_videotoolbox", "-realtime", "1", "-profile:v", "high", "-allow_sw", "1"];
      break;
    case "libx264":
      codec = [
        "-c:v", "libx264",
        "-preset", o.cores >= X264_FASTER_CORES ? "faster" : "veryfast",
        "-tune", "zerolatency",
        "-profile:v", "high",
        "-x264-params", "nal-hrd=cbr:force-cfr=1",
      ];
      break;
    default:
      // an ENCODER override we don't know: just pick it and hope its defaults are sane
      codec = ["-c:v", encoder];
  }
  const pix = ["-pix_fmt", isHardware(encoder) ? "nv12" : "yuv420p"];
  const size = ["-s", `${STUDIO_WIDTH}x${STUDIO_HEIGHT}`, "-fps_mode", "cfr", "-r", String(o.fps)];
  return [...codec, ...rate, ...gop, ...pix, ...size];
}

/** Escape one URL for the tee muxer's slave list (av_get_token: backslash escapes; `|` separates slaves). */
export function escapeTeeUrl(url: string): string {
  return url.replace(/[\\'|[\]]/g, (c) => `\\${c}`);
}

/**
 * tee muxer filename publishing to every URL at once. onfail=ignore: one dead destination (a revoked stream key)
 * doesn't take the others down; ffmpeg only stops when all of them failed.
 */
export function teeTarget(urls: string[]): string {
  return urls.map((u) => `[f=flv:onfail=ignore:flvflags=no_duration_filesize]${escapeTeeUrl(u)}`).join("|");
}

/**
 * Where the encoded show goes: one URL → plain FLV (unchanged phase-8b behaviour); several (or `tee: true`) → the
 * tee muxer; none → encode only (null muxer — nowhere to send it, but the pipeline keeps running).
 */
export function outputArgs(outputs: string[], tee = false): string[] {
  if (outputs.length === 0) return ["-f", "null", "-"];
  if (outputs.length === 1 && !tee) return ["-flvflags", "no_duration_filesize", "-f", "flv", outputs[0]!];
  // FLV wants the codec headers out of band; through tee ffmpeg can't detect that, so ask the encoders for it
  return ["-flags", "+global_header", "-f", "tee", teeTarget(outputs)];
}

/** Full ffmpeg argument list: WebM (MediaRecorder chunks) on stdin → `output` (RTMP URL, or a local .flv in tests). */
export function ffmpegArgs(encoder: Encoder, o: VideoOpts & { output: string | string[]; tee?: boolean }): string[] {
  const outputs = Array.isArray(o.output) ? o.output : [o.output];
  return [
    "-hide_banner", "-loglevel", "warning", "-nostats", "-y",
    "-fflags", "+genpts+discardcorrupt",
    "-f", "webm", "-i", "pipe:0",
    "-map", "0:v:0", "-map", "0:a:0?",
    ...videoArgs(encoder, o),
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
    "-progress", "pipe:1", "-stats_period", "2",
    ...outputArgs(outputs, o.tee),
  ];
}

/** A 1-frame synthetic encode — succeeds only when the encoder (and its GPU/driver) actually works. */
export function probeArgs(encoder: Encoder, o: VideoOpts): string[] {
  return [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", `color=c=black:s=${STUDIO_WIDTH}x${STUDIO_HEIGHT}:r=${o.fps}`,
    "-frames:v", "1",
    ...videoArgs(encoder, o),
    "-f", "null", "-",
  ];
}

export type ProbeRunner = (ffmpegPath: string, args: string[]) => Promise<{ ok: boolean; stdout: string; stderr: string }>;

const runProbe: ProbeRunner = (ffmpegPath, args) =>
  new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let child;
    try {
      child = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      resolve({ ok: false, stdout, stderr: String(err) });
      return;
    }
    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: String(err) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr });
    });
  });

/** `ffmpeg -encoders` output → encoder names */
export function parseEncoders(text: string): Set<string> {
  const names = new Set<string>();
  for (const line of text.split("\n")) {
    const m = /^\s*[VAS][.A-Z]{5}\s+(\S+)/.exec(line);
    if (m && m[1] !== "=") names.add(m[1]!);
  }
  return names;
}

export interface Detection {
  encoder: Encoder;
  /** why the better ones were skipped (encoder → first error line) */
  skipped: Record<string, string>;
}

/**
 * First encoder that encodes one frame. An ENCODER override is still tested (so a typo is reported) but used
 * even if the test fails — the person asked for it. Throws when nothing works (ffmpeg missing).
 */
export async function detectEncoder(
  ffmpegPath: string,
  opts: { override?: string | null; fps: number; kbps: number; platform?: NodeJS.Platform; cores?: number; run?: ProbeRunner },
): Promise<Detection> {
  const run = opts.run ?? runProbe;
  const o: VideoOpts = { fps: opts.fps, kbps: opts.kbps, cores: opts.cores ?? os.cpus().length };
  const skipped: Record<string, string> = {};
  const firstLine = (s: string) => s.trim().split("\n").find((l) => l.trim())?.slice(0, 200) ?? "failed";
  if (opts.override) {
    const r = await run(ffmpegPath, probeArgs(opts.override, o));
    if (!r.ok) skipped[opts.override] = firstLine(r.stderr);
    return { encoder: opts.override, skipped };
  }
  // encoders compiled into this ffmpeg (option errors would otherwise hide "not in this build")
  const list = await run(ffmpegPath, ["-hide_banner", "-encoders"]);
  if (!list.ok) throw new Error(`ffmpeg not found or not working (FFMPEG_PATH=${ffmpegPath}): ${firstLine(list.stderr)}`);
  const built = parseEncoders(list.stdout);
  for (const enc of candidates(opts.platform)) {
    if (!built.has(enc)) {
      skipped[enc] = "not in this ffmpeg build";
      continue;
    }
    const r = await run(ffmpegPath, probeArgs(enc, o));
    if (r.ok) return { encoder: enc, skipped };
    skipped[enc] = firstLine(r.stderr);
  }
  throw new Error(`No working H.264 encoder found (is ffmpeg installed? FFMPEG_PATH=${ffmpegPath}): ${JSON.stringify(skipped)}`);
}

/** Running ffmpeg `-progress` output → kbps actually being sent (from total_size over wall time). */
export class ProgressMeter {
  private buf = "";
  private block: Record<string, string> = {};
  private last: { bytes: number; at: number } | null = null;
  kbps: number | null = null;
  /** seconds of output written so far */
  outSeconds = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** feed raw stdout; returns true when a progress block completed */
  feed(text: string): boolean {
    this.buf += text;
    let completed = false;
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq);
      const val = line.slice(eq + 1).trim();
      this.block[key] = val;
      if (key === "progress") {
        this.finishBlock();
        completed = true;
      }
    }
    return completed;
  }

  private finishBlock() {
    const b = this.block;
    this.block = {};
    const us = Number(b.out_time_us ?? b.out_time_ms);
    if (Number.isFinite(us) && us > 0) this.outSeconds = us / 1e6;
    const bytes = Number(b.total_size);
    const at = this.now();
    if (Number.isFinite(bytes) && bytes >= 0) {
      if (this.last && at > this.last.at && bytes >= this.last.bytes) {
        this.kbps = Math.round(((bytes - this.last.bytes) * 8) / (at - this.last.at));
      }
      this.last = { bytes, at };
    }
    if (this.kbps === null) {
      const m = /([\d.]+)\s*kbits\/s/.exec(b.bitrate ?? "");
      if (m) this.kbps = Math.round(Number(m[1]));
    }
  }
}
