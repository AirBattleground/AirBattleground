/** Token lifetime helpers (pure). The API issues a long-lived JWT with an ISO `expiresAt`. */
export interface StoredSession {
  token: string;
  expiresAt: string;
}

/** true when the token is missing, unparsable or expires within `skewMs`. */
export function isExpired(session: StoredSession | null, now = Date.now(), skewMs = 60_000): boolean {
  if (!session?.token) return true;
  const t = Date.parse(session.expiresAt);
  if (Number.isNaN(t)) return false; // unknown expiry → let the server decide
  return t - skewMs <= now;
}

/** Days left (rounded down), for "Signed in · expires in 12 days". */
export function daysLeft(session: StoredSession | null, now = Date.now()): number | null {
  if (!session) return null;
  const t = Date.parse(session.expiresAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((t - now) / 86_400_000));
}

export function parseStoredSession(raw: string | null): StoredSession | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof v.token !== "string" || !v.token) return null;
    return { token: v.token, expiresAt: typeof v.expiresAt === "string" ? v.expiresAt : "" };
  } catch {
    return null;
  }
}
