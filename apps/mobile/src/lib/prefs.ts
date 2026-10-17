/** App preferences (pure part — parsing/defaults; unit tested). Stored as JSON in SecureStore. */
import { DEFAULT_SERVER_URL, normalizeServerUrl } from "./server";

export interface Prefs {
  serverUrl: string;
  /** default Go-live mode; Auto still needs an explicit confirm every time */
  defaultMode: "ASSISTED" | "AUTO";
  /** upload match videos only on Wi-Fi */
  wifiOnly: boolean;
  quality: "720p" | "1080p";
  /** detect team list / results and capture them automatically */
  autoCapture: boolean;
  /** open BGMI right after Go live */
  launchBgmi: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  serverUrl: DEFAULT_SERVER_URL,
  defaultMode: "ASSISTED",
  wifiOnly: true,
  quality: "720p",
  autoCapture: true,
  launchBgmi: true,
};

export function parsePrefs(raw: string | null): Prefs {
  if (!raw) return { ...DEFAULT_PREFS };
  try {
    const v = JSON.parse(raw) as Partial<Prefs>;
    return {
      serverUrl: (typeof v.serverUrl === "string" && normalizeServerUrl(v.serverUrl)) || DEFAULT_PREFS.serverUrl,
      defaultMode: v.defaultMode === "AUTO" ? "AUTO" : "ASSISTED",
      wifiOnly: typeof v.wifiOnly === "boolean" ? v.wifiOnly : DEFAULT_PREFS.wifiOnly,
      quality: v.quality === "1080p" ? "1080p" : "720p",
      autoCapture: typeof v.autoCapture === "boolean" ? v.autoCapture : DEFAULT_PREFS.autoCapture,
      launchBgmi: typeof v.launchBgmi === "boolean" ? v.launchBgmi : DEFAULT_PREFS.launchBgmi,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}
