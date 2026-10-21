/**
 * Who may use the box's Studio API (/box/*): a signed-in MANAGER. The box has no logins of its own — it forwards
 * the browser's cookies to the website's GET /api/auth/me (the same session the proxied website uses) and caches
 * the answer per cookie for 60 s.
 */
import { createHash } from "node:crypto";
import type { AuthResponse } from "@7xen/shared";
import { HttpError } from "./http.js";

export const AUTH_CACHE_MS = 60_000;

export type FetchLike = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>;

type Verdict = { ok: true; userId: string } | { ok: false; status: 401 | 403 };

export class ManagerAuth {
  private cache = new Map<string, { at: number; verdict: Verdict }>();

  constructor(
    private readonly apiUrl: string,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly now: () => number = Date.now,
  ) {}

  private async check(cookie: string): Promise<Verdict> {
    let res;
    try {
      res = await this.fetchImpl(`${this.apiUrl}/api/auth/me`, { headers: { cookie, accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
    } catch {
      throw new HttpError(503, "INTERNAL", "The Studio box can't reach AirBattleground to check your sign-in. Check the internet connection.");
    }
    if (res.status === 401) return { ok: false, status: 401 };
    if (!res.ok) throw new HttpError(503, "INTERNAL", "AirBattleground didn't answer the sign-in check. Try again in a moment.");
    const body = (await res.json().catch(() => null)) as AuthResponse | null;
    if (!body?.user) return { ok: false, status: 401 };
    return body.user.role === "MANAGER" ? { ok: true, userId: body.user.id } : { ok: false, status: 403 };
  }

  /** Throws 401 / 403 unless the cookies belong to a manager. */
  async require(cookie: string | undefined): Promise<{ userId: string }> {
    if (!cookie) throw new HttpError(401, "UNAUTHENTICATED", "Please log in to continue");
    const k = createHash("sha256").update(cookie).digest("hex");
    const t = this.now();
    let hit = this.cache.get(k);
    if (!hit || t - hit.at > AUTH_CACHE_MS) {
      hit = { at: t, verdict: await this.check(cookie) };
      if (this.cache.size > 1000) this.cache.clear();
      this.cache.set(k, hit);
    }
    const v = hit.verdict;
    if (v.ok) return { userId: v.userId };
    if (v.status === 401) throw new HttpError(401, "UNAUTHENTICATED", "Please log in to continue");
    throw new HttpError(403, "FORBIDDEN", "The Studio box is for manager accounts");
  }
}
