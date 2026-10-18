/**
 * BlueStacks on a Mac, driven through its stream API (see docs/phase4/BLUESTACKS.md):
 *   - BsClient   REST: status, launch/quit jobs, mode, touch/key
 *   - BsLink     ONE upstream WebSocket (control mode: 30 fps, short buffer) shared by every consumer —
 *                the recording pipeline (FrameSource) and the manager's live view (the station's /device/stream relay).
 *                Reference-counted: connects with the first consumer, closes with the last, reconnects on drops.
 *   - BlueStacksDevice  the `Device` the Station state machine uses (replaces adb)
 *   - makeEnsureBlueStacks / BlueStacksControl  start/stop of the emulator on its own (before a match)
 */
import { EventEmitter } from "node:events";
import http from "node:http";
import https from "node:https";
import type { StationDevice, StationDeviceJob, StationInput } from "@7xen/shared";
import WebSocket from "ws";
import type { Device, DeviceFacts } from "./adb.js";
import type { EnsureEmulator } from "./emulator.js";
import { log } from "./log.js";
import { run } from "./proc.js";

interface BsOptions {
  /** e.g. https://192.168.0.50:8080 */
  url: string;
  token: string;
  /** accept the Mac's self-signed certificate (default true: it is always self-signed on a LAN) */
  insecureTls: boolean;
}

interface BsStatus {
  active: boolean;
  streaming: boolean;
  viewers: number;
  mode: string;
  apps: {
    bluestacks: { running: boolean; adb: boolean };
    game: { package: string; running: boolean };
    job: { name: string; phase: "idle" | "running" | "done" | "error"; error: string | null };
  };
}

class BsUnreachable extends Error {}

// ---------------------------------------------------------------- REST

export class BsClient {
  private readonly base: URL;
  constructor(private readonly o: BsOptions) {
    this.base = new URL(o.url);
  }

  get url() {
    return this.o.url;
  }
  /** "host:port" — doubles as the device's serial */
  get address() {
    return this.base.host;
  }

  wsUrl(): string {
    const u = new URL(this.base);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    u.pathname = "/";
    u.search = `?token=${encodeURIComponent(this.o.token)}`;
    return u.toString();
  }

  wsOptions(): WebSocket.ClientOptions {
    return { rejectUnauthorized: !this.o.insecureTls, handshakeTimeout: 8000 };
  }

  request<T = unknown>(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = 10_000): Promise<T> {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const mod = this.base.protocol === "https:" ? https : http;
      const req = mod.request(
        {
          protocol: this.base.protocol,
          hostname: this.base.hostname,
          port: this.base.port,
          path,
          method,
          timeout: timeoutMs,
          rejectUnauthorized: !this.o.insecureTls,
          headers: {
            Authorization: `Bearer ${this.o.token}`,
            ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            let json: unknown = null;
            try {
              json = text ? JSON.parse(text) : null;
            } catch {
              /* not JSON */
            }
            const status = res.statusCode ?? 0;
            if (status >= 200 && status < 300) return resolve(json as T);
            const msg = (json as { error?: string } | null)?.error ?? `BlueStacks server answered ${status}`;
            const err = new Error(status === 401 ? "BlueStacks refused the token (check BLUESTACKS_TOKEN)" : msg) as Error & { status?: number };
            err.status = status;
            reject(err);
          });
        },
      );
      req.on("timeout", () => req.destroy(new BsUnreachable("timed out")));
      req.on("error", (err) => reject(err instanceof BsUnreachable ? err : new BsUnreachable(err.message)));
      if (payload) req.write(payload);
      req.end();
    });
  }

  status() {
    return this.request<BsStatus>("GET", "/api/status", undefined, 6000);
  }
  start(body: { mode?: "video" | "control" } = {}) {
    return this.request("POST", "/api/start", body, 20_000);
  }
  launch(target: "bluestacks" | "game") {
    return this.request("POST", "/api/launch", { target });
  }
  quit(target: "game" | "bluestacks" | "all") {
    return this.request("POST", "/api/quit", { target });
  }
  setMode(mode: "video" | "control") {
    return this.request("POST", "/api/mode", { mode });
  }
  touch(body: { action: "down" | "move" | "up"; id?: number; x: number; y: number } | { key: "back" | "home" | "recents" }) {
    return this.request("POST", "/api/touch", body, 8000);
  }
}

// ---------------------------------------------------------------- stream link

export interface BsFrame {
  key: boolean;
  /** capture time, µs */
  ts: number;
  /** H.264 Annex-B */
  data: Buffer;
  /** the whole upstream message (flag + time + data), for relaying as-is */
  raw: Buffer;
}

