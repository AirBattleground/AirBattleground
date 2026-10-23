/** Studio link — a connected 7XEN Studio app (X-Studio-Key or X-Worker-Key = a Studio worker key; no cookies). Contract: shared/studioLink.ts. */
import { Router, type Request } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import {
  SCREENSHOT_KINDS,
  STUDIO_CAPTURE_KINDS,
  STUDIO_LINK_KEY_HEADER,
  liveCaptureFieldsSchema,
  studioLinkBroadcastSchema,
  studioLinkHeartbeatSchema,
} from "@7xen/shared";
import { isTest } from "../env.js";
import { AppError } from "../lib/errors.js";
import { parseMultipart, singleImage, uploadedImages } from "../lib/upload.js";
import { parse } from "../lib/validate.js";
import { acceptCapture, captureStatus, captureWait } from "../services/liveCapture.js";
import { boardForStudio } from "../services/liveStatus.js";
import * as link from "../services/studioLink.js";
import { workerByKey } from "../services/studioWorkers.js";
import { WORKER_KEY_HEADER } from "./studioWorker.js";

/** No kind (or AUTO / LIVE_STATUS): the server detects what it shows. SLOT_LIST / RESULTS: older studio builds. */
const kindSchema = z.object({
  kind: z
    .enum([...SCREENSHOT_KINDS, ...STUDIO_CAPTURE_KINDS], {
      errorMap: () => ({ message: "kind must be AUTO (or left out); SLOT_LIST and RESULTS are still accepted" }),
    })
    .default("AUTO"),
});

async function studioOf(req: Request) {
  const worker = await workerByKey(req.get(STUDIO_LINK_KEY_HEADER) ?? req.get(WORKER_KEY_HEADER));
  if (!worker) throw new AppError("UNAUTHENTICATED", "Unknown studio key");
  await link.touch(worker);
  return worker;
}

const p = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** If-None-Match values as bare versions: `42`, `"42"` and `W/"42"` all mean version 42. */
const ifNoneMatch = (h: string | undefined) => (h ?? "").split(",").map((t) => t.trim().replace(/^W\//, "").replace(/^"|"$/g, ""));

/** The Team Status board polls every ~3 s: at most 1 request/s per studio key. */
const livePollLimit = rateLimit({
  windowMs: 1_000,
  limit: isTest ? 10 : 1,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => `live:${req.get(STUDIO_LINK_KEY_HEADER) ?? req.get(WORKER_KEY_HEADER) ?? req.ip}`,
  handler: (_req, res) => {
    res.status(429).json({ error: { code: "RATE_LIMITED", message: "The studio is polling too fast. It will try again in a moment." } });
  },
});

export function studioLinkRouter() {
  const r = Router();
  r.use(
    rateLimit({
      windowMs: 60_000,
      // the studio polls /live (~3 s) and capture status (~1–2 s after a send) besides uploading and heartbeats
      limit: isTest ? 10_000 : 300,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      handler: (_req, res) => {
        res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many requests from this studio. Wait a minute and try again." } });
      },
    }),
  );
  r.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  r.get("/me", async (req, res) => {
    res.json(await link.me(await studioOf(req)));
  });
  r.get("/matches", async (req, res) => {
    res.json({ items: await link.matches(await studioOf(req)) });
  });
  r.get("/outputs", async (req, res) => {
    res.json(await link.outputs(await studioOf(req)));
  });
  r.post("/broadcasts", async (req, res) => {
    const worker = await studioOf(req);
    res.status(201).json(await link.startBroadcast(worker, parse(studioLinkBroadcastSchema, req.body ?? {})));
  });
  r.post("/broadcasts/:id/heartbeat", async (req, res) => {
    const worker = await studioOf(req);
    res.json(await link.heartbeat(worker, p(req.params.id), parse(studioLinkHeartbeatSchema, req.body ?? {})));
  });
  r.post("/broadcasts/:id/stop", async (req, res) => {
    await link.stopBroadcast(await studioOf(req), p(req.params.id));
    res.status(204).end();
  });
  r.get("/matches/:id/live", livePollLimit, async (req, res) => {
    const worker = await studioOf(req);
    const board = await boardForStudio(p(req.params.id), worker.managerId);
    res.setHeader("ETag", `"${board.version}"`);
    if (ifNoneMatch(req.get("If-None-Match")).includes(String(board.version))) {
      res.status(304).end();
      return;
    }
    res.json(board);
  });
  // the studio runs the match: Start (lineup confirmed, match live) and Stop (results next; the manager publishes)
  r.post("/matches/:id/start", async (req, res) => {
    res.json(await link.startMatch(await studioOf(req), p(req.params.id)));
  });
  r.post("/matches/:id/stop", async (req, res) => {
    res.json(await link.stopMatch(await studioOf(req), p(req.params.id)));
  });
  r.get("/matches/:id/captures/:captureId", async (req, res) => {
    res.json(await captureStatus(await studioOf(req), p(req.params.id), p(req.params.captureId)));
  });
  r.post("/matches/:id/screenshots", async (req, res) => {
    const worker = await studioOf(req);
    await parseMultipart(req, res);
    const { kind } = parse(kindSchema, req.body);
    if (kind === "AUTO" || kind === "LIVE_STATUS") {
      // one frame → queued; the reader decides whether it's the lobby, in-game or results
      const matchId = p(req.params.id);
      const fields = parse(liveCaptureFieldsSchema, req.body);
      const r = await acceptCapture(worker, matchId, fields, singleImage(req, "files"), () => captureWait(worker.id, matchId));
      if (r.status === 429) {
        res.setHeader("Retry-After", String(r.retryAfter));
        throw new AppError("RATE_LIMITED", "Screenshots are coming too fast for this match. Wait a moment and send again.");
      }
      res.status(r.status).json(r.body);
      return;
    }
    const images = uploadedImages(req, ["files", "files[]", "file"]);
    res.status(201).json(await link.screenshots(worker, p(req.params.id), kind, images));
  });
  return r;
}
