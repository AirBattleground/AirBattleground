/**
 * Phase 4b routes: AirBattleground Station.
 *   mountStation(r, bypass)   manager (own matches) + admin mirror (any match): status, prepare, stop, capture, input, live
 *   liveRouter()              GET /api/live/:matchId/index.m3u8 | <segment>.ts  (manager owner, admin, teams in the match)
 *                             GET /api/live · /:matchId/overlay.png · /:matchId/d/<hls> — iPhone broadcasts, PUBLIC (no sign-in)
 *   internalStationRouter()   station → API hooks (X-Station-Token)
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Router, type NextFunction, type Request, type Response } from "express";
import {
  ADMIN_COOKIE,
  APP_COOKIE,
  SCREENSHOT_KINDS,
  STATION_TOKEN_HEADER,
  stationCaptureSchema,
  stationCompleteSchema,
  stationDeviceStartSchema,
  stationDeviceStopSchema,
  stationFailSchema,
  stationInputSchema,
  stationPrepareInputSchema,
} from "@7xen/shared";
import { z } from "zod";
import { prisma } from "../db.js";
import { bearerToken, verifyToken } from "../lib/auth.js";
import { AppError, notFound } from "../lib/errors.js";
import { stationTokenMatches } from "../lib/stationClient.js";
import { parseMultipart, uploadedImages } from "../lib/upload.js";
import { parse } from "../lib/validate.js";
import { currentUser } from "../middleware/requireAuth.js";
import * as station from "../services/station.js";
import { broadcastingDevice } from "../services/devices.js";
import { fetchHls, fetchHlsPath, showPath } from "../services/media.js";
import { liveBroadcasts, matchOverlayPng } from "../services/broadcast/viewer.js";
import { pipeUpstream } from "./broadcast.js";
import * as studio from "../services/studio.js";
import { channelFeed } from "../services/youtube.js";

const p = (v: unknown) => v as string;

export function mountStation(r: Router, bypass: boolean) {
  r.get("/station", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await station.stationStatus());
  });
  r.get("/matches/:matchId/live", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await station.getMatchLive(p(req.params.matchId), currentUser(req).id, bypass));
  });
  r.post("/matches/:matchId/station/prepare", async (req, res) => {
    const body = parse(stationPrepareInputSchema, req.body ?? {});
    res.json(await station.prepare(p(req.params.matchId), currentUser(req).id, body, bypass));
  });
  r.post("/matches/:matchId/station/stop", async (req, res) => {
    res.json(await station.stop(p(req.params.matchId), currentUser(req).id, bypass));
  });
  r.post("/matches/:matchId/station/device/start", async (req, res) => {
    const body = parse(stationDeviceStartSchema, req.body ?? {});
    res.json(await station.deviceStart(p(req.params.matchId), currentUser(req).id, body, bypass));
  });
  r.post("/matches/:matchId/station/device/stop", async (req, res) => {
    const body = parse(stationDeviceStopSchema, req.body ?? {});
    res.json(await station.deviceStop(p(req.params.matchId), currentUser(req).id, body, bypass));
  });
  r.post("/matches/:matchId/station/capture", async (req, res) => {
    const { kind } = parse(stationCaptureSchema, req.body);
    res.status(201).json(await station.capture(p(req.params.matchId), currentUser(req).id, kind, bypass));
  });
  r.post("/matches/:matchId/station/input", async (req, res) => {
    await station.input(p(req.params.matchId), currentUser(req).id, parse(stationInputSchema, req.body), bypass);
    res.status(204).end();
  });
}

// ---------------------------------------------------------------- HLS for viewers

/** ok: may watch; null: not a usable session; "missing": no such match */
type Decision = { at: number; ok: boolean | null | "missing" };
const decisions = new Map<string, Decision>();
const DECISION_TTL_MS = 10_000;