const KEY_NAMES: Record<string, string> = { ENTER: "Enter", DEL: "Backspace" };

/**
 * Events: "config" (JSON text), "mode" (JSON text), "frame" (BsFrame), "open", "close".
 * `acquire()` returns a release function.
 */
export class BsLink extends EventEmitter {
  private ws: WebSocket | null = null;
  private refs = 0;
  private timer: NodeJS.Timeout | null = null;
  private attempt = 0;
  lastConfig: string | null = null;
  lastMode: string | null = null;
  lastKeyframe: BsFrame | null = null;

  constructor(
    private readonly client: BsClient,
    private readonly opts: { retryMs?: number; connectWaitMs?: number } = {},
  ) {
    super();
    this.setMaxListeners(50);
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
  get consumers(): number {
    return this.refs;
  }

  acquire(): () => void {
    this.refs++;
    this.ensure();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.refs = Math.max(0, this.refs - 1);
      if (this.refs === 0) this.close();
    };
  }

  /** Resolves once the socket is open (or after waitMs without it). */
  async whenConnected(waitMs = this.opts.connectWaitMs ?? 6000): Promise<boolean> {
    if (this.connected) return true;
    return new Promise((resolve) => {
      const t = setTimeout(() => done(false), waitMs);
      const done = (ok: boolean) => {
        clearTimeout(t);
        this.off("open", onOpen);
        resolve(ok);
      };
      const onOpen = () => done(true);
      this.once("open", onOpen);
    });
  }

  private ensure() {
    if (this.refs === 0 || this.ws || this.timer) return;
    const ws = new WebSocket(this.client.wsUrl(), this.client.wsOptions());
    ws.binaryType = "nodebuffer";
    this.ws = ws;
    ws.on("open", () => {
      this.attempt = 0;
      ws.send(JSON.stringify({ type: "mode", mode: "control" })); // this viewer only
      this.requestKeyframe();
      this.emit("open");
    });
    ws.on("message", (data, isBinary) => {
      const buf = data as Buffer;
      if (!isBinary) {
        const text = buf.toString("utf8");
        try {
          const msg = JSON.parse(text) as { type?: string };
          if (msg.type === "config") this.lastConfig = text;
          else if (msg.type === "mode") this.lastMode = text;
          this.emit(msg.type === "config" ? "config" : "mode", text);
        } catch {
          /* ignore */
        }
        return;
      }
      if (buf.length < 10) return;
      const frame: BsFrame = { key: buf[0] === 1, ts: buf.readDoubleBE(1), data: buf.subarray(9), raw: buf };
      if (frame.key) this.lastKeyframe = frame;
      this.emit("frame", frame);
    });
    const gone = (why: string) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.attempt === 0 || this.attempt % 10 === 0) log.warn("BlueStacks stream closed", { why, attempt: this.attempt });
      this.emit("close", why);
      if (this.refs > 0) {
        const delay = Math.min(this.opts.retryMs ?? 1000, 1000) * Math.min(1 + this.attempt, 5);
        this.attempt++;
        this.timer = setTimeout(() => {
          this.timer = null;
          this.ensure();
        }, delay);
      }
    };
    ws.on("close", (code) => gone(`code ${code}`));
    ws.on("error", (err) => {
      gone(err.message);
      try {
        ws.terminate();
      } catch {
        /* already closed */
      }
    });
  }

  private close() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const ws = this.ws;
    this.ws = null;
    this.lastKeyframe = null;
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
  }

  requestKeyframe() {
    this.send(Buffer.from([2]));
  }

  /** Send a binary message upstream (touch, keyframe request, key, text). False when not connected. */
  send(buf: Buffer): boolean {
    if (!this.connected) return false;
    this.ws!.send(buf);
    return true;
  }

  /** Wait for the next keyframe (asks for one). */
  nextKeyframe(timeoutMs = 4000): Promise<BsFrame | null> {
    return new Promise((resolve) => {
      const t = setTimeout(() => done(null), timeoutMs);
      const done = (f: BsFrame | null) => {
        clearTimeout(t);
        this.off("frame", on);
        resolve(f);
      };
      const on = (f: BsFrame) => f.key && done(f);
      this.on("frame", on);
      this.requestKeyframe();
    });
  }
}

