/**
 * The box's MediaMTX: the auth-hook decision, and the box's own calls to it (HLS reads, path state, kicking a phone)
 * with the internal credentials.
 */
import type { Tokens } from "./tokens.js";

export const devicePath = (deviceId: string) => `live/dev_${deviceId}`;
const DEV_PATH_RE = /^live\/dev_([A-Za-z0-9]{8,40})$/;
const SHOW_PATH_RE = /^live\/show_[A-Za-z0-9]{8,40}$/;

/** MediaMTX 1.x auth hook body */
export interface MediaAuthRequest {
  user?: string;
  password?: string;
  ip?: string;
  action?: string;
  path?: string;
  protocol?: string;
  query?: string;
}

export const isLoopback = (ip: string | undefined) => !!ip && (ip === "::1" || ip.startsWith("127.") || ip.startsWith("::ffff:127."));

/**
 * May this publish / read / api call happen?
 *   - the box's internal user/pass: anything
 *   - publish live/dev_<id>: a valid token for that (still paired) phone
 *   - publish live/show_<id> from this machine: the Studio worker's local copy of the show (preview)
 *   - read / playback from this machine (the box itself, its worker's Chrome)
 */
export function authorizeMedia(
  req: MediaAuthRequest,
  deps: { tokens: Tokens; deviceKeyHash: (id: string) => string | undefined; now?: number },
): boolean {
  if (deps.tokens.isInternal(req.user, req.password)) return true;
  const local = isLoopback(req.ip);
  if (req.action === "read" || req.action === "playback") return local;
  if (req.action !== "publish") return false;
  if (SHOW_PATH_RE.test(req.path ?? "")) return local;
  const m = DEV_PATH_RE.exec(req.path ?? "");
  if (!m) return false;
  const keyHash = deps.deviceKeyHash(m[1]!);
  if (!keyHash) return false;
  const token = new URLSearchParams(req.query ?? "").get("token") ?? "";
  return deps.tokens.verifyPublishToken(m[1]!, keyHash, token, deps.now);
}

export class MediaClient {
  constructor(
    private readonly hlsUrl: string,
    private readonly apiUrl: string,
    private readonly tokens: Tokens,
  ) {}

  /** GET a file of a phone's HLS (null when MediaMTX is unreachable). */
  fetchHls(deviceId: string, file: string, search: string, signal?: AbortSignal): Promise<Response | null> {
    return this.fetchHlsPath(devicePath(deviceId), file, search, signal);
  }

  /** GET a file of any path's HLS, e.g. live/show_<id> (the worker's local copy of the show). */
  async fetchHlsPath(mediaPath: string, file: string, search: string, signal?: AbortSignal): Promise<Response | null> {
    try {
      return await fetch(`${this.hlsUrl}/${mediaPath}/${file}${search}`, {
        headers: { Authorization: this.tokens.internalAuthHeader },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
      });
    } catch {
      return null;
    }
  }

  /** Is MediaMTX receiving this phone's video? readySince = since when; null = no (or unreachable). */
  async pathReady(deviceId: string): Promise<{ readySince: Date } | null> {
    try {
      const res = await fetch(`${this.apiUrl}/v3/paths/get/${encodeURIComponent(devicePath(deviceId))}`, {
        headers: { Authorization: this.tokens.internalAuthHeader },
        signal: AbortSignal.timeout(3_000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { ready?: boolean; readyTime?: string | null };
      if (!body.ready) return null;
      const t = body.readyTime ? new Date(body.readyTime) : new Date();
      return { readySince: Number.isNaN(t.getTime()) ? new Date() : t };
    } catch {
      return null;
    }
  }

  /** Disconnect a phone's publisher (it was removed). Best effort. */
  async kick(deviceId: string): Promise<void> {
    const headers = { Authorization: this.tokens.internalAuthHeader };
    try {
      const res = await fetch(`${this.apiUrl}/v3/rtmpconns/list?itemsPerPage=1000`, { headers, signal: AbortSignal.timeout(3_000) });
      if (!res.ok) return;
      const { items = [] } = (await res.json()) as { items?: { id: string; path: string }[] };
      await Promise.all(
        items
          .filter((c) => c.path === devicePath(deviceId))
          .map((c) => fetch(`${this.apiUrl}/v3/rtmpconns/kick/${c.id}`, { method: "POST", headers, signal: AbortSignal.timeout(3_000) })),
      );
    } catch {
      /* media server down: nothing to kick */
    }
  }
}