/** Every session token the request carries: the manager app's bearer, the portal cookie, the admin cookie. */
function candidateTokens(req: Request): string[] {
  const out: string[] = [];
  const b = bearerToken(req.headers.authorization);
  if (b) out.push(b);
  for (const name of [APP_COOKIE, ADMIN_COOKIE]) {
    const c = req.cookies?.[name] as string | undefined;
    if (c) out.push(c);
  }
  return out;
}

/** Signed-in user ids on this request (no DB read) — lets a manager watch their own private Studio show. */
const sessionUserIds = (req: Request): string[] =>
  candidateTokens(req)
    .map(verifyToken)
    .filter((x): x is NonNullable<typeof x> => !!x)
    .map((x) => x.sub);

/** 401 without a valid session, 403 when none of the sessions may watch, 404 when there's no stream. */
async function requireViewer(req: Request, _res: Response, next: NextFunction) {
  const matchId = p(req.params.matchId);
  if (!station.MATCH_ID_RE.test(matchId)) throw notFound("Not found");
  const payloads = candidateTokens(req)
    .map(verifyToken)
    .filter((x): x is NonNullable<typeof x> => !!x);
  if (!payloads.length) throw new AppError("UNAUTHENTICATED", "Please log in to watch this match");

  let anyUser = false;
  for (const pl of payloads) {
    const key = `${pl.sub}:${pl.role}:${matchId}`;
    let d = decisions.get(key);
    if (!d || Date.now() - d.at > DECISION_TTL_MS) {
      const user = await prisma.user.findUnique({ where: { id: pl.sub }, include: { membership: { select: { teamId: true } } } });
      let ok: Decision["ok"] = false;
      if (user && user.isActive && user.role === pl.role) {
        ok = (await station.mayWatch({ id: user.id, role: user.role, teamId: user.membership?.teamId ?? null }, matchId)) ?? "missing";
      } else {
        ok = null; // not a usable session
      }
      d = { at: Date.now(), ok };
      decisions.set(key, d);
      if (decisions.size > 5000) decisions.clear();
    }
    if (d.ok === true) return next();
    if (d.ok === "missing") throw notFound("Not found");
    if (d.ok === false) anyUser = true;
  }
  if (!anyUser) throw new AppError("UNAUTHENTICATED", "Please log in to watch this match");
  throw new AppError("FORBIDDEN", "Only the teams in this match can watch it");
}

const streamCache = new Map<string, { at: number; ok: boolean }>();
async function requireStream(matchId: string) {
  let c = streamCache.get(matchId);
  if (!c || Date.now() - c.at > 3000) {
    c = { at: Date.now(), ok: await station.streamAvailable(matchId) };
    streamCache.set(matchId, c);
    if (streamCache.size > 1000) streamCache.clear();
  }
  if (!c.ok) throw notFound("This match isn't being streamed");
}

async function sendLive(req: Request, res: Response, name: string) {
  const matchId = p(req.params.matchId);
  await requireStream(matchId);
  const abs = station.liveFile(matchId, name);
  let size: number;
  try {
    const st = await stat(abs);
    if (!st.isFile()) throw new Error("not a file");
    size = st.size;
  } catch {
    throw notFound(name === "index.m3u8" ? "The stream is starting. Try again in a few seconds." : "Segment not found");
  }
  const playlist = name.endsWith(".m3u8");
  res.setHeader("Content-Type", playlist ? "application/vnd.apple.mpegurl" : "video/mp2t");
  res.setHeader("Cache-Control", playlist ? "no-store" : "private, max-age=60");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Length", String(size));
  if (req.method === "HEAD") return void res.end();
  await new Promise<void>((resolve) => {
    const s = createReadStream(abs);
    s.on("error", () => {
      if (!res.headersSent) res.status(404);
      res.end();
      resolve();
    });
    res.on("close", () => {
      s.destroy();
      resolve();
    });
    s.pipe(res);
  });
}