/** Touch message of the Mac's protocol. action 0 down, 1 up, 2 move; x/y are 0..1. */
export function touchMessage(action: 0 | 1 | 2, id: number, x: number, y: number): Buffer {
  const b = Buffer.alloc(11);
  b[0] = 0;
  b[1] = action;
  b[2] = id;
  b.writeUInt16BE(Math.round(Math.min(1, Math.max(0, x)) * 65535), 3);
  b.writeUInt16BE(Math.round(Math.min(1, Math.max(0, y)) * 65535), 5);
  b.writeUInt16BE(0, 7);
  b.writeUInt16BE(0, 9);
  return b;
}
const keyMessage = (action: 0 | 1, name: string) => Buffer.concat([Buffer.from([3, action]), Buffer.from(name, "utf8")]);
const textMessage = (text: string) => Buffer.concat([Buffer.from([4]), Buffer.from(text, "utf8")]);

/** Which browser → Mac messages the relay passes on. Returns null for anything else. */
export function sanitizeClientMessage(buf: Buffer): Buffer | null {
  if (buf.length === 0 || buf.length > 400) return null;
  switch (buf[0]) {
    case 0:
      return buf.length === 11 && buf[1]! <= 2 ? buf : null;
    case 2:
      return buf.length === 1 ? buf : null;
    case 3:
      return buf.length >= 3 && buf.length <= 40 && buf[1]! <= 1 ? buf : null;
    case 4:
      return buf.length >= 2 && buf.length <= 301 ? buf : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------- Device (replaces adb)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface BsDeviceOptions {
  ffmpeg: string;
  jobTimeoutMs: number;
  pollMs?: number;
}

export class BlueStacksDevice implements Device {
  constructor(
    readonly client: BsClient,
    readonly link: BsLink,
    private readonly o: BsDeviceOptions,
  ) {}

  async status(): Promise<BsStatus | null> {
    try {
      return await this.client.status();
    } catch (err) {
      log.debug("BlueStacks status failed", { err: (err as Error).message });
      return null;
    }
  }

  async find() {
    const s = await this.status();
    if (!s) return null;
    const j = s.apps.job;
    const launching = j.phase === "running" && !/quit|stop/i.test(j.name);
    if (s.apps.bluestacks.running) return { serial: this.client.address, state: s.streaming ? "device" : "offline" };
    return launching ? { serial: this.client.address, state: "offline" } : null;
  }

  async isBooted() {
    const s = await this.status();
    return !!s && s.apps.bluestacks.running && s.streaming;
  }

  async facts(): Promise<DeviceFacts> {
    const s = await this.status();
    const dev = s ? await this.find() : null;
    if (!s || !dev) return { serial: null, state: null, booted: false, screen: null, rotation: null, bgmiInstalled: false };
    const booted = s.apps.bluestacks.running && s.streaming;
    return { serial: dev.serial, state: dev.state, booted, screen: null, rotation: null, bgmiInstalled: true };
  }

  async rotation() {
    return null;
  }
  async screen() {
    return null;
  }
  async isInstalled() {
    return true;
  }

  /** Wait for the background launch/quit job to finish. */
  async waitJob(timeoutMs = this.o.jobTimeoutMs): Promise<void> {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const s = await this.client.status();
      const j = s.apps.job;
      if (j.phase === "error") throw new Error(j.error || "BlueStacks reported an error");
      if (j.phase !== "running") return;
      if (Date.now() > end) throw new Error("BlueStacks took too long to start");
      await sleep(this.o.pollMs ?? 1500);
    }
  }

  async gameRunning(): Promise<boolean> {
    return !!(await this.status())?.apps.game.running;
  }

  /** Start the game (and BlueStacks) on the Mac and wait until it is up. */
  async launch(): Promise<void> {
    await this.startJob("game");
  }

  async startJob(target: "bluestacks" | "game"): Promise<void> {
    try {
      await this.client.launch(target);
    } catch (err) {
      if ((err as { status?: number }).status !== 409) throw err; // 409: another job is already running — wait for it
    }
    await this.waitJob();
  }

  /** Make sure the stream is on and in control mode (REST touch is only accepted in control mode). */
  async ensureStreaming(): Promise<void> {
    const s = await this.client.status();
    if (!s.streaming) await this.client.start({ mode: "control" });
    if (s.mode !== "control") await this.client.setMode("control").catch(() => {});
  }

  async screencap(): Promise<Buffer> {
    const release = this.link.acquire();
    try {
      if (!(await this.link.whenConnected())) throw new Error("screencap failed: can't reach the BlueStacks stream");
      const frame = await this.link.nextKeyframe(5000);
      if (!frame) throw new Error("screencap failed: no picture from BlueStacks");
      const r = await run(this.o.ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "h264", "-i", "pipe:0", "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "pipe:1"], {
        timeoutMs: 15_000,
        input: frame.data,
      });
      if (r.code !== 0 || r.stdout.length < 8 || r.stdout.readUInt32BE(0) !== 0x89504e47) throw new Error(`screencap failed: ${r.stderr.slice(-200)}`);
      return r.stdout;
    } finally {
      release();
    }
  }

  async input(_serial: string, input: StationInput, _mode?: "logical" | "natural"): Promise<void> {
    if (input.type === "tap") {
      await this.client.touch({ action: "down", id: 0, x: input.x, y: input.y });
      await sleep(60);
      await this.client.touch({ action: "up", id: 0, x: input.x, y: input.y });
      return;
    }
    if (input.type === "swipe") {
      const steps = Math.max(2, Math.min(20, Math.round(input.durationMs / 30)));
      await this.client.touch({ action: "down", id: 0, x: input.x, y: input.y });
      for (let i = 1; i <= steps; i++) {
        await sleep(input.durationMs / steps);
        const t = i / steps;
        const x = input.x + (input.x2 - input.x) * t;
        const y = input.y + (input.y2 - input.y) * t;
        await this.client.touch(i === steps ? { action: "up", id: 0, x, y } : { action: "move", id: 0, x, y });
      }
      return;
    }
    if (input.type === "key" && (input.key === "BACK" || input.key === "HOME" || input.key === "APP_SWITCH")) {
      await this.client.touch({ key: input.key === "BACK" ? "back" : input.key === "HOME" ? "home" : "recents" });
      return;
    }
    // Enter / Delete / text only exist on the WebSocket
    const release = this.link.acquire();
    try {
      if (!(await this.link.whenConnected())) throw new Error("input failed: can't reach the BlueStacks stream");
      if (input.type === "key") {
        const name = KEY_NAMES[input.key]!;
        this.link.send(keyMessage(0, name));
        this.link.send(keyMessage(1, name));
      } else if (input.type === "text") {
        for (let i = 0; i < input.text.length; i += 8) this.link.send(textMessage(input.text.slice(i, i + 8)));
      }
      await sleep(80); // let the messages flush before the socket may close
    } finally {
      release();
    }
  }
}

