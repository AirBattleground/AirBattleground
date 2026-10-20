/**
 * Phase 7b: the site YouTube channel (shared/youtube.ts). The admin connects one channel with Google OAuth; while
 * autoStream is on, every broadcast output showing a match gets its own YouTube live broadcast (created here, relayed
 * by the compositor like any other destination). AppSetting "youtube" holds the encrypted refresh token + settings.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  DEFAULT_YOUTUBE_TITLE,
  MAP_LABELS,
  YOUTUBE_PRIVACY,
  youtubeTitle,
  type GameMap,
  type UpdateYoutubeInput,
  type YoutubePrivacy,
  type YoutubeStatus,
} from "@7xen/shared";
import { env } from "../env.js";
import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { AppError, conflict } from "../lib/errors.js";
import { decryptSecret, encryptSecret } from "../lib/secretBox.js";
import { matchContext } from "./matchContext.js";
import { ownerInclude, ownerManagerId } from "./matches.js";

const KEY = "youtube";
const SCOPE = "https://www.googleapis.com/auth/youtube";
const API = "https://www.googleapis.com/youtube/v3";
const STATE_TTL_MS = 10 * 60_000;

interface Stored {
  refreshTokenEnc: string | null;
  channel: YoutubeStatus["channel"];
  connectedAt: string | null;
  autoStream: boolean;
  privacy: YoutubePrivacy;
  titleTemplate: string;
  lastError: string | null;
}

const DEFAULTS: Stored = { refreshTokenEnc: null, channel: null, connectedAt: null, autoStream: true, privacy: "public", titleTemplate: DEFAULT_YOUTUBE_TITLE, lastError: null };

async function load(): Promise<Stored> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
  const v = (row?.value ?? {}) as Partial<Stored>;
  return {
    ...DEFAULTS,
    ...v,
    privacy: (YOUTUBE_PRIVACY as readonly string[]).includes(v.privacy ?? "") ? (v.privacy as YoutubePrivacy) : DEFAULTS.privacy,
  };
}

async function save(patch: Partial<Stored>): Promise<Stored> {
  const next = { ...(await load()), ...patch };
  const value = next as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  return next;
}

export const publicUrl = () => env.PUBLIC_URL ?? env.CORS_ORIGINS[0] ?? "http://localhost:5173";
export const redirectUri = () => `${publicUrl()}/api/admin/youtube/callback`;
const configured = () => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

const SAMPLE = { org: "Opus Esports", event: "Evening Scrims", details: "Sat, 18 Oct · Match 2", map: "Erangel" };

function toStatus(s: Stored): YoutubeStatus {
  return {
    configured: configured(),
    redirectUri: redirectUri(),
    connected: !!s.refreshTokenEnc && !!s.channel,
    channel: s.refreshTokenEnc ? s.channel : null,
    connectedAt: s.refreshTokenEnc ? s.connectedAt : null,
    autoStream: s.autoStream,
    privacy: s.privacy,
    titleTemplate: s.titleTemplate,
    titlePreview: youtubeTitle(s.titleTemplate, SAMPLE),
    lastError: s.lastError,
  };
}

export async function getYoutubeStatus(): Promise<YoutubeStatus> {
  return toStatus(await load());
}

export async function updateYoutube(input: UpdateYoutubeInput): Promise<YoutubeStatus> {
  return toStatus(await save({ ...input }));
}

// ---------------------------------------------------------------- OAuth

const sign = (payload: string) => createHmac("sha256", `7xen-youtube-state:${env.JWT_SECRET}`).update(payload).digest("base64url");

/** Google consent URL for the signed-in admin. */
export function connectUrl(adminId: string): string {
  if (!configured()) throw conflict("YouTube isn't set up on the server yet: add GOOGLE_CLIENT_SECRET (and PUBLIC_URL), then restart.");
  const payload = `${adminId}.${Date.now() + STATE_TTL_MS}.${randomBytes(8).toString("base64url")}`;
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: `${payload}.${sign(payload)}`,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

function checkState(state: string, adminId: string) {
  const i = state.lastIndexOf(".");
  const payload = state.slice(0, i);
  const sig = Buffer.from(state.slice(i + 1));
  const want = Buffer.from(sign(payload));
  const [uid, exp] = payload.split(".");
  if (sig.length !== want.length || !timingSafeEqual(sig, want) || uid !== adminId || Number(exp) < Date.now()) {
    throw new AppError("VALIDATION_ERROR", "That sign-in link expired. Press Connect YouTube again.");
  }
}

async function tokenRequest(body: Record<string, string>): Promise<{ access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, ...body }),
  });
  return (await res.json()) as never;
}

