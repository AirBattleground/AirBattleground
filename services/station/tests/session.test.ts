import { EventEmitter } from "node:events";
import { mkdtempSync, existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StationInput } from "@7xen/shared";
import type { Device, DeviceFacts } from "../src/adb.js";
import type { ApiHooks } from "../src/apiClient.js";
import { CapturePipeline } from "../src/capture.js";
import type { Proc, Spawner } from "../src/proc.js";
import { createStationServer } from "../src/server.js";
import { Station, StationError } from "../src/session.js";

// ---------------------------------------------------------------- fakes

class FakeProc extends EventEmitter implements Proc {
  static next = 1000;
  readonly pid = FakeProc.next++;
  exited = false;
  signals: string[] = [];
  out = "";
  /** how the process reacts to a signal: exit after `delay` ms, or ignore it */
  onSignal: (sig: string) => number | null = () => 5;
  constructor(
    readonly cmd: string,
    readonly args: string[],
  ) {
    super();
  }
  kill(signal: NodeJS.Signals = "SIGTERM") {
    if (this.exited) return false;
    this.signals.push(signal);
    const delay = signal === "SIGKILL" ? 0 : this.onSignal(signal);
    if (delay != null) setTimeout(() => this.die(signal === "SIGINT" ? 0 : null, signal === "SIGINT" ? null : signal), delay);
    return true;
  }
  die(code: number | null = 1, signal: string | null = null) {
    if (this.exited) return;
    this.exited = true;
    this.emit("exit", code, signal);
  }
  output() {
    return this.out;
  }
}

function fakeSpawner() {
  const procs: FakeProc[] = [];
  let beforeSpawn: ((p: FakeProc) => void) | null = null;
  const spawner: Spawner = (cmd, args) => {
    const p = new FakeProc(cmd, args);
    // scrcpy SIGINT → its ffmpeg sees EOF and exits too
    if (cmd === "scrcpy") {
      const ff = [...procs].reverse().find((x) => x.cmd === "ffmpeg");
      p.on("exit", () => setTimeout(() => ff?.die(0), 2));
    }
    beforeSpawn?.(p);
    procs.push(p);
    return p;
  };
  return {
    spawner,
    procs,
    of: (cmd: string) => procs.filter((p) => p.cmd === cmd),
    setBeforeSpawn: (fn: (p: FakeProc) => void) => {
      beforeSpawn = fn;
    },
  };
}

function fakeDevice(over: Partial<{ installed: boolean }> = {}) {
  const calls = { launch: 0, inputs: [] as { input: StationInput; mode: string }[] };
  const facts: DeviceFacts = { serial: "emulator-5554", state: "device", booted: true, screen: { width: 1080, height: 2280 }, rotation: 1, bgmiInstalled: over.installed ?? true };
  const device: Device = {
    find: async () => ({ serial: "emulator-5554", state: "device" }),
    facts: async () => facts,
    isBooted: async () => true,
    rotation: async () => 1,
    screen: async () => facts.screen,
    isInstalled: async () => facts.bgmiInstalled,
    launch: async () => {
      calls.launch++;
    },
    screencap: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]),
    input: async (_s, input, mode) => {
      calls.inputs.push({ input, mode });
    },
  };
  return { device, calls, facts };
}

function fakeApi() {
  const calls = { complete: [] as { id: string; body: unknown }[], fail: [] as { id: string; body: { error: string } }[] };
  const api: ApiHooks = {
    complete: async (id, body) => {
      calls.complete.push({ id, body });
    },
    fail: async (id, body) => {
      calls.fail.push({ id, body });
    },
    screenshot: async () => ({ items: [] }),
  };
  return { api, calls };
}

const until = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 5));
  }
};

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "7xen-station-test-"));
});

