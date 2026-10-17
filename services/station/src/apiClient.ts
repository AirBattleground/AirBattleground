/** Calls from the station to the API's internal hooks (header X-Station-Token). */
import { STATION_TOKEN_HEADER, type StationCompleteInput, type StationFailInput } from "@7xen/shared";
import { log } from "./log.js";

export interface ApiHooks {
  complete(recordingId: string, body: StationCompleteInput): Promise<void>;
  fail(recordingId: string, body: StationFailInput): Promise<void>;
  screenshot(matchId: string, kind: "SLOT_LIST" | "RESULTS", png: Buffer): Promise<unknown>;
}

class HookError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function makeApiHooks(apiUrl: string, token: string, opts: { retries?: number; baseDelayMs?: number } = {}): ApiHooks {
  const retries = opts.retries ?? 8;
  const base = opts.baseDelayMs ?? 1000;

  async function call(pathname: string, init: RequestInit): Promise<Response> {
    const res = await fetch(`${apiUrl}${pathname}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), [STATION_TOKEN_HEADER]: token },
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new HookError(`API ${pathname} → ${res.status} ${text.slice(0, 200)}`, res.status);
    }
    return res;
  }

  /** Retry network errors and 5xx (API restarting); 4xx are final. */
  async function withRetry<T>(what: string, fn: () => Promise<T>): Promise<T> {
    for (let i = 0; ; i++) {
      try {
        return await fn();
      } catch (err) {
        const status = err instanceof HookError ? err.status : 0;
        if ((status >= 400 && status < 500) || i >= retries) throw err;
        const wait = Math.min(30_000, base * 2 ** i);
        log.warn(`${what} failed, retrying`, { err, inMs: wait });
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }

  const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  return {
    async complete(recordingId, body) {
      await withRetry("complete hook", () => call(`/api/internal/station/recordings/${encodeURIComponent(recordingId)}/complete`, json(body)));
    },
    async fail(recordingId, body) {
      await withRetry("fail hook", () => call(`/api/internal/station/recordings/${encodeURIComponent(recordingId)}/fail`, json(body)));
    },
    async screenshot(matchId, kind, png) {
      const form = new FormData();
      form.set("kind", kind);
      form.append("files", new Blob([new Uint8Array(png)], { type: "image/png" }), `station-${Date.now()}.png`);
      const res = await call(`/api/internal/station/matches/${encodeURIComponent(matchId)}/screenshots`, { method: "POST", body: form });
      return res.json();
    },
  };
}
