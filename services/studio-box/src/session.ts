/**
 * The box's own sign-in: it trades its key (BOX_KEY, the Studio box key from the website) for a session as the box's
 * manager (POST /api/studio-worker/session) and attaches it to everything it proxies — so the box's Studio needs no
 * login. Re-checked every few minutes, so removing the box on the website cuts it off quickly.
 */
import type { BoxSession as Session } from "@7xen/shared";
import { HttpError } from "./http.js";

const RECHECK_MS = 10 * 60_000;

export type SessionFetch = (url: string, init: { method: string; headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>;

export class BoxSession {
  private cur: { token: string; at: number } | null = null;
  private pending: Promise<string> | null = null;

  constructor(
    private readonly apiUrl: string,
    private readonly key: string,
    private readonly fetchImpl: SessionFetch = fetch as unknown as SessionFetch,
    private readonly now: () => number = Date.now,
  ) {}

  /** The manager session token (throws a user-facing 503/401 when the box can't connect). */
  async token(): Promise<string> {
    if (this.cur && this.now() - this.cur.at < RECHECK_MS) return this.cur.token;
    this.pending ??= this.fetchToken().finally(() => (this.pending = null));
    return this.pending;
  }

  invalidate() {
    this.cur = null;
  }

  private async fetchToken(): Promise<string> {
    let res;
    try {
      res = await this.fetchImpl(`${this.apiUrl}/api/studio-worker/session`, {
        method: "POST",
        headers: { "X-Worker-Key": this.key, accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      // keep using the last session through a short internet blip
      if (this.cur) return this.cur.token;
      throw new HttpError(503, "INTERNAL", "The Studio box can't reach AirBattleground. Check the internet connection.");
    }
    if (res.status === 401) {
      this.cur = null;
      throw new HttpError(503, "INTERNAL", "This Studio box isn't connected: its key was removed or is wrong. Add the box again on airbattleground.com and put the new key in BOX_KEY.");
    }
    if (!res.ok) {
      if (this.cur) return this.cur.token;
      throw new HttpError(503, "INTERNAL", "AirBattleground didn't answer. Try again in a moment.");
    }
    const body = (await res.json()) as Session;
    this.cur = { token: body.token, at: this.now() };
    return body.token;
  }
}