function world(opts: { installed?: boolean; emulator?: () => Promise<string>; maxRestarts?: number } = {}) {
  const sp = fakeSpawner();
  const dev = fakeDevice({ installed: opts.installed });
  const api = fakeApi();
  const finalized: { parts: string[]; videoKey: string }[] = [];
  const storageDir = path.join(root, "storage");
  const workDir = path.join(storageDir, "station");
  const station = new Station({
    device: dev.device,
    ensureEmulator: opts.emulator ?? (async () => "emulator-5554"),
    makePipeline: (req) =>
      new CapturePipeline({
        spawner: sp.spawner,
        scrcpy: "scrcpy",
        scrcpyServer: "server",
        adb: "adb",
        ffmpeg: "ffmpeg",
        serial: req.serial,
        workDir: req.workDir,
        liveDir: req.liveDir,
        maxSize: 1280,
        bitrateMbps: req.bitrateMbps,
        maxFps: req.maxFps,
        hlsTime: 2,
        hlsListSize: 6,
        maxRestarts: opts.maxRestarts ?? 2,
        settleMs: 20,
        restartDelayMs: 5,
        mkfifo: async (f) => writeFileSync(f, ""),
        unblockFifo: async () => {},
      }),
    finalize: async (parts, videoKey) => {
      finalized.push({ parts, videoKey });
      return { videoKey, sizeBytes: 1234, durationSec: 7 };
    },
    api: api.api,
    storageDir,
    workDir,
    bgmiPackage: "com.pubg.imobile",
    inputCoords: "logical",
    liveKeepMs: 10 * 60_000,
    version: "test",
    defaultBitrateMbps: 6,
    defaultMaxFps: 30,
    prepareWaitMs: 1000,
    factsCacheMs: 0,
  });
  return { station, sp, dev, api, finalized, storageDir, workDir };
}

const REQ = { matchId: "m1", recordingId: "r1", title: "Scrim · Match 1", videoKey: "2026/10/r1.mp4", launchBgmi: true };

// ---------------------------------------------------------------- state machine

