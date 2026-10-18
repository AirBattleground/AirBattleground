/**
 * Phase 4b: HTTP client for the 7XEN Station (host-side service, see services/station).
 * STATION_URL / STATION_TOKEN are read lazily so tests can point them at a fake station.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { STATION_OFFLINE_MESSAGE, STATION_TOKEN_HEADER, type StationStatus } from "@7xen/shared";
import { AppError, conflict } from "./errors.js";
import { logger } from "../logger.js";

export const stationUrl = () => (process.env.STATION_URL?.trim() || "http://127.0.0.1:4500").replace(/\/+$/, "");
export const stationToken = () => process.env.STATION_TOKEN?.trim() ?? "";

/** Constant-time check of an incoming X-Station-Token (hashing first equalises lengths). */
export function stationTokenMatches(given: string | undefined): boolean {
  const expected = stationToken();
  if (!expected || !given) return false;
  return timingSafeEqual(createHash("sha256").update(expected).digest(), createHash("sha256").update(given).digest());
}

export const stationOffline = () => new AppError("STATION_OFFLINE", STATION_OFFLINE_MESSAGE);

/** Call the station. Unreachable/timeout → 503 STATION_OFFLINE; station 409 → CONFLICT with its message. */
export async function stationCall<T>(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = 20_000): Promise<T> {
  if (!stationToken()) throw stationOffline();
  let res: Response;
  try {
    res = await fetch(stationUrl() + path, {
      method,
      headers: { [STATION_TOKEN_HEADER]: stationToken(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    logger.warn({ err: (err as Error).message, path }, "station unreachable");
    throw stationOffline();
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (res.ok) return data as T;
  const message = data?.error?.message ?? `Station error ${res.status}`;
  if (res.status === 409) throw conflict(message);
  if (res.status === 400) throw new AppError("VALIDATION_ERROR", message);
  if (res.status === 401) {
    logger.error("the station refused our token: STATION_TOKEN differs between the API and the station");
    throw new AppError("STATION_OFFLINE", "The 7XEN Station refused the connection (token mismatch). Ask the admin to check STATION_TOKEN.");
  }
  logger.error({ status: res.status, message, path }, "station error");
  throw new AppError("INTERNAL", `The 7XEN Station had a problem: ${message}`, undefined, 502);
}

function offlineStatus(error: string | null = null): StationStatus {
  return {
    online: false,
    emulator: "OFF",
    bgmiInstalled: false,
    phase: "IDLE",
    matchId: null,
    recordingId: null,
    startedAt: null,
    screen: null,
    rotation: null,
    error,
    version: "",
    matchTitle: null,
  };
}

/** Station status; never throws (online=false when unreachable). */
export async function fetchStationStatus(): Promise<StationStatus> {
  try {
    const s = await stationCall<StationStatus>("GET", "/health", undefined, 8000);
    return { ...s, online: true };
  } catch (err) {
    return offlineStatus(err instanceof AppError && err.code !== "STATION_OFFLINE" ? err.message : null);
  }
}
