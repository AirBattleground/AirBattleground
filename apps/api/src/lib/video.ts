/**
 * Phase 4: match video files (manager app recordings).
 *
 * Videos live under VIDEO_DIR (default <STORAGE_DIR>/videos — can point to a bigger disk) and are addressed
 * by keys relative to it, e.g. "2026/10/<recordingId>.mp4" (+ "<recordingId>.jpg" poster next to it).
 * ffmpeg (FFMPEG_PATH, default "ffmpeg") reads duration/size and grabs a poster frame.
 * Like storage.ts this reads env lazily so tests can point VIDEO_DIR at a temp dir.
 */
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, rename, stat, statfs, unlink } from "node:fs/promises";
import path from "node:path";
import type { Request, Response } from "express";
import { notFound } from "./errors.js";
import { newFileId, resolveUnder, storageRoot } from "./storage.js";

export function videoRoot(): string {
  const fromEnv = process.env.VIDEO_DIR?.trim();
  return fromEnv ? path.resolve(fromEnv) : path.join(storageRoot(), "videos");
}

export const resolveVideoKey = (key: string) => resolveUnder(videoRoot(), key);

/** "2026/10/<id>.mp4" */
export function videoKeyFor(recordingId: string, ext: "mp4" | "jpg", now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}/${m}/${recordingId}.${ext}`;
}

/** Free bytes on the disk holding VIDEO_DIR (nearest existing parent), or null when unknown. */
export async function videoFreeBytes(): Promise<number | null> {
  let dir = videoRoot();
  for (;;) {
    try {
      const s = await statfs(dir);
      return Number(s.bavail) * Number(s.bsize);
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }
}

/** Size of the file at `key`, 0 when missing. */
export async function videoFileSize(key: string): Promise<number> {
  try {
    return (await stat(resolveVideoKey(key))).size;
  } catch {
    return 0;
  }
}

export async function deleteVideoKey(key: string | null | undefined): Promise<void> {
  if (!key) return;
  try {
    await unlink(resolveVideoKey(key));
  } catch {
    /* already gone */
  }
}

// ---------------------------------------------------------------- ffmpeg

const ffmpegPath = () => process.env.FFMPEG_PATH?.trim() || "ffmpeg";

function runFfmpeg(args: string[], timeoutMs = 120_000): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => {
      if (stderr.length < 200_000) stderr += d.toString();
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

export interface VideoProbe {
  durationSec: number | null;
  width: number | null;
  height: number | null;
}

/** Parse `ffmpeg -i` output (no ffprobe needed). Exported for tests. */
export function parseFfmpegInfo(stderr: string): VideoProbe {
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const durationSec = d ? Math.round(Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3])) : null;
  let width: number | null = null;
  let height: number | null = null;
  const line = stderr.split("\n").find((l) => /Stream #.*Video:/.test(l));
  const wh = line ? /[\s,](\d{2,5})x(\d{2,5})(?=[\s,\[]|$)/.exec(line) : null;
  if (wh) {
    width = Number(wh[1]);
    height = Number(wh[2]);
    // phones often store portrait/landscape as a rotation flag
    const rot = /rotation of (-?\d+(?:\.\d+)?) degrees|rotate\s*:\s*(-?\d+)/.exec(stderr);
    const deg = rot ? Math.abs(Math.round(Number(rot[1] ?? rot[2]))) % 180 : 0;
    if (deg === 90) [width, height] = [height, width];
  }
  return { durationSec, width, height };
}

export async function probeVideo(abs: string): Promise<VideoProbe> {
  const { stderr } = await runFfmpeg(["-hide_banner", "-i", abs], 60_000);
  const info = parseFfmpegInfo(stderr);
  if (info.durationSec == null && info.width == null) throw new Error(`ffmpeg could not read the video: ${stderr.slice(-300)}`);
  return info;
}

/** Grab one JPEG frame at `atSec` into `posterAbs` (atomic). */
export async function makePoster(videoAbs: string, posterAbs: string, atSec: number): Promise<void> {
  await mkdir(path.dirname(posterAbs), { recursive: true });
  const tmp = `${posterAbs}.${newFileId()}.tmp.jpg`;
  const { code, stderr } = await runFfmpeg([
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    atSec.toFixed(2),
    "-i",
    videoAbs,
    "-frames:v",
    "1",
    "-vf",
    "scale='min(640,iw)':-2",
    "-q:v",
    "4",
    "-y",
    tmp,
  ]);
  try {
    const st = await stat(tmp);
    if (code !== 0 || st.size === 0) throw new Error(`ffmpeg poster failed (${code}): ${stderr.slice(-300)}`);
    await rename(tmp, posterAbs);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e instanceof Error && e.message.startsWith("ffmpeg") ? e : new Error(`ffmpeg poster failed (${code}): ${stderr.slice(-300)}`);
  }
}

// ---------------------------------------------------------------- streaming

/** Parse a single `Range: bytes=…` header. null = no/unsupported range (send everything); "invalid" = 416. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null; // multi-range etc.: ignore, send the whole file
  const [, a, b] = m;
  if (a === "" && b === "") return "invalid";
  let start: number;
  let end: number;
  if (a === "") {
    const suffix = Number(b);
    if (suffix === 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (start >= size || start > end) return "invalid";
  return { start, end };
}

/** Stream a file with HTTP Range support (206 partial content). 404 when missing. */
export async function sendRangeFile(req: Request, res: Response, abs: string, mime: string): Promise<void> {
  let size: number;
  try {
    const st = await stat(abs);
    if (!st.isFile()) throw new Error("not a file");
    size = st.size;
  } catch {
    throw notFound("Video not found");
  }
  res.setHeader("Content-Type", mime);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const range = parseRange(req.headers.range, size);
  if (range === "invalid") {
    res.setHeader("Content-Range", `bytes */${size}`);
    res.status(416).end();
    return;
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  if (range) {
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
  }
  res.setHeader("Content-Length", String(size === 0 ? 0 : end - start + 1));
  if (req.method === "HEAD" || size === 0) {
    res.end();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(abs, { start, end });
    stream.on("error", reject);
    res.on("finish", () => resolve());
    res.on("close", () => {
      stream.destroy();
      resolve();
    });
    stream.pipe(res);
  });
}
