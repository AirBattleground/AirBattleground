import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { BlueStacksControl, BlueStacksDevice, BsClient, BsLink, makeEnsureBlueStacks, sanitizeClientMessage, touchMessage } from "../src/bluestacks.js";
import { CapturePipeline } from "../src/capture.js";
import { FrameSource } from "../src/frameSource.js";
import { realSpawner } from "../src/proc.js";
import { createStationServer } from "../src/server.js";
import { Station } from "../src/session.js";

const FFMPEG = process.env.FFMPEG ?? (existsSync(`${process.env.HOME}/.local/bin/ffmpeg`) ? `${process.env.HOME}/.local/bin/ffmpeg` : "ffmpeg");
const TOKEN = "test-token-1234567890";

/** A fake Mac: REST status/launch/quit/mode/touch + a WebSocket that streams real H.264 made by ffmpeg. */
async function fakeMac() {
  const state = {
    running: false,
    streaming: false,
    gameRunning: false,
    job: { name: "", phase: "idle" as "idle" | "running" | "done" | "error", error: null as string | null },
    mode: "video",
    touches: [] as unknown[],
    launches: [] as string[],
    quits: [] as string[],
    wsInput: [] as Buffer[],
    wsClients: 0,
  };
  const json = (res: http.ServerResponse, code: number, body: unknown) => res.writeHead(code, { "Content-Type": "application/json" }).end(JSON.stringify(body));
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(res, 401, { error: "unauthorized" });
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const b = body ? JSON.parse(body) : {};
      if (req.url === "/api/status")
        return json(res, 200, {
          active: state.streaming,
          streaming: state.streaming,
          viewers: state.wsClients,
          mode: state.mode,
          apps: { bluestacks: { running: state.running, adb: state.running }, game: { package: "com.pubg.imobile", running: state.gameRunning }, job: state.job },
        });
      if (req.url === "/api/launch") {
        if (state.job.phase === "running") return json(res, 409, { error: "busy" });
        state.launches.push(b.target);
        state.job = { name: `launch ${b.target}`, phase: "running", error: null };
        setTimeout(() => {
          state.running = true;
          state.streaming = true;
          if (b.target === "game") state.gameRunning = true;
          state.job.phase = "done";
        }, 150);
        return json(res, 202, { ok: true });
      }
      if (req.url === "/api/quit") {
        state.quits.push(b.target);
        state.running = b.target === "game";
        state.streaming = state.running;
        state.gameRunning = false;
        return json(res, 202, { ok: true });
      }
      if (req.url === "/api/start") {
        state.streaming = true;
        return json(res, 200, { active: true, mode: "control" });
      }
      if (req.url === "/api/mode") {
        state.mode = b.mode;
        return json(res, 200, { ok: true });
      }
      if (req.url === "/api/touch") {
        if (state.mode !== "control") return json(res, 409, { error: "not in control mode" });
        state.touches.push(b);
        return json(res, 200, { ok: true });
      }
      json(res, 404, { error: "nope" });
    });
  });
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws, req) => {
    if (new URL(req.url!, "http://x").searchParams.get("token") !== TOKEN) return void ws.close(4401);
    state.wsClients++;
    ws.send(JSON.stringify({ type: "hello", backend: "hybrid" }));
    ws.send(JSON.stringify({ type: "config", codec: "avc1.640034", stream: "live" }));
    // 4 s test pattern at 25 fps, GOP 25, one slice per picture (like the Mac), Annex-B on stdout; sent frame by frame in real time
    const ff = spawn(FFMPEG, ["-loglevel", "error", "-re", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25", "-t", "30", "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-threads", "1", "-g", "25", "-bsf:v", "h264_mp4toannexb", "-f", "h264", "pipe:1"]);
    let buf = Buffer.alloc(0);
    let n = 0;
    ff.stdout.on("data", (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      // split on access-unit boundaries: an AUD-less stream → split before each "00 00 00 01 <VCL nal>" that follows a VCL nal
      for (;;) {
        const starts: number[] = [];
        for (let i = 0; i + 4 < buf.length; i++) if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 0 && buf[i + 3] === 1) starts.push(i);
        // a frame = [optional SPS/PPS/SEI nals] + one VCL nal (type 1 or 5)
        let cut = -1;
        for (let k = 0; k < starts.length; k++) {
          const t = buf[starts[k]! + 4]! & 0x1f;
          if ((t === 1 || t === 5) && k + 1 < starts.length) {
            cut = starts[k + 1]!;
            break;
          }
        }
        if (cut < 0) break;
        const au = buf.subarray(0, cut);
        buf = buf.subarray(cut);
        const isKey = n % 25 === 0;
        const head = Buffer.alloc(9);
        head[0] = isKey ? 1 : 0;
        head.writeDoubleBE(n * 40_000, 1);
        n++;
        if (ws.readyState === ws.OPEN) ws.send(Buffer.concat([head, au]), { binary: true });
      }
    });
    ws.on("message", (m, isBin) => {
      if (isBin) state.wsInput.push(m as Buffer);
    });
    ws.on("close", () => {
      state.wsClients--;
      ff.kill("SIGKILL");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return {
    state,
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      for (const c of wss.clients) c.terminate();
      await new Promise((r) => server.close(r));
    },
  };
}

describe("BlueStacks backend", () => {
  let mac: Awaited<ReturnType<typeof fakeMac>>;
  let dir: string;
  beforeEach(async () => {
    mac = await fakeMac();
    dir = mkdtempSync(path.join(tmpdir(), "bs-"));
  });
  afterEach(async () => {
    await mac.close();
  });

  const make = () => {
    const client = new BsClient({ url: mac.url, token: TOKEN, insecureTls: true });
    const link = new BsLink(client, { retryMs: 100 });
    const device = new BlueStacksDevice(client, link, { ffmpeg: FFMPEG, jobTimeoutMs: 5000, pollMs: 50 });
    return { client, link, device };
  };

  it("sanitizes browser messages", () => {
    expect(sanitizeClientMessage(touchMessage(0, 1, 0.5, 0.5))).not.toBeNull();
    expect(sanitizeClientMessage(Buffer.from([2]))).not.toBeNull();
    expect(sanitizeClientMessage(Buffer.from([9, 1, 2]))).toBeNull();
    expect(sanitizeClientMessage(Buffer.from([0, 7, 0]))).toBeNull();
    expect(sanitizeClientMessage(Buffer.alloc(500, 4))).toBeNull();
  });

  it("starts BlueStacks, reports its state and takes REST input", async () => {
    const { device, client } = make();
    expect(await device.find()).toBeNull();
    const ensure = makeEnsureBlueStacks(device);
    const serial = await ensure();
    expect(serial).toBe(client.address);
    expect(mac.state.launches).toEqual(["bluestacks"]);
    expect(mac.state.mode).toBe("control");
    expect(await device.isBooted()).toBe(true);
    await device.launch();
    expect(mac.state.gameRunning).toBe(true);
    await device.input(serial, { type: "tap", x: 0.25, y: 0.75 }, "logical");
    await device.input(serial, { type: "key", key: "BACK" }, "logical");
    expect(mac.state.touches[0]).toMatchObject({ action: "down", x: 0.25, y: 0.75 });
    expect(mac.state.touches[1]).toMatchObject({ action: "up" });
    expect(mac.state.touches[2]).toEqual({ key: "back" });
  });

  it("takes text and Enter over the stream, and a screenshot from a keyframe", async () => {
    const { device } = make();
    await makeEnsureBlueStacks(device)();
    await device.input("x", { type: "text", text: "hello world" }, "logical");
    await device.input("x", { type: "key", key: "ENTER" }, "logical");
    const msgs = mac.state.wsInput.filter((m) => m[0] === 4 || m[0] === 3).map((m) => m.subarray(1).toString("latin1"));
    expect(msgs.some((m) => m.includes("hello"))).toBe(true);
    const png = await device.screencap();
    expect(png.readUInt32BE(0)).toBe(0x89504e47);
  }, 20_000);

  it("records the stream to MP4 + HLS through the capture pipeline", async () => {
    const { device, link } = make();
    await makeEnsureBlueStacks(device)();
    const live = path.join(dir, "live");
    const pipeline = new CapturePipeline({
      spawner: realSpawner,
      scrcpy: "",
      scrcpyServer: "",
      adb: "",
      ffmpeg: FFMPEG,
      serial: "x",
      workDir: path.join(dir, "work"),
      liveDir: live,
      maxSize: 0,
      bitrateMbps: 6,
      maxFps: 30,
      hlsTime: 1,
      hlsListSize: 6,
      maxRestarts: 2,
      startSource: (fifo) => new FrameSource(link, fifo),
    });
    await pipeline.start();
    await new Promise((r) => setTimeout(r, 4500));
    const parts = await pipeline.stop();
    expect(parts).toHaveLength(1);
    expect(statSync(parts[0]!).size).toBeGreaterThan(5_000);
    const probe = await new Promise<string>((resolve) => {
      const p = spawn(FFMPEG.replace(/ffmpeg$/, "ffprobe"), ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,nb_read_frames:format=duration", "-of", "default=nw=1", parts[0]!]);
      let out = "";
      p.stdout.on("data", (d) => (out += d));
      p.on("close", () => resolve(out));
    });
    expect(probe).toContain("codec_name=h264");
    expect(probe).toContain("width=320");
    const frames = Number(/nb_read_frames=(\d+)/.exec(probe)?.[1]);
    expect(frames).toBeGreaterThan(40);
    const duration = Number(/duration=([\d.]+)/.exec(probe)?.[1]);
    expect(duration).toBeGreaterThan(2.5);
    expect(duration).toBeLessThan(6.5);
    const playlist = readFileSync(path.join(live, "index.m3u8"), "utf8");
    expect(playlist).toContain("#EXT-X-ENDLIST");
    expect(readdirSync(live).some((f) => f.endsWith(".ts"))).toBe(true);
    expect(link.consumers).toBe(0);
  }, 30_000);

  it("station: device start/stop, stream relay to a browser, and a recorded match", async () => {
    const { device, link, client } = make();
    const control = new BlueStacksControl(device, link);
    const completed: unknown[] = [];
    const station = new Station({
      device,
      control,
      ensureEmulator: makeEnsureBlueStacks(device),
      makePipeline: (req) =>
        new CapturePipeline({
          spawner: realSpawner, scrcpy: "", scrcpyServer: "", adb: "", ffmpeg: FFMPEG, serial: req.serial, workDir: req.workDir, liveDir: req.liveDir,
          maxSize: 0, bitrateMbps: req.bitrateMbps, maxFps: req.maxFps, hlsTime: 1, hlsListSize: 6, maxRestarts: 2,
          startSource: (fifo) => new FrameSource(link, fifo),
        }),
      finalize: async (parts, videoKey) => {
        completed.push({ parts, videoKey });
        return { videoKey, sizeBytes: statSync(parts[0]!).size, durationSec: 4 };
      },
      api: { complete: async () => {}, fail: async () => {}, screenshot: async () => {} } as never,
      storageDir: dir,
      workDir: path.join(dir, "station"),
      bgmiPackage: "com.pubg.imobile",
      inputCoords: "logical",
      liveKeepMs: 60_000,
      version: "test",
      defaultBitrateMbps: 6,
      defaultMaxFps: 30,
      prepareWaitMs: 8000,
    });
    const server = createStationServer(station, { token: TOKEN, link });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = async (method: string, p: string, body?: unknown) => {
      const res = await fetch(`http://${base}${p}`, { method, headers: { "X-Station-Token": TOKEN, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, body: (await res.json().catch(() => null)) as any };
    };
    try {
      // 1. start the emulator on its own
      let r = await call("POST", "/device/start", { launchBgmi: true });
      expect(r.status).toBe(200);
      expect(r.body.device).toMatchObject({ mode: "BLUESTACKS", controllable: true });
      for (let i = 0; i < 40 && (await call("GET", "/health?fresh=1")).body.emulator !== "READY"; i++) await new Promise((x) => setTimeout(x, 100));
      r = await call("GET", "/health?fresh=1");
      expect(r.body).toMatchObject({ emulator: "READY", phase: "IDLE" });
      expect(r.body.device.gameRunning).toBe(true);

      // 2. a manager's browser watches + touches through the relay (before any match)
      const ws = new WebSocket(`ws://${base}/device/stream?matchId=m1`, { headers: { "X-Station-Token": TOKEN } });
      const got = { frames: 0, key: false, config: false };
      ws.on("message", (d, bin) => {
        if (bin) {
          got.frames++;
          if ((d as Buffer)[0] === 1) got.key = true;
        } else if (d.toString().includes('"config"')) got.config = true;
      });
      await new Promise((res, rej) => (ws.on("open", res), ws.on("error", rej)));
      await link.whenConnected(); // input is dropped while the upstream socket isn't up yet
      ws.send(touchMessage(0, 0, 0.5, 0.5));
      ws.send(Buffer.from([9, 9])); // dropped
      await new Promise((x) => setTimeout(x, 1500));
      expect(got.config).toBe(true);
      expect(got.key).toBe(true);
      expect(got.frames).toBeGreaterThan(10);
      expect(mac.state.wsInput.some((m) => m[0] === 0)).toBe(true);
      expect(mac.state.wsInput.some((m) => m[0] === 9)).toBe(false);

      // a bad token / wrong match is refused
      const bad = new WebSocket(`ws://${base}/device/stream`, { headers: { "X-Station-Token": "nope" } });
      await new Promise<void>((res) => bad.on("error", () => res()));

      // 3. start the match: recording + HLS while the viewer stays connected
      r = await call("POST", "/sessions", { matchId: "m1", recordingId: "rec1", title: "t", videoKey: "2026/10/rec1.mp4", launchBgmi: true });
      expect(r.body.phase).toBe("LIVE");
      expect(mac.state.launches.filter((x) => x === "game")).toHaveLength(1); // game already running: not relaunched
      const other = new WebSocket(`ws://${base}/device/stream?matchId=other`, { headers: { "X-Station-Token": TOKEN } });
      await new Promise<void>((res) => other.on("error", () => res())); // 409: another match holds the station
      await new Promise((x) => setTimeout(x, 3000));
      expect(existsSync(path.join(dir, "live/m1/index.m3u8"))).toBe(true);
      expect(await call("POST", "/device/stop", { target: "all" })).toMatchObject({ status: 409 });

      // 4. stop the match: recording is finalised, the emulator keeps running
      await call("POST", "/sessions/stop", { matchId: "m1" });
      await station.settled();
      expect(completed).toHaveLength(1);
      expect((await call("GET", "/health?fresh=1")).body).toMatchObject({ phase: "IDLE", emulator: "READY" });
      expect(got.frames).toBeGreaterThan(40); // the viewer never dropped

      // 5. shut the emulator down
      ws.close();
      r = await call("POST", "/device/stop", { target: "all" });
      expect(r.status).toBe(200);
      expect(mac.state.quits).toEqual(["all"]);
    } finally {
      server.close();
      client; // eslint-disable-line @typescript-eslint/no-unused-expressions
    }
  }, 60_000);
});
