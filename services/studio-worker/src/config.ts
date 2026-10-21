/** Worker settings from the environment (scripts load an optional .env next to package.json). */
import { readFileSync } from "node:fs";

export interface Config {
  apiUrl: string;
  workerKey: string;
  ffmpegPath: string;
  /** Chrome binary; null = Playwright finds the installed Google Chrome (channel "chrome") */
  chromePath: string | null;
  /** force an ffmpeg encoder instead of detecting one */
  encoder: string | null;
  /** extra Chrome flags, space separated (e.g. "--enable-gpu") */
  chromeArgs: string[];
  /**
   * Publish to this RTMP base instead of the job's host, e.g. rtmp://127.0.0.1:1937/live when the media server runs
   * on this same machine (the job's path and publish token are kept). null = use the job's publishUrl as is.
   */
  publishBase: string | null;
  /**
   * HLS base of a media server on this same machine, e.g. http://127.0.0.1:8890 — the render page's phone feeds are
   * then read from it directly (with the job's read token) instead of through the API. null = through the API.
   */
  localHlsBase: string | null;
  version: string;
}

export class ConfigError extends Error {}

export function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const workerKey = env.WORKER_KEY?.trim();
  if (!workerKey) throw new ConfigError("WORKER_KEY is missing. Create a worker in Studio → Studio workers on the website and put its key in services/studio-worker/.env");
  const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
  return {
    apiUrl: (blank(env.API_URL) ?? "https://airbattleground.com").replace(/\/+$/, ""),
    workerKey,
    ffmpegPath: blank(env.FFMPEG_PATH) ?? "ffmpeg",
    chromePath: blank(env.CHROME_PATH),
    encoder: blank(env.ENCODER),
    chromeArgs: (blank(env.CHROME_ARGS) ?? "").split(/\s+/).filter(Boolean),
    publishBase: blank(env.PUBLISH_RTMP_BASE)?.replace(/\/+$/, "") ?? null,
    localHlsBase: blank(env.LOCAL_HLS_BASE)?.replace(/\/+$/, "") ?? null,
    version: packageVersion(),
  };
}
