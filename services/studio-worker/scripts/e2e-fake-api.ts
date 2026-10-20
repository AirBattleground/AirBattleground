/**
 * End-to-end without the real site: a fake API (poll + render page that demands the session cookie) and ffmpeg
 * listening as an RTMP server. Runs the real worker (src/index.ts) against it, hands it a job, then takes it away.
 *
 *   node --import tsx scripts/e2e-fake-api.ts        (SECONDS_TO_RUN=20)
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import type { WorkerJob, WorkerPollResponse } from "@7xen/shared";
import { testPage } from "./test-page.js";

const SECONDS = Number(process.env.SECONDS_TO_RUN ?? 20);
const KEY = "e2e-key";
const out = path.resolve("smoke-out/e2e.flv");
mkdirSync(path.dirname(out), { recursive: true });
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";

let giveJob = true;
const polls: unknown[] = [];

const server = http.createServer((req, res) => {
  if (req.url === "/api/studio-worker/poll" && req.method === "POST") {
    if (req.headers["x-worker-key"] !== KEY) return void res.writeHead(401).end("{}");
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      polls.push(JSON.parse(body));
      const port = (server.address() as { port: number }).port;
      const job: WorkerJob = {
        showId: "e2e",
        title: "E2E show",
        renderUrl: `http://127.0.0.1:${port}/studio-render/e2e`,
        session: { cookieName: "sid", token: "secret" },
        publishUrl: "rtmp://127.0.0.1:19350/live/show_e2e?wtoken=1.abc",
        videoKbps: 6000,
        fps: 60,
      };
      const r: WorkerPollResponse = { worker: { id: "w1", name: "E2E PC" }, job: giveJob ? job : null };
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(r));
    });
    return;
  }
  if (req.url?.startsWith("/studio-render/")) {
    if (!/\bsid=secret\b/.test(req.headers.cookie ?? "")) return void res.writeHead(401).end("no session cookie");
    return void res.writeHead(200, { "Content-Type": "text/html" }).end(testPage());
  }
  res.writeHead(req.url === "/favicon.ico" ? 204 : 404).end();
});

async function main() {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const rtmp = spawn(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-listen", "1", "-i", "rtmp://127.0.0.1:19350/live/show_e2e", "-c", "copy", out], { stdio: "inherit" });
  await new Promise((r) => setTimeout(r, 500));

  const worker = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    env: { ...process.env, WORKER_KEY: KEY, API_URL: `http://127.0.0.1:${port}` },
    stdio: "inherit",
  });
  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  console.log("last poll while live:", JSON.stringify(polls.at(-1)));
  giveJob = false; // manager ended the show
  await new Promise((r) => setTimeout(r, 5000));
  console.log("last poll after stop:", JSON.stringify(polls.at(-1)));
  worker.kill("SIGTERM");
  if (worker.exitCode === null) await new Promise((r) => worker.once("close", r));
  const t = setTimeout(() => rtmp.kill("SIGINT"), 3000);
  if (rtmp.exitCode === null) await new Promise((r) => rtmp.once("close", r));
  clearTimeout(t);
  server.close();
  console.log(
    execFileSync(ffmpeg.replace(/ffmpeg$/, "ffprobe"), ["-v", "error", "-show_entries", "stream=codec_name,width,height,avg_frame_rate:format=duration", "-of", "compact", out], { encoding: "utf8" }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
}).then(() => process.exit(0));
