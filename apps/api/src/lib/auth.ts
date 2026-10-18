import type { Response } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "@7xen/shared";
import { env, isProd } from "../env.js";

interface JwtPayload {
  sub: string;
  role: Role;
}

const ttlSeconds = () => env.SESSION_TTL_DAYS * 24 * 60 * 60;

function signToken(payload: JwtPayload, expiresInSeconds = ttlSeconds()): string {
  return jwt.sign({ role: payload.role }, env.JWT_SECRET, { subject: payload.sub, expiresIn: expiresInSeconds });
}

/** Bearer token for the manager app: longer lived than the web session (MOBILE_TOKEN_TTL_DAYS). */
export function signMobileToken(payload: JwtPayload): { token: string; expiresAt: Date } {
  const seconds = env.MOBILE_TOKEN_TTL_DAYS * 24 * 60 * 60;
  return { token: signToken(payload, seconds), expiresAt: new Date(Date.now() + seconds * 1000) };
}

/** Token from an `Authorization: Bearer <token>` header, or null. */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return m ? m[1]! : null;
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (typeof decoded !== "object" || !decoded.sub || typeof decoded.role !== "string") return null;
    return { sub: decoded.sub, role: decoded.role as Role };
  } catch {
    return null;
  }
}

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: env.COOKIE_SECURE === undefined ? isProd : env.COOKIE_SECURE === "1" || env.COOKIE_SECURE === "true",
  path: "/",
});

export function setSessionCookie(res: Response, cookieName: string, payload: JwtPayload) {
  res.cookie(cookieName, signToken(payload), { ...cookieOptions(), maxAge: ttlSeconds() * 1000 });
}

export function clearSessionCookie(res: Response, cookieName: string) {
  res.clearCookie(cookieName, cookieOptions());
}