/** OAuth redirect: store the channel. */
export async function finishConnect(code: string, state: string, adminId: string): Promise<void> {
  checkState(state, adminId);
  const tok = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });
  if (!tok.access_token) throw new AppError("VALIDATION_ERROR", `Google didn't accept the sign-in (${tok.error_description ?? tok.error ?? "unknown error"}).`);
  if (!tok.refresh_token) throw new AppError("VALIDATION_ERROR", "Google didn't give long-term access. Remove AirBattleground from your Google account's third-party access, then connect again.");
  cached = { token: tok.access_token, until: Date.now() + (tok.expires_in ?? 3600) * 1000 - 60_000 };
  const ch = await yt<{ items?: { id: string; snippet: { title: string; customUrl?: string; thumbnails?: { default?: { url: string } } } }[] }>("GET", "/channels?part=snippet&mine=true");
  const c = ch.items?.[0];
  if (!c) throw new AppError("VALIDATION_ERROR", "This Google account has no YouTube channel. Create one on YouTube first, or pick another account.");
  await save({
    refreshTokenEnc: encryptSecret(tok.refresh_token),
    channel: {
      id: c.id,
      title: c.snippet.title,
      thumbnailUrl: c.snippet.thumbnails?.default?.url ?? null,
      url: c.snippet.customUrl ? `https://www.youtube.com/${c.snippet.customUrl}` : `https://www.youtube.com/channel/${c.id}`,
    },
    connectedAt: new Date().toISOString(),
    lastError: null,
  });
}

export async function disconnectYoutube(): Promise<YoutubeStatus> {
  const s = await load();
  if (s.refreshTokenEnc) {
    // best effort: also remove the grant on Google's side
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decryptSecret(s.refreshTokenEnc))}`, { method: "POST" }).catch(() => undefined);
  }
  cached = null;
  return toStatus(await save({ refreshTokenEnc: null, channel: null, connectedAt: null, lastError: null }));
}

let cached: { token: string; until: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.token;
  const s = await load();
  if (!s.refreshTokenEnc) throw new YoutubeError("The YouTube channel isn't connected.");
  const tok = await tokenRequest({ refresh_token: decryptSecret(s.refreshTokenEnc), grant_type: "refresh_token" });
  if (!tok.access_token) {
    const msg =
      tok.error === "invalid_grant"
        ? "YouTube access was removed or expired. Connect the channel again in the admin console."
        : `Couldn't reach YouTube (${tok.error_description ?? tok.error ?? "unknown error"}).`;
    throw new YoutubeError(msg);
  }
  cached = { token: tok.access_token, until: Date.now() + (tok.expires_in ?? 3600) * 1000 - 60_000 };
  return cached.token;
}

class YoutubeError extends Error {}

const REASONS: Record<string, string> = {
  liveStreamingNotEnabled: "Live streaming isn't turned on for the channel. Turn it on in YouTube Studio (the first time takes up to 24 hours).",
  quotaExceeded: "YouTube's daily limit for this app is used up. Streams to YouTube resume tomorrow.",
  insufficientLivePermissions: "This channel isn't allowed to live stream yet. Check it in YouTube Studio.",
  userRequestsExceedRateLimit: "YouTube is busy. Trying again shortly.",
};

async function yt<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } };
  if (!res.ok) {
    const reason = json.error?.errors?.[0]?.reason ?? "";
    if (res.status === 401) cached = null;
    throw new YoutubeError(REASONS[reason] ?? `YouTube said: ${json.error?.message ?? res.statusText}`);
  }
  return json as T;
}

// ---------------------------------------------------------------- match broadcasts

export interface MatchBroadcast {
  broadcastId: string;
  title: string;
  watchUrl: string;
  /** rtmp(s)://…/<stream name> for the relay */
  target: string;
}

