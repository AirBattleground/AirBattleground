/**
 * The station state machine (one match at a time):
 *
 *   IDLE → STARTING_EMULATOR → LAUNCHING_BGMI → LIVE → STOPPING → IDLE
 *                 ↘───────────────↘──────────────↘→ ERROR (prepare is allowed again from ERROR)
 *
 * A session's facts (match, recording, video key, MP4 parts, child pids) are written to
 * <workDir>/sessions/<recordingId>/session.json so a crashed/restarted station can still finalise the
 * recording and report it to the API (see `recover`).
 */
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EmulatorState, StationInput, StationPhase, StationPrepareRequest, StationStatus } from "@7xen/shared";
import type { Device, DeviceFacts } from "./adb.js";
import type { ApiHooks } from "./apiClient.js";
import { endPlaylist } from "./capture.js";
import type { EnsureEmulator } from "./emulator.js";
import type { Finalizer } from "./finalize.js";
import { log } from "./log.js";

export class StationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** What the session needs from a capture pipeline (CapturePipeline, or a fake in tests). */
export interface Pipeline {
  readonly parts: string[];
  readonly pids: number[];
  start(): Promise<void>;
  stop(): Promise<string[]>;
  on(event: "failed", fn: (message: string) => void): unknown;
  on(event: "restart", fn: (part: number, reason: string) => void): unknown;
}

export interface PipelineRequest {
  serial: string;
  workDir: string;
  liveDir: string;
  bitrateMbps: number;
  maxFps: number;
}

export interface StationDeps {
  device: Device;
  ensureEmulator: EnsureEmulator;
  makePipeline: (req: PipelineRequest) => Pipeline;
  finalize: Finalizer;
  api: ApiHooks;
  storageDir: string;
  workDir: string;
  bgmiPackage: string;
  inputCoords: "logical" | "natural";
  liveKeepMs: number;
  version: string;
  defaultBitrateMbps: number;
  defaultMaxFps: number;
  /** how long POST /sessions waits for LIVE before answering with the current phase */
  prepareWaitMs?: number;
  factsCacheMs?: number;
  /** kill leftover capture processes from a crashed run (recover) */
  killPid?: (pid: number) => Promise<void>;
}

interface SessionState {
  matchId: string;
  recordingId: string;
  videoKey: string;
  title: string;
  liveDir: string;
  startedAt: string;
  parts: string[];
  pids: number[];
  /** set once the final MP4 exists (hook still pending) */
  final?: { videoKey: string; sizeBytes: number; durationSec?: number };
}

const ACTIVE: StationPhase[] = ["STARTING_EMULATOR", "LAUNCHING_BGMI", "LIVE", "STOPPING"];
const MATCH_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** STORAGE_DIR-relative live dir of a match. */
export const liveRel = (matchId: string) => `live/${matchId}`;

export class Station {
  phase: StationPhase = "IDLE";
  error: string | null = null;
  private session: SessionState | null = null;
  private pipeline: Pipeline | null = null;
  private serial: string | null = null;
  private booting = false;
  private cancelled = false;
  private running: Promise<void> | null = null;
  private stopping: Promise<void> | null = null;
  private facts: { at: number; value: DeviceFacts } | null = null;
  private bgmiInstalled = false;
  private waiters: (() => void)[] = [];

  constructor(private readonly d: StationDeps) {}

  get matchId() {
    return this.session?.matchId ?? null;
  }

  // ------------------------------------------------------------ status

  private async deviceFacts(fresh = false): Promise<DeviceFacts> {
    const ttl = this.d.factsCacheMs ?? 3000;
    if (!fresh && this.facts && Date.now() - this.facts.at < ttl) return this.facts.value;
    let value: DeviceFacts;
    try {
      value = await this.d.device.facts();
    } catch (err) {
      log.warn("device facts failed", { err });
      value = { serial: null, state: null, booted: false, screen: null, rotation: null, bgmiInstalled: false };
    }
    this.facts = { at: Date.now(), value };
    this.bgmiInstalled = value.bgmiInstalled || (this.bgmiInstalled && !!value.serial && !value.booted);
    return value;
  }

