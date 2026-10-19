/**
 * Phase 6b routes: broadcast output (layout, sponsors, destinations, per-device output). Mounted on the manager router.
 */
import { Readable } from "node:stream";
import type { Response } from "express";
import { Router } from "express";
import { z } from "zod";
import {
  setDeviceMatchSchema,
  startOutputSchema,
  streamDestinationSchema,
  streamDestinationUpdateSchema,
  streamLayoutSchema,
} from "@7xen/shared";
import { conflict, notFound } from "../lib/errors.js";
import { parseMultipart, singleImage } from "../lib/upload.js";
import { parse } from "../lib/validate.js";
import { currentUser } from "../middleware/requireAuth.js";
import * as devices from "../services/devices.js";
import * as media from "../services/media.js";
import { outputInfo, startOutput, stopOutput } from "../services/broadcast/compositor.js";
import { overlayDataForMatch, sampleOverlayData } from "../services/broadcast/data.js";
import * as layout from "../services/broadcast/layout.js";
import { renderOverlay } from "../services/broadcast/render.js";
import { loadOwnMatch } from "../services/matches.js";

const p = (v: unknown) => v as string;
const HLS_FILE_RE = /^[A-Za-z0-9_.-]{1,80}\.(m3u8|mp4|m4s|ts)$/;
const overlayCache = new Map<string, { at: number; png: Buffer }>();
const previewSchema = z.object({ config: streamLayoutSchema, matchId: z.string().min(1).nullish(), deviceId: z.string().min(1).nullish() });

export async function pipeUpstream(res: Response, upstream: globalThis.Response, file: string) {
  res.status(upstream.status);
  res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "application/octet-stream");
  res.setHeader("Cache-Control", file.endsWith(".m3u8") ? "no-store" : "private, max-age=60");
  res.setHeader("X-Content-Type-Options", "nosniff");
  await new Promise<void>((resolve) => {
    const body = Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream);
    body.on("error", () => resolve());
    res.on("close", () => {
      body.destroy();
      resolve();
    });
    body.pipe(res);
  });
}

export function mountBroadcast(r: Router) {
  // ---- layout
  r.get("/stream/layout", async (req, res) => {
    res.json(await layout.getLayout(currentUser(req).id));
  });
  r.put("/stream/layout", async (req, res) => {
    res.json(await layout.saveLayout(currentUser(req).id, parse(streamLayoutSchema, req.body)));
  });
  r.post("/stream/sponsors", async (req, res) => {
    await parseMultipart(req, res);
    const img = singleImage(req);
    res.status(201).json(await layout.addSponsor(currentUser(req).id, img));
  });
  r.delete("/stream/sponsors/:id", async (req, res) => {
    await layout.removeSponsor(currentUser(req).id, p(req.params.id));
    res.status(204).end();
  });

  // live preview of an (unsaved) layout: PNG overlay with the chosen match's data, or sample data
  r.post("/stream/preview", async (req, res) => {
    const me = currentUser(req).id;
    const { config, matchId, deviceId } = parse(previewSchema, req.body);
    let mid = matchId ?? null;
    if (!mid && deviceId) mid = (await devices.getDevice(deviceId, me)).match?.id ?? null;
    if (mid) await loadOwnMatch(mid, me);
    const data = mid ? await overlayDataForMatch(mid, me) : await sampleOverlayData(me);
    const { sponsors } = await layout.loadLayout(me);
    const png = await renderOverlay(config, data, { sponsorPaths: layout.sponsorPaths(config, sponsors), liveSince: new Date(Date.now() - 754_000) });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.end(png);
  });

  // the device's layout as a transparent PNG (saved layout + its match + LIVE timer), for drawing over the live video.
  // Rendered at most about once a second per device, however many viewers poll it.
  r.get("/devices/:id/overlay.png", async (req, res) => {
    const me = currentUser(req).id;
    const id = p(req.params.id);
    const d = await devices.getDevice(id, me);
    const key = `${id}:${d.match?.id ?? "-"}`;
    let hit = overlayCache.get(key);
    if (!hit || Date.now() - hit.at > 900) {
      const l = await layout.loadLayout(me);
      const data = d.match ? await overlayDataForMatch(d.match.id, me) : await sampleOverlayData(me);
      const png = await renderOverlay(l.config, data, { sponsorPaths: layout.sponsorPaths(l.config, l.sponsors), liveSince: d.streamingSince ? new Date(d.streamingSince) : null });
      hit = { at: Date.now(), png };
      overlayCache.set(key, hit);
      if (overlayCache.size > 100) overlayCache.clear();
    }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.end(hit.png);
  });

  // ---- destinations
  r.get("/stream/destinations", async (req, res) => {
    res.json({ items: await layout.listDestinations(currentUser(req).id) });
  });
  r.post("/stream/destinations", async (req, res) => {
    res.status(201).json(await layout.createDestination(currentUser(req).id, parse(streamDestinationSchema, req.body)));
  });
  r.patch("/stream/destinations/:id", async (req, res) => {
    res.json(await layout.updateDestination(currentUser(req).id, p(req.params.id), parse(streamDestinationUpdateSchema, req.body)));
  });
  r.delete("/stream/destinations/:id", async (req, res) => {
    await layout.deleteDestination(currentUser(req).id, p(req.params.id));
    res.status(204).end();
  });

  // ---- per device
  r.put("/devices/:id/match", async (req, res) => {
    const { matchId } = parse(setDeviceMatchSchema, req.body);
    res.json(await devices.setDeviceMatch(p(req.params.id), currentUser(req).id, matchId));
  });
  r.get("/devices/:id/output", async (req, res) => {
    await devices.assertOwnDevice(p(req.params.id), currentUser(req).id);
    res.setHeader("Cache-Control", "no-store");
    res.json(await outputInfo(p(req.params.id)));
  });
  r.post("/devices/:id/output/start", async (req, res) => {
    const me = currentUser(req).id;
    const id = p(req.params.id);
    const { destinationIds } = parse(startOutputSchema, req.body ?? {});
    const d = await devices.getDevice(id, me);
    if (!d.videoReady) throw conflict("The phone isn't sending video yet. Start streaming on the phone first.");
    const known = new Set((await layout.listDestinations(me)).map((x) => x.id));
    await startOutput(id, me, destinationIds.filter((x) => known.has(x)));
    res.json(await outputInfo(id));
  });
  r.post("/devices/:id/output/stop", async (req, res) => {
    await devices.assertOwnDevice(p(req.params.id), currentUser(req).id);
    await stopOutput(p(req.params.id));
    res.json(await outputInfo(p(req.params.id)));
  });
  r.get("/devices/:id/output/live/:file", async (req, res) => {
    const id = p(req.params.id);
    const file = p(req.params.file);
    if (!HLS_FILE_RE.test(file)) throw notFound("Not found");
    await devices.assertOwnDevice(id, currentUser(req).id);
    const search = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
    const upstream = await media.fetchHls(id, file, search, true);
    if (!upstream || !upstream.ok || !upstream.body) throw notFound("The broadcast output isn't running");
    await pipeUpstream(res, upstream, file);
  });
}