describe("station state machine", () => {
  it("prepare: emulator → BGMI → capture → LIVE", async () => {
    const w = world();
    const s = await w.station.prepare(REQ);
    expect(s.phase).toBe("LIVE");
    expect(s.matchId).toBe("m1");
    expect(s.recordingId).toBe("r1");
    expect(s.emulator).toBe("READY");
    expect(s.bgmiInstalled).toBe(true);
    expect(s.rotation).toBe(1);
    expect(w.dev.calls.launch).toBe(1);
    const [scrcpy] = w.sp.of("scrcpy");
    const [ffmpeg] = w.sp.of("ffmpeg");
    expect(scrcpy!.args).toContain("--record-format=mkv");
    expect(scrcpy!.args).toContain("--serial=emulator-5554");
    expect(scrcpy!.args).toContain("--video-bit-rate=6M");
    const tee = ffmpeg!.args.at(-1)!;
    expect(tee).toContain(path.join(w.storageDir, "live/m1/index.m3u8"));
    expect(tee).toContain("omit_endlist");
    expect(tee).not.toContain("append_list");
    // crash-safety record
    const saved = JSON.parse(readFileSync(path.join(w.workDir, "sessions/r1/session.json"), "utf8"));
    expect(saved).toMatchObject({ matchId: "m1", recordingId: "r1", videoKey: "2026/10/r1.mp4" });
    expect(saved.pids).toHaveLength(2);
  });

  it("one match at a time: another match gets 409, the same match is idempotent", async () => {
    const w = world();
    await w.station.prepare(REQ);
    await expect(w.station.prepare({ ...REQ, matchId: "m2", recordingId: "r2" })).rejects.toMatchObject({ status: 409 });
    const again = await w.station.prepare({ ...REQ, recordingId: "r9" });
    expect(again.recordingId).toBe("r1");
    expect(w.sp.of("scrcpy")).toHaveLength(1);
    await expect(w.station.stop("m2")).rejects.toBeInstanceOf(StationError);
  });

  it("stop: SIGINT scrcpy, ffmpeg drains, ENDLIST, final MP4 reported to the API → IDLE", async () => {
    const w = world();
    await w.station.prepare(REQ);
    const live = path.join(w.storageDir, "live/m1");
    writeFileSync(path.join(live, "index.m3u8"), "#EXTM3U\n#EXTINF:2.0,\np0-00000.ts\n");
    const st = await w.station.stop("m1");
    expect(st.phase).toBe("STOPPING");
    await w.station.settled();
    expect(w.station.phase).toBe("IDLE");
    expect(w.sp.of("scrcpy")[0]!.signals).toEqual(["SIGINT"]);
    expect(w.sp.of("ffmpeg")[0]!.exited).toBe(true);
    expect(w.finalized).toEqual([{ parts: [path.join(w.workDir, "sessions/r1/part-000.mp4")], videoKey: "2026/10/r1.mp4" }]);
    expect(w.api.calls.complete).toEqual([{ id: "r1", body: { videoKey: "2026/10/r1.mp4", sizeBytes: 1234, durationSec: 7 } }]);
    expect(readFileSync(path.join(live, "index.m3u8"), "utf8")).toMatch(/#EXT-X-ENDLIST\n$/);
    expect(existsSync(path.join(w.workDir, "sessions/r1"))).toBe(false);
    // a second stop is harmless
    expect((await w.station.stop("m1")).phase).toBe("IDLE");
    // and the station takes the next match
    expect((await w.station.prepare({ ...REQ, matchId: "m2", recordingId: "r2", videoKey: "2026/10/r2.mp4" })).phase).toBe("LIVE");
  });

  it("BGMI not installed: still records the home screen and says so", async () => {
    const w = world({ installed: false });
    const s = await w.station.prepare(REQ);
    expect(s.phase).toBe("LIVE");
    expect(s.bgmiInstalled).toBe(false);
    expect(w.dev.calls.launch).toBe(0);
  });

  it("scrcpy dies mid-match: restarts as a new part, HLS appended (discontinuity), MP4 parts joined on stop", async () => {
    const w = world();
    await w.station.prepare(REQ);
    w.sp.of("scrcpy")[0]!.die(1);
    await until(() => w.sp.of("scrcpy").length === 2);
    await new Promise((r) => setTimeout(r, 40));
    expect(w.station.phase).toBe("LIVE");
    const tee2 = w.sp.of("ffmpeg")[1]!.args.at(-1)!;
    expect(tee2).toContain("append_list");
    expect(tee2).toContain("p1-%05d.ts");
    expect(tee2).toContain("part-001.mp4");
    await w.station.stop("m1");
    await w.station.settled();
    expect(w.finalized[0]!.parts.map((p) => path.basename(p))).toEqual(["part-000.mp4", "part-001.mp4"]);
    expect(w.api.calls.complete).toHaveLength(1);
  });

  it("capture keeps dying: gives up → ERROR, still finalises what was recorded", async () => {
    const w = world({ maxRestarts: 1 });
    await w.station.prepare(REQ);
    w.sp.of("ffmpeg")[0]!.die(1);
    await until(() => w.sp.of("ffmpeg").length === 2);
    await new Promise((r) => setTimeout(r, 40));
    w.sp.of("ffmpeg")[1]!.die(1);
    await until(() => w.station.phase === "ERROR");
    expect(w.station.error).toMatch(/restarts/);
    expect(w.finalized).toHaveLength(1);
    expect(w.api.calls.complete).toHaveLength(1);
    expect((await w.station.status()).matchId).toBeNull();
    // ERROR accepts a new prepare
    expect((await w.station.prepare({ ...REQ, recordingId: "r2", videoKey: "2026/10/r2.mp4" })).phase).toBe("LIVE");
  });

  it("scrcpy can't start at all: ERROR and the recording is reported as failed", async () => {
    const w = world();
    w.sp.setBeforeSpawn((p) => {
      if (p.cmd === "scrcpy") {
        p.out = "ERROR: Could not find any ADB device";
        setTimeout(() => p.die(1), 2);
      }
    });
    const s = await w.station.prepare(REQ);
    expect(s.phase).toBe("ERROR");
    expect(s.error).toMatch(/scrcpy could not start: ERROR: Could not find any ADB device/);
    expect(w.api.calls.fail).toEqual([{ id: "r1", body: { error: expect.stringMatching(/scrcpy could not start/) } }]);
    expect(w.sp.of("ffmpeg")[0]!.exited).toBe(true);
  });

  it("emulator fails to boot: ERROR + fail hook", async () => {
    const w = world({ emulator: async () => Promise.reject(new Error("The emulator took too long to start")) });
    const s = await w.station.prepare(REQ);
    expect(s.phase).toBe("ERROR");
    expect(s.error).toBe("The emulator took too long to start");
    expect(w.api.calls.fail[0]!.body.error).toBe("The emulator took too long to start");
  });

  it("stop while the emulator is still booting cancels the start", async () => {
    let release!: (s: string) => void;
    const w = world({ emulator: (() => new Promise<string>((r) => (release = r))) as () => Promise<string> });
    const s = await w.station.prepare({ ...REQ });
    expect(s.phase).toBe("STARTING_EMULATOR");
    const st = await w.station.stop("m1");
    expect(st.phase).toBe("STOPPING");
    release("emulator-5554");
    await w.station.settled();
    expect(w.station.phase).toBe("IDLE");
    expect(w.sp.procs).toHaveLength(0);
    expect(w.api.calls.fail[0]!.body.error).toMatch(/Stopped before/);
  });

  it("input: only for the live match, mapped by the device", async () => {
    const w = world();
    await expect(w.station.input("m1", { type: "tap", x: 0.5, y: 0.5 })).rejects.toMatchObject({ status: 409 });
    await w.station.prepare(REQ);
    await expect(w.station.input("m2", { type: "tap", x: 0.5, y: 0.5 })).rejects.toMatchObject({ status: 409 });
    await w.station.input("m1", { type: "tap", x: 0.5, y: 0.5 });
    expect(w.dev.calls.inputs).toEqual([{ input: { type: "tap", x: 0.5, y: 0.5 }, mode: "logical" }]);
  });

  it("capture: PNG under STORAGE_DIR/station/captures, relative path returned", async () => {
    const w = world();
    const { file } = await w.station.capture("m1", "RESULTS");
    expect(file).toMatch(/^station\/captures\/m1\/\d+-results\.png$/);
    expect(readFileSync(path.join(w.storageDir, file)).readUInt32BE(0)).toBe(0x89504e47);
    await w.station.prepare(REQ);
    await expect(w.station.capture("other", "RESULTS")).rejects.toMatchObject({ status: 409 });
  });

  it("recover: finishes a session a crashed station left behind", async () => {
    const w = world();
    const dir = path.join(w.workDir, "sessions/r7");
    mkdirSync(dir, { recursive: true });
    const live = path.join(w.storageDir, "live/m7");
    mkdirSync(live, { recursive: true });
    writeFileSync(path.join(live, "index.m3u8"), "#EXTM3U\n");
    writeFileSync(
      path.join(dir, "session.json"),
      JSON.stringify({ matchId: "m7", recordingId: "r7", videoKey: "2026/10/r7.mp4", title: "", liveDir: live, startedAt: new Date().toISOString(), parts: [path.join(dir, "part-000.mp4")], pids: [] }),
    );
    expect(await w.station.recover()).toBe(1);
    expect(w.finalized[0]!.videoKey).toBe("2026/10/r7.mp4");
    expect(w.api.calls.complete[0]!.id).toBe("r7");
    expect(existsSync(dir)).toBe(false);
    expect(readFileSync(path.join(live, "index.m3u8"), "utf8")).toContain("#EXT-X-ENDLIST");
  });

  it("sweepLive: deletes old live dirs, keeps recent ones and the active match", async () => {
    const w = world();
    await w.station.prepare(REQ);
    const old = path.join(w.storageDir, "live/old");
    const fresh = path.join(w.storageDir, "live/fresh");
    mkdirSync(old, { recursive: true });
    mkdirSync(fresh, { recursive: true });
    writeFileSync(path.join(old, "index.m3u8"), "#EXTM3U\n");
    const past = new Date(Date.now() - 11 * 60_000);
    utimesSync(path.join(old, "index.m3u8"), past, past);
    utimesSync(old, past, past);
    const activeDir = path.join(w.storageDir, "live/m1");
    utimesSync(activeDir, past, past);
    expect(await w.station.sweepLive()).toBe(1);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(activeDir)).toBe(true);
  });
});