// ---------------------------------------------------------------- start / stop control

export function makeEnsureBlueStacks(device: BlueStacksDevice): EnsureEmulator {
  return async (onBooting) => {
    const s = await device.status();
    if (!s) throw new Error(`Can't reach BlueStacks at ${device.client.url}. Start the stream server on the Mac and check it's on the same Wi-Fi.`);
    if (!(s.apps.bluestacks.running && s.streaming)) {
      onBooting?.();
      await device.startJob("bluestacks");
    }
    await device.ensureStreaming();
    return device.client.address;
  };
}

/** What the Station needs for the independent Start / Stop emulator buttons. */
export class BlueStacksControl {
  constructor(
    readonly device: BlueStacksDevice,
    readonly link: BsLink,
  ) {}

  async info(): Promise<StationDevice> {
    const s = await this.device.status();
    const j = s?.apps.job;
    const job: StationDeviceJob | null = j ? { name: j.name, phase: j.phase, error: j.error } : null;
    const running = !!s?.apps.bluestacks.running;
    return {
      mode: "BLUESTACKS",
      address: this.device.client.address,
      serial: running ? this.device.client.address : null,
      state: !s ? null : running ? (s.streaming ? "device" : "offline") : null,
      label: !s ? "BlueStacks (not reachable)" : "BlueStacks on a Mac",
      job,
      controllable: true,
      gameRunning: !!s?.apps.game.running,
    };
  }

  /** Kick off BlueStacks (and BGMI) in the background; the status shows progress. */
  async start(launchBgmi: boolean): Promise<void> {
    const s = await this.device.status();
    if (!s) throw new Error(`Can't reach BlueStacks at ${this.device.client.url}. Start the stream server on the Mac first.`);
    if (s.apps.job.phase === "running") return;
    try {
      await this.device.client.launch(launchBgmi ? "game" : "bluestacks");
    } catch (err) {
      if ((err as { status?: number }).status !== 409) throw err;
    }
    // once the job finishes make sure the stream is on (fire and forget; errors show in the job)
    void this.device
      .waitJob()
      .then(() => this.device.ensureStreaming())
      .catch((err) => log.warn("BlueStacks start did not finish", { err: (err as Error).message }));
  }

  async stop(target: "game" | "all"): Promise<void> {
    const s = await this.device.status();
    if (!s) throw new Error(`Can't reach BlueStacks at ${this.device.client.url}.`);
    try {
      await this.device.client.quit(target);
    } catch (err) {
      if ((err as { status?: number }).status !== 409) throw err;
    }
  }
}
