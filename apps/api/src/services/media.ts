/**
 * Phase 6: MediaMTX glue (deploy/media/mediamtx.yml).
 *   - publish tokens for phones: live/dev_<deviceId>?token=<exp>.<hmac>, tied to the device's current key (a new key voids them)
 *   - the auth hook MediaMTX calls for every publish / read / api action
 *   - HLS reads + control-API calls with the API's own credentials
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env.js";
import { prisma } from "../db.js";
import { logger } from "../logger.js";

export const PUBLISH_TOKEN_TTL_MS = 10 * 60_000;
const INTERNAL_USER = "api";

const secret = (purpose: string) => createHash("sha256").update(`7xen-media:${purpose}:${env.JWT_SECRET}`).digest();
const internalPassword = () => secret("internal").toString("hex").slice(0, 40);
export const internalAuthHeader = () => `Basic ${Buffer.from(`${INTERNAL_USER}:${internalPassword()}`).toString("base64")}`;

export const devicePath = (deviceId: string) => `live/dev_${deviceId}`;
/** phase 6b: the composed broadcast output, published by the API's own ffmpeg */
export const outputPath = (deviceId: string) => `live/out_${deviceId}`;
const PATH_RE = /^live\/dev_([A-Za-z0-9]{8,40})$/;
const OUT_PATH_RE = /^live\/out_[A-Za-z0-9]{8,40}$/;

/** user/pass the API uses for its own RTMP reads/publishes (query string ?user=&pass=). */
export const internalCredentials = () => ({ user: INTERNAL_USER, pass: internalPassword() });

const sign = (deviceId: string, keyHash: string, exp: number) => createHmac("sha256", secret("publish")).update(`${deviceId}.${keyHash}.${exp}`).digest("base64url");

export function publishToken(deviceId: string, keyHash: string, now = Date.now()): { token: string; expiresAt: Date } {
  const exp = now + PUBLISH_TOKEN_TTL_MS;
  return { token: `${exp}.${sign(deviceId, keyHash, exp)}`, expiresAt: new Date(exp) };
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface MediaAuthRequest {
  user?: string;
  password?: string;
  action?: string;
  path?: string;
  protocol?: string;
  query?: string;
}

/** MediaMTX auth hook: publish needs a valid device token for that path; everything else needs the API's credentials. */
export async function authorize(req: MediaAuthRequest): Promise<boolean> {
  const internal = req.user === INTERNAL_USER && !!req.password && safeEqual(req.password, internalPassword());
  if (req.action !== "publish") return internal;
  // the composed output: only the API itself may publish it
  if (OUT_PATH_RE.test(req.path ?? "")) return internal;

  const m = PATH_RE.exec(req.path ?? "");
  if (!m) return false;
  const token = new URLSearchParams(req.query ?? "").get("token") ?? "";
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!sig || !Number.isFinite(exp) || exp < Date.now()) return false;
  const device = await prisma.device.findUnique({ where: { id: m[1]! }, select: { id: true, keyHash: true, manager: { select: { isActive: true } } } });
  if (!device || !device.manager.isActive) return false;
  return safeEqual(sig, sign(device.id, device.keyHash, exp));
}

/** GET a file of an HLS stream from MediaMTX — the phone's raw video or (output) the composed broadcast. Null when unreachable. */
export async function fetchHls(deviceId: string, file: string, search: string, output = false): Promise<Response | null> {
  try {
    return await fetch(`${env.MEDIA_HLS_URL}/${output ? outputPath(deviceId) : devicePath(deviceId)}/${file}${search}`, {
      headers: { Authorization: internalAuthHeader() },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "mediamtx unreachable (hls)");
    return null;
  }
}

/** Is MediaMTX receiving this device's video (or, `output`, its composed broadcast)? `readySince` = when it started; null = no. */
export async function deviceStreamReady(deviceId: string, output = false): Promise<{ readySince: Date } | null> {
  try {
    const res = await fetch(`${env.MEDIA_API_URL}/v3/paths/get/${encodeURIComponent(output ? outputPath(deviceId) : devicePath(deviceId))}`, {
      headers: { Authorization: internalAuthHeader() },
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

/** Disconnect a device's publisher (its key changed or it was removed). Best effort. */
export async function kickDevice(deviceId: string): Promise<void> {
  const headers = { Authorization: internalAuthHeader() };
  try {
    const res = await fetch(`${env.MEDIA_API_URL}/v3/rtmpconns/list?itemsPerPage=1000`, { headers, signal: AbortSignal.timeout(3_000) });
    if (!res.ok) return;
    const { items = [] } = (await res.json()) as { items?: { id: string; path: string }[] };
    const path = devicePath(deviceId);
    await Promise.all(
      items.filter((c) => c.path === path).map((c) => fetch(`${env.MEDIA_API_URL}/v3/rtmpconns/kick/${c.id}`, { method: "POST", headers, signal: AbortSignal.timeout(3_000) })),
    );
  } catch (err) {
    logger.warn({ err: (err as Error).message, deviceId }, "mediamtx kick failed");
  }
}
