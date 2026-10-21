/**
 * Phone publish tokens (live/dev_<id>?token=<exp>.<hmac>, tied to the device's key hash so removing a phone voids
 * them) and the box's internal media-server credentials. Everything is derived from the box secret.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const PUBLISH_TOKEN_TTL_MS = 10 * 60_000;
export const INTERNAL_USER = "box";

const derive = (secret: Buffer, purpose: string) => createHash("sha256").update(`7xen-box:${purpose}:`).update(secret).digest();

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export class Tokens {
  readonly internalPass: string;
  private readonly publishKey: Buffer;

  constructor(secret: Buffer) {
    this.internalPass = derive(secret, "internal").toString("hex").slice(0, 40);
    this.publishKey = derive(secret, "publish");
  }

  get internalAuthHeader() {
    return `Basic ${Buffer.from(`${INTERNAL_USER}:${this.internalPass}`).toString("base64")}`;
  }

  private sign(deviceId: string, keyHash: string, exp: number) {
    return createHmac("sha256", this.publishKey).update(`${deviceId}.${keyHash}.${exp}`).digest("base64url");
  }

  publishToken(deviceId: string, keyHash: string, now = Date.now()): { token: string; expiresAt: Date } {
    const exp = now + PUBLISH_TOKEN_TTL_MS;
    return { token: `${exp}.${this.sign(deviceId, keyHash, exp)}`, expiresAt: new Date(exp) };
  }

  verifyPublishToken(deviceId: string, keyHash: string, token: string, now = Date.now()): boolean {
    const [expStr, sig] = token.split(".");
    const exp = Number(expStr);
    if (!sig || !Number.isFinite(exp) || exp < now) return false;
    return safeEqual(sig, this.sign(deviceId, keyHash, exp));
  }

  isInternal(user: string | undefined, password: string | undefined): boolean {
    return user === INTERNAL_USER && !!password && safeEqual(password, this.internalPass);
  }
}
