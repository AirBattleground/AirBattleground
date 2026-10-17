/**
 * Turn the recorded MP4 part(s) into the final recording at VIDEO_DIR/<videoKey>: join with ffmpeg's concat
 * demuxer and remux to a normal (faststart) MP4 — no re-encode. Falls back to moving the first part as-is.
 */
import { copyFile, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { log } from "./log.js";
import { run } from "./proc.js";

export interface FinalVideo {
  videoKey: string;
  sizeBytes: number;
  durationSec: number | undefined;
}

export type Finalizer = (parts: string[], videoKey: string) => Promise<FinalVideo>;

/** "Duration: 00:01:02.50" from `ffmpeg -i` → 63 */
export function parseDuration(stderr: string): number | undefined {
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  return d ? Math.round(Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3])) : undefined;
}

const KEY_RE = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)*\.mp4$/;

/** VIDEO_DIR-relative key → absolute path, refusing anything that escapes the root. */
export function resolveVideoKey(videoDir: string, key: string): string {
  if (!KEY_RE.test(key) || key.split("/").some((s) => s === ".." || s.startsWith("."))) throw new Error(`invalid video key: ${key}`);
  const abs = path.resolve(videoDir, key);
  if (!abs.startsWith(path.resolve(videoDir) + path.sep)) throw new Error(`invalid video key: ${key}`);
  return abs;
}

export function makeFinalizer(ffmpeg: string, videoDir: string): Finalizer {
  return async (parts, videoKey) => {
    const usable: string[] = [];
    for (const p of parts) {
      try {
        if ((await stat(p)).size > 1024) usable.push(p);
      } catch {
        /* part never written */
      }
    }
    if (!usable.length) throw new Error("No video was recorded");

    const out = resolveVideoKey(videoDir, videoKey);
    await mkdir(path.dirname(out), { recursive: true });
    const tmp = `${out}.joining.mp4`;
    const list = `${tmp}.txt`;
    await writeFile(list, usable.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
    const r = await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-map", "0:v", "-c", "copy", "-movflags", "+faststart", "-y", tmp], {
      timeoutMs: 30 * 60_000,
    });
    await rm(list, { force: true });
    let ok = false;
    try {
      ok = r.code === 0 && (await stat(tmp)).size > 1024;
    } catch {
      ok = false;
    }
    if (ok) {
      await rename(tmp, out);
    } else {
      log.warn("joining parts failed; keeping the first part as the recording", { code: r.code, err: r.stderr.slice(-300) });
      await rm(tmp, { force: true });
      await copyFile(usable[0]!, out);
    }
    const sizeBytes = (await stat(out)).size;
    const probe = await run(ffmpeg, ["-hide_banner", "-i", out], { timeoutMs: 60_000 });
    return { videoKey, sizeBytes, durationSec: parseDuration(probe.stderr) };
  };
}