/** Title + description for a match, from its scrim/tournament and organiser. */
async function describe(matchId: string): Promise<{ title: string; description: string } | null> {
  const m = await prisma.match.findUnique({ where: { id: matchId }, include: ownerInclude });
  if (!m) return null;
  const ctx = matchContext(m);
  const managerId = ownerManagerId(m);
  const mgr = managerId ? await prisma.user.findUnique({ where: { id: managerId }, select: { orgName: true, displayName: true } }) : null;
  const org = mgr?.orgName?.trim() || mgr?.displayName || "AirBattleground";
  const map = MAP_LABELS[m.map as GameMap] ?? m.map;
  const s = await load();
  const title = youtubeTitle(s.titleTemplate, { org, event: ctx.title, details: ctx.subtitle, map });
  const description = [
    `${ctx.title} — ${ctx.subtitle}`,
    `Map: ${map}`,
    `Organised by ${org}`,
    `Slots #${ctx.slotRange.first}–#${ctx.slotRange.last}`,
    "",
    `Live standings and results on AirBattleground: ${publicUrl()}`,
  ].join("\n");
  return { title, description };
}

/**
 * Create this match's YouTube broadcast + stream (auto start/stop) when the channel is connected and autoStream is on.
 * null = not streaming to YouTube; throws YoutubeError with a plain message when YouTube refuses.
 */
export async function startMatchBroadcast(matchId: string): Promise<MatchBroadcast | null> {
  const s = await load();
  if (!s.refreshTokenEnc || !s.autoStream) return null;
  const d = await describe(matchId);
  if (!d) return null;
  return startBroadcast(d);
}

/** Phase 8 (Studio): a broadcast for a show — the match's title when it has one, else the show's own title. */
export async function startShowBroadcast(show: { title: string; matchId: string | null }): Promise<MatchBroadcast | null> {
  const s = await load();
  if (!s.refreshTokenEnc || !s.autoStream) return null;
  const d = (show.matchId ? await describe(show.matchId) : null) ?? {
    title: youtubeTitle(s.titleTemplate, { org: "AirBattleground", event: show.title, details: "Live", map: "" }),
    description: `${show.title}\n\nLive on AirBattleground: ${publicUrl()}`,
  };
  return startBroadcast(d);
}

async function startBroadcast(d: { title: string; description: string }): Promise<MatchBroadcast> {
  const s = await load();
  try {
    const b = await yt<{ id: string }>("POST", "/liveBroadcasts?part=snippet,status,contentDetails", {
      snippet: { title: d.title, description: d.description.slice(0, 5000), scheduledStartTime: new Date().toISOString() },
      status: { privacyStatus: s.privacy, selfDeclaredMadeForKids: false },
      contentDetails: { enableAutoStart: true, enableAutoStop: true, latencyPreference: "low" },
    });
    const st = await yt<{ id: string; cdn: { ingestionInfo: { ingestionAddress: string; streamName: string } } }>(
      "POST",
      "/liveStreams?part=snippet,cdn,contentDetails",
      { snippet: { title: d.title }, cdn: { ingestionType: "rtmp", resolution: "variable", frameRate: "variable" }, contentDetails: { isReusable: false } },
    );
    await yt("POST", `/liveBroadcasts/bind?id=${encodeURIComponent(b.id)}&part=id,contentDetails&streamId=${encodeURIComponent(st.id)}`);
    if (s.lastError) await save({ lastError: null });
    const { ingestionAddress, streamName } = st.cdn.ingestionInfo;
    return { broadcastId: b.id, title: d.title, watchUrl: `https://youtu.be/${b.id}`, target: `${ingestionAddress.replace(/\/+$/, "")}/${streamName}` };
  } catch (err) {
    const msg = err instanceof YoutubeError ? err.message : "Couldn't reach YouTube.";
    logger.warn({ err: (err as Error).message, title: d.title }, "youtube broadcast create failed");
    await save({ lastError: msg });
    throw new YoutubeError(msg);
  }
}

/** End a match broadcast (best effort — with auto-stop YouTube also ends it when video stops). */
export async function endMatchBroadcast(broadcastId: string): Promise<void> {
  await yt("POST", `/liveBroadcasts/transition?broadcastStatus=complete&id=${encodeURIComponent(broadcastId)}&part=status`).catch((err: Error) =>
    logger.info({ err: err.message, broadcastId }, "youtube transition to complete skipped"),
  );
}

export { YoutubeError };