// ---------------------------------------------------------------- HTTP

describe("station HTTP server", () => {
  const TOKEN = "s3cret-token-0123456789";
  let base = "";
  let close = () => {};
  let w: ReturnType<typeof world>;
  beforeEach(async () => {
    w = world();
    const server = createStationServer(w.station, { token: TOKEN });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();
  });
  afterEach(() => close());

  const call = (method: string, p: string, body?: unknown, token: string | null = TOKEN) =>
    fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token != null ? { "X-Station-Token": token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it("refuses requests without the right token", async () => {
    expect((await call("GET", "/health", undefined, null)).status).toBe(401);
    expect((await call("GET", "/health", undefined, "wrong")).status).toBe(401);
    expect((await call("POST", "/sessions", REQ, "")).status).toBe(401);
    const ok = await call("GET", "/health");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ online: true, phase: "IDLE", emulator: "READY", version: "test" });
  });

  it("prepare / busy / input / stop over HTTP", async () => {
    const r = await call("POST", "/sessions", REQ);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { phase: string }).phase).toBe("LIVE");
    expect((await call("POST", "/sessions", { ...REQ, matchId: "m2", recordingId: "r2" })).status).toBe(409);
    expect((await call("POST", "/sessions", { ...REQ, videoKey: "../../etc/passwd.mp4" })).status).toBe(400);
    expect((await call("POST", "/sessions/input", { matchId: "m1", type: "tap", x: 2, y: 0 })).status).toBe(400);
    expect((await call("POST", "/sessions/input", { matchId: "m1", type: "key", key: "BACK" })).status).toBe(204);
    const cap = await call("POST", "/sessions/capture", { matchId: "m1", kind: "SLOT_LIST" });
    expect(cap.status).toBe(200);
    expect(((await cap.json()) as { file: string }).file).toMatch(/^station\/captures\/m1\//);
    expect((await call("POST", "/sessions/stop", { matchId: "m1" })).status).toBe(200);
    await w.station.settled();
    expect(w.api.calls.complete).toHaveLength(1);
    expect((await call("GET", "/nope")).status).toBe(404);
  });
});
