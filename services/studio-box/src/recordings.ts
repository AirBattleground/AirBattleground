/**
 * "Record on this box": the Studio worker saves finished shows as fragmented MP4 into <dataDir>/recordings; this lists,
 * plays (HTTP Range, so a <video> can seek), downloads and deletes them.
 */
import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, statfs, unlink } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { BoxRecording, BoxRecordings } from "@7xen/shared";
import { HttpError, notFound } from "./http.js";

const FILE_RE = /^[A-Za-z0-9_.-]{1,160}\.mp4$/;
/** a file written to within this long is treated as still recording */
const ACTIVE_MS = 10_000;

/** 2026-10-21_19-05-12_evening-scrim_<showId>.mp4 → parts (best effort for hand-copied files) */
export function parseRecordingName(file: string): { title: string; showId: string | null } {
  const m = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_(.*)_([A-Za-z0-9]{8,40})\.mp4$/.exec(file);
  if (!m) return { title: file.replace(/\.mp4$/, ""), showId: null };
  const title = m[1]!.replace(/-/g, " ").trim();
  return { title: title ? title[0]!.toUpperCase() + title.slice(1) : "Show", showId: m[2]! };
}

export class Recordings {
  constructor(readonly dir: string) {}

  private path(file: string) {
    if (!FILE_RE.test(file)) throw notFound("Recording not found");
    return join(this.dir, file);
  }

  async list(now = Date.now()): Promise<BoxRecordings> {
    await mkdir(this.dir, { recursive: true });
    const items: BoxRecording[] = [];
    for (const file of await readdir(this.dir)) {
      if (!FILE_RE.test(file)) continue;
      const st = await stat(join(this.dir, file)).catch(() => null);
      if (!st?.isFile()) continue;
      items.push({
        file,
        ...parseRecordingName(file),
        sizeBytes: st.size,
        startedAt: st.birthtime.getTime() ? st.birthtime.toISOString() : st.ctime.toISOString(),
        updatedAt: st.mtime.toISOString(),
        recording: now - st.mtimeMs < ACTIVE_MS,
      });
    }
    items.sort((a, b) => b.file.localeCompare(a.file));
    const fs = await statfs(this.dir);
    return { items, disk: { freeBytes: fs.bavail * fs.bsize, totalBytes: fs.blocks * fs.bsize } };
  }

  /** Stream a recording, honouring a single Range ("bytes=a-b"). */
  async send(req: IncomingMessage, res: ServerResponse, file: string, download: boolean) {
    const p = this.path(file);
    const st = await stat(p).catch(() => null);
    if (!st?.isFile()) throw notFound("Recording not found");
    const headers: Record<string, string | number> = {
      "Content-Type": "video/mp4",
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      ...(download ? { "Content-Disposition": `attachment; filename="${file}"` } : {}),
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
    let start = 0;
    let end = st.size - 1;
    if (range && (range[1] || range[2])) {
      if (range[1]) {
        start = Number(range[1]);
        if (range[2]) end = Math.min(end, Number(range[2]));
      } else start = Math.max(0, st.size - Number(range[2]));
      if (start > end || start >= st.size) {
        res.writeHead(416, { "Content-Range": `bytes */${st.size}` }).end();
        return;
      }
      res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${st.size}`, "Content-Length": end - start + 1 });
    } else res.writeHead(200, { ...headers, "Content-Length": st.size });
    if (req.method === "HEAD") return void res.end();
    await new Promise<void>((resolve) => {
      const s = createReadStream(p, { start, end });
      s.on("error", () => {
        res.destroy();
        resolve();
      });
      s.on("end", resolve);
      res.on("close", () => {
        s.destroy();
        resolve();
      });
      s.pipe(res);
    });
  }

  async remove(file: string, now = Date.now()) {
    const p = this.path(file);
    const st = await stat(p).catch(() => null);
    if (!st?.isFile()) throw notFound("Recording not found");
    if (now - st.mtimeMs < ACTIVE_MS) throw new HttpError(409, "CONFLICT", "This show is still recording. Stop it first.");
    await unlink(p);
  }
}
