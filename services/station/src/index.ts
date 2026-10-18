/** 7XEN Station entry point: wire config → adb/emulator/capture → state machine → HTTP server. */
import { readFile } from "node:fs/promises";
import { AdbDevice } from "./adb.js";
import { BlueStacksControl, BlueStacksDevice, BsClient, BsLink, makeEnsureBlueStacks } from "./bluestacks.js";
import { FrameSource } from "./frameSource.js";
import { makeApiHooks } from "./apiClient.js";
import { CapturePipeline } from "./capture.js";
import { loadConfig } from "./config.js";
import { makeEnsureEmulator } from "./emulator.js";
import { makeFinalizer } from "./finalize.js";
import { log } from "./log.js";
import { realSpawner } from "./proc.js";
import { createStationServer } from "./server.js";
import { Station } from "./session.js";

const cfg = loadConfig();
if (cfg.token.length < 16) {
  console.error("STATION_TOKEN is missing or shorter than 16 characters (set it in services/station/.env). Refusing to start.");
  process.exit(1);
}

if (cfg.bluestacks && !cfg.bluestacks.token) {
  console.error("BLUESTACKS_URL is set but BLUESTACKS_TOKEN is empty (the server prints it; see its .token file). Refusing to start.");
  process.exit(1);
}

// BlueStacks mode: the game device is BlueStacks on a Mac, reached through its stream API instead of adb
const bsClient = cfg.bluestacks ? new BsClient(cfg.bluestacks) : null;
const bsLink = bsClient ? new BsLink(bsClient) : null;
const bsDevice = bsClient && bsLink && cfg.bluestacks ? new BlueStacksDevice(bsClient, bsLink, { ffmpeg: cfg.ffmpeg, jobTimeoutMs: cfg.bluestacks.jobTimeoutMs }) : null;
const device = bsDevice ?? new AdbDevice(cfg.adb, cfg.serial, cfg.bgmiPackage, cfg.remoteDevice);
const api = makeApiHooks(cfg.apiUrl, cfg.token);

/** SIGINT a leftover scrcpy/ffmpeg from a crashed run (only if the pid still is one of ours). */
async function killPid(pid: number) {
  try {
    const cmd = (await readFile(`/proc/${pid}/cmdline`, "utf8")).replace(/\0/g, " ");
    if (!/scrcpy|ffmpeg/.test(cmd)) return;
    process.kill(pid, "SIGINT");
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      process.kill(pid, 0);
    }
    process.kill(pid, "SIGKILL");
  } catch {
    /* gone */
  }
}

const station = new Station({
  device,
  control: bsDevice && bsLink ? new BlueStacksControl(bsDevice, bsLink) : undefined,
  ensureEmulator: bsDevice
    ? makeEnsureBlueStacks(bsDevice)
    : makeEnsureEmulator(device, realSpawner, {
        emulator: cfg.emulator,
        avd: cfg.avd,
        avdHome: cfg.avdHome,
        androidHome: cfg.androidHome,
        display: cfg.display,
        args: cfg.emulatorArgs,
        bootTimeoutMs: cfg.bootTimeoutMs,
        logDir: cfg.workDir,
        remote: cfg.remoteDevice,
      }),
  makePipeline: (req) =>
    new CapturePipeline({
      spawner: realSpawner,
      scrcpy: cfg.scrcpy,
      scrcpyServer: cfg.scrcpyServer,
      adb: cfg.adb,
      ffmpeg: cfg.ffmpeg,
      serial: req.serial,
      workDir: req.workDir,
      liveDir: req.liveDir,
      maxSize: cfg.maxSize,
      bitrateMbps: req.bitrateMbps,
      maxFps: req.maxFps,
      hlsTime: cfg.hlsTime,
      hlsListSize: cfg.hlsListSize,
      maxRestarts: cfg.maxRestarts,
      startSource: bsLink ? (fifo) => new FrameSource(bsLink, fifo) : undefined,
    }),
  finalize: makeFinalizer(cfg.ffmpeg, cfg.videoDir),
  api,
  storageDir: cfg.storageDir,
  workDir: cfg.workDir,
  bgmiPackage: cfg.bgmiPackage,
  inputCoords: cfg.inputCoords,
  liveKeepMs: cfg.liveKeepMs,
  version: cfg.version,
  defaultBitrateMbps: cfg.bitrateMbps,
  defaultMaxFps: cfg.maxFps,
  killPid,
});

const server = createStationServer(station, { token: cfg.token, api, link: bsLink ?? undefined });
server.listen(cfg.port, cfg.host, () => {
  log.info("7XEN Station listening", { device: cfg.bluestacks ? `BlueStacks ${cfg.bluestacks.url}` : cfg.remoteDevice || "local AVD", host: cfg.host, port: cfg.port, api: cfg.apiUrl, storage: cfg.storageDir, videos: cfg.videoDir });
});

void station
  .recover()
  .then((n) => n && log.info("recovered unfinished recordings", { n }))
  .catch((err) => log.error("recovery failed", { err }));
const sweep = setInterval(() => void station.sweepLive().catch(() => {}), 60_000);
void station.sweepLive().catch(() => {});

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  log.info(`${signal} received: finishing the active recording, then exiting`);
  clearInterval(sweep);
  server.close();
  const hard = setTimeout(() => process.exit(1), 90_000);
  hard.unref();
  await station.shutdown().catch((err) => log.error("shutdown failed", { err }));
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