export function liveRouter() {
  const r = Router();
  // phase 6c/6d/7: iPhone broadcasts (the manager pressed "Start broadcast" in the match center) are PUBLIC — anyone,
  // signed in or not, can list and watch them (web /watch). Station recordings below stay limited to their viewers.
  r.get("/", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    // phase 8: only Studio shows are broadcast (single-phone broadcasts were retired to save server CPU);
    // a signed-in manager also gets their own private (unlisted) show so "Open viewer" works for a test stream
    res.json({ items: await studio.liveShows(sessionUserIds(req)[0] ?? null) });
  });
  // the site YouTube channel's stats, streams and uploads for the Live page (public; cached in the service)
  r.get("/channel", async (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json(await channelFeed());
  });
  // phase 8: a live Studio show's HLS (public)
  r.get("/s/:showId/:file", async (req, res) => {
    const showId = p(req.params.showId);
    const file = p(req.params.file);
    if (!/^[A-Za-z0-9_.-]{1,80}\.(m3u8|mp4|m4s|ts)$/.test(file)) throw notFound("Not found");
    const owner = studio.liveShowOwner(showId);
    if (!(await studio.showIsLive(showId)) && !(owner && sessionUserIds(req).includes(owner))) throw notFound("This show isn't live");
    const search = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
    const upstream = await fetchHlsPath(showPath(showId), file, search);
    if (!upstream || !upstream.ok || !upstream.body) throw notFound("The stream is starting. Try again in a few seconds.");
    await pipeUpstream(res, upstream, file);
  });
  r.get("/:matchId/overlay.png", async (req, res) => {
    const png = await matchOverlayPng(p(req.params.matchId));
    if (!png) throw notFound("This match isn't being broadcast");
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.end(png);
  });
  r.get("/:matchId/d/:file", async (req, res) => {
    const file = p(req.params.file);
    if (!/^[A-Za-z0-9_.-]{1,80}\.(m3u8|mp4|m4s|ts)$/.test(file)) throw notFound("Not found");
    const d = await broadcastingDevice(p(req.params.matchId));
    if (!d) throw notFound("This match isn't being broadcast");
    const search = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
    const upstream = await fetchHls(d.id, file, search);
    if (!upstream || !upstream.ok || !upstream.body) throw notFound("The stream is starting. Try again in a few seconds.");
    await pipeUpstream(res, upstream, file);
  });
  r.get("/:matchId/index.m3u8", requireViewer, async (req, res) => {
    await sendLive(req, res, "index.m3u8");
  });
  r.get("/:matchId/:segment", requireViewer, async (req, res) => {
    const seg = p(req.params.segment);
    if (!seg.endsWith(".ts")) throw notFound("Not found");
    await sendLive(req, res, seg);
  });
  return r;
}

/** Testing hook: forget cached access decisions. */
export function resetLiveCaches() {
  decisions.clear();
  streamCache.clear();
}

// ---------------------------------------------------------------- internal hooks

const kindSchema = z.object({ kind: z.enum(SCREENSHOT_KINDS, { errorMap: () => ({ message: "kind must be SLOT_LIST or RESULTS" }) }) });

export function internalStationRouter() {
  const r = Router();
  r.use((req, _res, next) => {
    if (!stationTokenMatches(req.header(STATION_TOKEN_HEADER))) throw new AppError("UNAUTHENTICATED", "Missing or wrong station token");
    next();
  });
  r.post("/recordings/:id/complete", async (req, res) => {
    await station.completeHook(p(req.params.id), parse(stationCompleteSchema, req.body));
    res.status(204).end();
  });
  r.post("/recordings/:id/fail", async (req, res) => {
    await station.failHook(p(req.params.id), parse(stationFailSchema, req.body));
    res.status(204).end();
  });
  r.post("/matches/:matchId/screenshots", async (req, res) => {
    await parseMultipart(req, res);
    const { kind } = parse(kindSchema, req.body);
    const images = uploadedImages(req, ["files", "files[]", "file"]);
    if (!images.length) throw new AppError("VALIDATION_ERROR", "Send at least one screenshot");
    res.status(201).json(await station.screenshotsHook(p(req.params.matchId), kind, images));
  });
  return r;
}
