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
    version: packageVersion(),
  };
}