  async status(fresh = false): Promise<StationStatus> {
    const f = await this.deviceFacts(fresh);
    let emulator: EmulatorState = "OFF";
    if (f.serial && f.state === "device" && f.booted) emulator = "READY";
    else if (f.serial || this.booting) emulator = "BOOTING";
    else if (this.phase === "ERROR" && /emulator/i.test(this.error ?? "")) emulator = "ERROR";
    return {
      online: true,
      emulator,
      bgmiInstalled: f.bgmiInstalled,
      phase: this.phase,
      matchId: this.session?.matchId ?? null,
      recordingId: this.session?.recordingId ?? null,
      startedAt: this.session?.startedAt ?? null,
      screen: f.screen,
      rotation: f.rotation,
      error: this.error,
      version: this.d.version,
    };
  }

  private setPhase(p: StationPhase) {
    if (this.phase !== p) log.info("phase", { from: this.phase, to: p, matchId: this.session?.matchId });
    this.phase = p;
    const w = this.waiters;
    this.waiters = [];
    for (const fn of w) fn();
  }

  private waitPhase(pred: () => boolean, ms: number): Promise<void> {
    if (pred() || ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      const check = () => {
        if (pred()) {
          clearTimeout(t);
          resolve();
        } else this.waiters.push(check);
      };
      this.waiters.push(check);
    });
  }

  // ------------------------------------------------------------ persistence

  private sessionDir(recordingId: string) {
    return path.join(this.d.workDir, "sessions", recordingId);
  }

  private async persist() {
    const s = this.session;
    if (!s) return;
    if (this.pipeline) {
      s.parts = [...this.pipeline.parts];
      s.pids = [...this.pipeline.pids];
    }
    const dir = this.sessionDir(s.recordingId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "session.json"), JSON.stringify(s, null, 2));
  }

  // ------------------------------------------------------------ prepare

  async prepare(req: StationPrepareRequest): Promise<StationStatus> {
    if (!MATCH_ID_RE.test(req.matchId) || !MATCH_ID_RE.test(req.recordingId)) throw new StationError(400, "VALIDATION_ERROR", "Invalid match or recording id");
    if (ACTIVE.includes(this.phase)) {
      if (this.session?.matchId === req.matchId && this.phase !== "STOPPING") return this.status();
      throw new StationError(409, "CONFLICT", "The station is busy with another match. Stop it first.");
    }
    const liveDir = path.join(this.d.storageDir, liveRel(req.matchId));
    // a fresh stream: forget any old playlist of this match
    await rm(liveDir, { recursive: true, force: true });
    this.session = {
      matchId: req.matchId,
      recordingId: req.recordingId,
      videoKey: req.videoKey,
      title: req.title,
      liveDir,
      startedAt: new Date().toISOString(),
      parts: [],
      pids: [],
    };
    this.error = null;
    this.cancelled = false;
    this.setPhase("STARTING_EMULATOR");
    await this.persist();
    this.running = this.run(req).catch((err) => log.error("session run crashed", { err }));
    await this.waitPhase(() => this.phase === "LIVE" || this.phase === "ERROR" || this.phase === "IDLE", this.d.prepareWaitMs ?? 10_000);
    return this.status(true);
  }

  private async run(req: StationPrepareRequest): Promise<void> {
    const s = this.session!;
    try {
      this.serial = await this.d.ensureEmulator(() => {
        this.booting = true;
      });
      this.booting = false;
      if (this.cancelled) throw new Error("Stopped before the recording started");

      this.setPhase("LAUNCHING_BGMI");
      this.bgmiInstalled = await this.d.device.isInstalled(this.serial, this.d.bgmiPackage).catch(() => false);
      if (req.launchBgmi && this.bgmiInstalled) {
        await this.d.device.launch(this.serial, this.d.bgmiPackage).catch((err) => log.warn("BGMI launch failed; recording anyway", { err }));
      } else if (req.launchBgmi) {
        log.warn("BGMI is not installed; recording the home screen");
      }
      if (this.cancelled) throw new Error("Stopped before the recording started");

      const pipeline = this.d.makePipeline({
        serial: this.serial,
        workDir: this.sessionDir(s.recordingId),
        liveDir: s.liveDir,
        bitrateMbps: req.bitrateMbps ?? this.d.defaultBitrateMbps,
        maxFps: req.maxFps ?? this.d.defaultMaxFps,
      });
      pipeline.on("restart", (part, reason) => {
        log.warn("capture restarted", { part, reason });
        void this.persist();
      });
      pipeline.on("failed", (message) => void this.onPipelineFailed(message));
      this.pipeline = pipeline;
      await pipeline.start();
      await this.persist();
      if (this.cancelled) {
        // stop() arrived while we were starting: it is waiting for us, then finalises
        return;
      }
      s.startedAt = new Date().toISOString();
      this.setPhase("LIVE");
      this.facts = null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("could not start the session", { err: message });
      this.pipeline = null;
      this.error = this.cancelled ? null : message;
      this.booting = false;
      await this.d.api.fail(s.recordingId, { error: message.slice(0, 300) }).catch((e) => log.error("fail hook failed", { err: e }));
      await rm(this.sessionDir(s.recordingId), { recursive: true, force: true });
      await endPlaylist(s.liveDir);
      this.session = null;
      this.setPhase(this.cancelled ? "IDLE" : "ERROR");
    }
  }

  private async onPipelineFailed(message: string) {
    if (this.phase !== "LIVE" || this.stopping) return;
    log.error("capture failed; finalising what was recorded", { message });
    this.error = message;
    this.stopping = this.finish("ERROR");
    await this.stopping;
  }

  // ------------------------------------------------------------ stop

  async stop(matchId: string): Promise<StationStatus> {
    if (!this.session || !ACTIVE.includes(this.phase)) return this.status();
    if (this.session.matchId !== matchId) throw new StationError(409, "CONFLICT", "The station is busy with another match");
    if (!this.stopping) {
      this.cancelled = true;
      this.stopping = this.finish("IDLE");
    }
    return this.status();
  }

  /** Stop capture, write the final MP4, report it to the API, then go to `end`. */
  private async finish(end: "IDLE" | "ERROR"): Promise<void> {
    const s = this.session!;
    this.setPhase("STOPPING");
    try {
      if (this.running) await this.running; // a start in progress finishes (or fails) first
      if (!this.session) return; // run() failed and already reported
      const pipeline = this.pipeline;
      this.pipeline = null;
      const parts = pipeline ? await pipeline.stop() : s.parts;
      s.parts = parts;
      await this.persist();
      await this.finalizeAndReport(s);
      await rm(this.sessionDir(s.recordingId), { recursive: true, force: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("finalising failed", { err: message });
      this.error = message;
      end = "ERROR";
    } finally {
      await endPlaylist(s.liveDir);
      this.session = null;
      this.stopping = null;
      this.running = null;
      this.cancelled = false;
      this.facts = null;
      this.setPhase(end);
    }
  }

  private async finalizeAndReport(s: SessionState) {
    let final = s.final;
    if (!final) {
      try {
        final = await this.d.finalize(s.parts, s.videoKey);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.d.api.fail(s.recordingId, { error: message.slice(0, 300) });
        return;
      }
      s.final = final;
      await this.persist();
      // parts are no longer needed once the final file exists
      for (const p of s.parts) await rm(p, { force: true });
    }
    await this.d.api.complete(s.recordingId, final);
    log.info("recording reported", { recordingId: s.recordingId, ...final });
  }

  /** Wait until the current stop (if any) has finished. */
  async settled(): Promise<void> {
    if (this.stopping) await this.stopping;
    if (this.running) await this.running;
  }

  // ------------------------------------------------------------ capture / input

  private async serialFor(matchId: string, needLive: boolean): Promise<string> {
    if (needLive || this.session) {
      if (!this.session || this.session.matchId !== matchId) throw new StationError(409, "CONFLICT", "The station isn't running this match");
      if (needLive && this.phase !== "LIVE") throw new StationError(409, "CONFLICT", "The match isn't live on the station yet");
    }
    const dev = await this.d.device.find();
    if (!dev || dev.state !== "device") throw new StationError(409, "CONFLICT", "The emulator isn't running");
    return dev.serial;
  }

  /** Screenshot → PNG under STORAGE_DIR; returns its STORAGE_DIR-relative path. */
  async capture(matchId: string, kind: "SLOT_LIST" | "RESULTS"): Promise<{ file: string; png: Buffer }> {
    if (!MATCH_ID_RE.test(matchId)) throw new StationError(400, "VALIDATION_ERROR", "Invalid match id");
    const serial = await this.serialFor(matchId, false);
    const png = await this.d.device.screencap(serial);
    const rel = `station/captures/${matchId}/${Date.now()}-${kind.toLowerCase()}.png`;
    const abs = path.join(this.d.storageDir, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, png);
    return { file: rel, png };
  }

  async input(matchId: string, input: StationInput): Promise<void> {
    const serial = await this.serialFor(matchId, true);
    await this.d.device.input(serial, input, this.d.inputCoords);
  }

  async launchBgmi(): Promise<void> {
    const dev = await this.d.device.find();
    if (!dev || dev.state !== "device") throw new StationError(409, "CONFLICT", "The emulator isn't running");
    if (!(await this.d.device.isInstalled(dev.serial, this.d.bgmiPackage))) throw new StationError(409, "CONFLICT", "BGMI isn't installed on the emulator");
    await this.d.device.launch(dev.serial, this.d.bgmiPackage);
  }

  // ------------------------------------------------------------ maintenance

  /** Finish sessions a previous (crashed) run left behind. */
  async recover(): Promise<number> {
    const root = path.join(this.d.workDir, "sessions");
    let dirs: string[] = [];
    try {
      dirs = await readdir(root);
    } catch {
      return 0;
    }
    let n = 0;
    for (const dir of dirs) {
      const file = path.join(root, dir, "session.json");
      let s: SessionState;
      try {
        s = JSON.parse(await readFile(file, "utf8")) as SessionState;
      } catch {
        await rm(path.join(root, dir), { recursive: true, force: true });
        continue;
      }
      log.warn("recovering an unfinished recording", { matchId: s.matchId, recordingId: s.recordingId });
      for (const pid of s.pids ?? []) await this.d.killPid?.(pid);
      try {
        await this.finalizeAndReport(s);
        await rm(path.join(root, dir), { recursive: true, force: true });
        n++;
      } catch (err) {
        log.error("recovery failed; will retry on next start", { err, recordingId: s.recordingId });
      }
      await endPlaylist(s.liveDir);
    }
    return n;
  }

  /** Delete live dirs that are not streaming and were last written more than liveKeepMs ago. */
  async sweepLive(now = Date.now()): Promise<number> {
    const root = path.join(this.d.storageDir, "live");
    let dirs: string[] = [];
    try {
      dirs = await readdir(root);
    } catch {
      return 0;
    }
    let n = 0;
    for (const dir of dirs) {
      if (dir === this.session?.matchId) continue;
      const abs = path.join(root, dir);
      try {
        let newest = (await stat(abs)).mtimeMs;
        try {
          newest = Math.max(newest, (await stat(path.join(abs, "index.m3u8"))).mtimeMs);
        } catch {
          /* no playlist */
        }
        if (now - newest < this.d.liveKeepMs) continue;
        await rm(abs, { recursive: true, force: true });
        n++;
      } catch {
        /* raced with another delete */
      }
    }
    // old capture PNGs the API didn't pick up
    const caps = path.join(this.d.storageDir, "station/captures");
    try {
      for (const m of await readdir(caps)) {
        const abs = path.join(caps, m);
        if (now - (await stat(abs)).mtimeMs > 24 * 3600_000) await rm(abs, { recursive: true, force: true });
      }
    } catch {
      /* none */
    }
    return n;
  }

  /** Graceful shutdown: finish the active session (if any). */
  async shutdown(): Promise<void> {
    if (this.session && ACTIVE.includes(this.phase)) {
      await this.stop(this.session.matchId).catch(() => {});
    }
    await this.settled();
  }
}
