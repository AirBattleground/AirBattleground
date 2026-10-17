/**
 * Station configuration from the environment (+ services/station/.env when present).
 *
 * Paths: STORAGE_DIR must be the same folder the API sees (in production it is bind-mounted into the
 * API container at /data/storage), so everything exchanged with the API is a path RELATIVE to it
 * (live/<matchId>/index.m3u8) or to VIDEO_DIR (the recording's videoKey).
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const STATION_DIR = path.resolve(here, "..");
export const REPO_ROOT = path.resolve(STATION_DIR, "../..");

const envFile = process.env.STATION_ENV_FILE ?? path.join(STATION_DIR, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const home = homedir();
const androidRoot = path.join(home, ".local/share/7xen-android");
const str = (k: string, d: string) => process.env[k]?.trim() || d;
const num = (k: string, d: number) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && process.env[k]?.trim() ? v : d;
};
const expand = (p: string) => (p.startsWith("~/") ? path.join(home, p.slice(2)) : p);

export interface StationConfig {
  port: number;
  host: string;
  token: string;
  apiUrl: string;
  storageDir: string;
  videoDir: string;
  workDir: string;
  adb: string;
  scrcpy: string;
  scrcpyServer: string;
  ffmpeg: string;
  emulator: string;
  androidHome: string;
  avdHome: string;
  avd: string;
  display: string;
  emulatorArgs: string[];
  /** adb serial to use; empty = first emulator-* device */
  serial: string;
  bootTimeoutMs: number;
  bgmiPackage: string;
  /** longest side of the captured video (0 = native) */
  maxSize: number;
  bitrateMbps: number;
  maxFps: number;
  hlsTime: number;
  hlsListSize: number;
  /** keep the last playlist this long after a stop, then delete the live dir */
  liveKeepMs: number;
  /** "logical" = `adb shell input` takes coordinates of the rotated (displayed) screen; "natural" = portrait panel */
  inputCoords: "logical" | "natural";
  maxRestarts: number;
  version: string;
}

export function loadConfig(): StationConfig {
  const storageDir = path.resolve(expand(str("STORAGE_DIR", path.join(REPO_ROOT, "storage"))));
  const androidHome = expand(str("ANDROID_HOME", path.join(androidRoot, "sdk")));
  return {
    port: num("STATION_PORT", 4500),
    host: str("STATION_HOST", "0.0.0.0"),
    token: process.env.STATION_TOKEN?.trim() ?? "",
    apiUrl: str("API_URL", "http://127.0.0.1:4000").replace(/\/+$/, ""),
    storageDir,
    videoDir: path.resolve(expand(str("VIDEO_DIR", path.join(storageDir, "videos")))),
    workDir: path.resolve(expand(str("STATION_WORK_DIR", path.join(storageDir, "station")))),
    adb: expand(str("ADB", path.join(androidHome, "platform-tools/adb"))),
    scrcpy: expand(str("SCRCPY", path.join(androidRoot, "scrcpy/scrcpy"))),
    scrcpyServer: expand(str("SCRCPY_SERVER_PATH", path.join(androidRoot, "scrcpy/scrcpy-server"))),
    ffmpeg: expand(str("FFMPEG", existsSync(path.join(home, ".local/bin/ffmpeg")) ? path.join(home, ".local/bin/ffmpeg") : "ffmpeg")),
    emulator: expand(str("EMULATOR", path.join(androidHome, "emulator/emulator"))),
    androidHome,
    avdHome: expand(str("ANDROID_AVD_HOME", path.join(androidRoot, "avd"))),
    avd: str("AVD_NAME", "bgmi14"),
    display: str("DISPLAY", ":0"),
    emulatorArgs: str("EMULATOR_ARGS", "-gpu host -no-boot-anim -no-snapshot-save").split(/\s+/).filter(Boolean),
    serial: str("ADB_SERIAL", ""),
    bootTimeoutMs: num("EMULATOR_BOOT_TIMEOUT_SEC", 240) * 1000,
    bgmiPackage: str("BGMI_PACKAGE", "com.pubg.imobile"),
    maxSize: num("CAPTURE_MAX_SIZE", 1280),
    bitrateMbps: num("CAPTURE_BITRATE_MBPS", 6),
    maxFps: num("CAPTURE_MAX_FPS", 30),
    hlsTime: num("HLS_TIME", 2),
    hlsListSize: num("HLS_LIST_SIZE", 6),
    liveKeepMs: num("LIVE_KEEP_MIN", 10) * 60_000,
    inputCoords: str("INPUT_COORDS", "logical") === "natural" ? "natural" : "logical",
    maxRestarts: num("CAPTURE_MAX_RESTARTS", 5),
    version: "0.1.0",
  };
}

