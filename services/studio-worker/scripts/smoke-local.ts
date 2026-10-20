/**
 * Local smoke test — no API needed. Serves a tiny page that draws an animated 1280x720 canvas at 60 fps plus a
 * tone, records it exactly like the real render page should (MediaRecorder → window.__swChunk), and runs the real
 * pipeline (Chrome + ffmpeg) into a local .flv, then ffprobes it.
 *
 *   pnpm --filter @7xen/studio-worker smoke            (SECONDS=20 ENCODER=libx264 OUT=smoke-out/test.flv)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { STUDIO_FPS, WORKER_VIDEO_KBPS, type WorkerJob } from "@7xen/shared";
import { detectEncoder } from "../src/encoder.js";
import { startRealPipeline } from "../src/pipeline.js";
import { testPage } from "./test-page.js";

const SECONDS = Number(process.env.SECONDS_TO_RUN ?? process.env.SECONDS ?? 20);
const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
const ffprobePath = process.env.FFPROBE_PATH || (ffmpegPath.includes("/") ? path.join(path.dirname(ffmpegPath), "ffprobe") : "ffprobe");
const out = path.resolve(process.env.OUT ?? "smoke-out/test.flv");
mkdirSync(path.dirname(out), { recursive: true });



function childCpu(): string {
  if (process.platform !== "linux") return "n/a";
  // sum %CPU (lifetime average) of every descendant of this process
  const rows = execFileSync("ps", ["-eo", "pid=,ppid=,pcpu=,comm="], { encoding: "utf8" })
    .trim()
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .map(([pid, ppid, pcpu, ...comm]) => ({ pid: Number(pid), ppid: Number(ppid), pcpu: Number(pcpu), comm: comm.join(" ") }));
  const mine = new Set([process.pid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of rows) if (mine.has(r.ppid) && !mine.has(r.pid)) (mine.add(r.pid), (grew = true));
  }
  const by: Record<string, number> = {};
  for (const r of rows) if (mine.has(r.pid) && r.comm !== "ps") by[/chrome/i.test(r.comm) ? "chrome" : r.comm] = (by[/chrome/i.test(r.comm) ? "chrome" : r.comm] ?? 0) + r.pcpu;
  return Object.entries(by).map(([k, v]) => `${k}=${v.toFixed(0)}%`).join(" ") + ` (of ${os.cpus().length * 100}%)`;
}

async function main() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(testPage(process.env.MIME));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;

  const det = await detectEncoder(ffmpegPath, { override: process.env.ENCODER || null, fps: STUDIO_FPS, kbps: WORKER_VIDEO_KBPS });
  console.log("encoder:", det.encoder, Object.keys(det.skipped).length ? `(skipped: ${JSON.stringify(det.skipped)})` : "");

  const job: WorkerJob = {
    showId: "smoke",
    title: "Smoke",
    renderUrl: `http://127.0.0.1:${port}/studio-render/smoke`,
    session: { cookieName: "sid", token: "smoke" },
    publishUrl: out,
    videoKbps: WORKER_VIDEO_KBPS,
    fps: STUDIO_FPS,
  };
  let chunks = 0;
  const fpsSamples: number[] = [];
  let exitReason: string | null = null;
  let stopping = false;
  const p = await startRealPipeline(
    { ffmpegPath, chromePath: process.env.CHROME_PATH || null, chromeArgs: (process.env.CHROME_ARGS ?? "").split(/\s+/).filter(Boolean), encoder: det.encoder },
    job,
    {
      chunk: () => chunks++,
      status: (s) => {
        fpsSamples.push(s.fps);
        if (s.error) console.log("page error:", s.error);
      },
      exit: (r) => (exitReason ??= stopping ? null : r),
    },
  );
  const started = Date.now();
  const tick = setInterval(() => {
    const s = Math.round((Date.now() - started) / 1000);
    console.log(`t=${s}s chunks=${chunks} pageFps=${fpsSamples.at(-1) ?? "-"} ffmpegKbps=${p.kbps() ?? "-"} cpu: ${childCpu()}`);
  }, 5000);
  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  clearInterval(tick);
  const cpu = childCpu();
  stopping = true;
  await p.stop();
  server.close();
  if (exitReason) console.log("pipeline exited early:", exitReason);

  const steady = fpsSamples.slice(3);
  const avg = steady.reduce((a, b) => a + b, 0) / Math.max(1, steady.length);
  console.log(`\npage fps avg=${avg.toFixed(1)} min=${Math.min(...steady)} chunks=${chunks} cpu: ${cpu}`);
  console.log(`output ${out} (${(statSync(out).size / 1e6).toFixed(1)} MB)`);
  const probe = execFileSync(
    ffprobePath,
    ["-v", "error", "-count_frames", "-show_entries", "stream=codec_name,profile,width,height,avg_frame_rate,r_frame_rate,nb_read_frames,sample_rate,channels:format=duration,bit_rate", "-of", "compact", out],
    { encoding: "utf8" },
  );
  console.log(probe);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
