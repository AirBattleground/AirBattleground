/**
 * Phase 6 routes: streaming devices.
 *   mountManagerDevices(r)   /api/manager/devices…  (manager session, own devices)
 *   deviceRouter()           /api/device/…          (the phone; X-Device-Key)
 *   internalMediaRouter()    /api/internal/media/…  (MediaMTX auth hook)
 */
import { Readable } from "node:stream";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { DEVICE_KEY_HEADER, deviceCaptureSchema, deviceHeartbeatSchema, deviceHelloSchema, deviceNameSchema, deviceStreamStartSchema, deviceStreamStopSchema } from "@7xen/shared";
import { isTest } from "../env.js";
import { AppError, notFound } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { currentUser } from "../middleware/requireAuth.js";
import * as devices from "../services/devices.js";
import * as media from "../services/media.js";
import { captureFromDevice, fulfilSnapshot } from "../services/deviceCapture.js";
import { parseMultipart, uploadedImages } from "../lib/upload.js";

const p = (v: unknown) => v as string;
const HLS_FILE_RE = /^[A-Za-z0-9_.-]{1,80}\.(m3u8|mp4|m4s|ts)$/;

export function mountManagerDevices(r: Router) {
  r.get("/devices", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ items: await devices.listDevices(currentUser(req).id) });
  });
  r.post("/devices", async (req, res) => {
    const { name } = parse(deviceNameSchema, req.body);
    res.status(201).json(await devices.createDevice(currentUser(req).id, name));
  });
  r.get("/devices/:id", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await devices.getDevice(p(req.params.id), currentUser(req).id));
  });
  // HLS proxy: playlists + fMP4 segments of the phone's stream, owner only
  r.get("/devices/:id/live/:file", async (req, res) => {
    const id = p(req.params.id);
    const file = p(req.params.file);
    if (!HLS_FILE_RE.test(file)) throw notFound("Not found");
    await devices.assertOwnDevice(id, currentUser(req).id);
    const search = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
    const upstream = await media.fetchHls(id, file, search);
    if (!upstream || !upstream.ok || !upstream.body) throw notFound("The phone isn't streaming right now");
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
  });
  r.post("/devices/:id/broadcast/start", async (req, res) => {
    res.json(await devices.startBroadcast(p(req.params.id), currentUser(req).id));
  });
  r.post("/devices/:id/broadcast/stop", async (req, res) => {
    res.json(await devices.stopBroadcast(p(req.params.id), currentUser(req).id));
  });
  r.post("/devices/:id/capture", async (req, res) => {
    const me = currentUser(req).id;
    const id = p(req.params.id);
    const { matchId, kind } = parse(deviceCaptureSchema, req.body);
    await devices.assertOwnDevice(id, me);
    res.status(201).json(await captureFromDevice(id, me, matchId, kind));
  });
  r.patch("/devices/:id", async (req, res) => {
    const { name } = parse(deviceNameSchema, req.body);
    res.json(await devices.renameDevice(p(req.params.id), currentUser(req).id, name));
  });
  r.get("/devices/:id/key", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await devices.getDeviceKey(p(req.params.id), currentUser(req).id));
  });
  r.post("/devices/:id/regenerate-key", async (req, res) => {
    res.json(await devices.regenerateKey(p(req.params.id), currentUser(req).id));
  });
  r.delete("/devices/:id", async (req, res) => {
    await devices.deleteDevice(p(req.params.id), currentUser(req).id);
    res.status(204).end();
  });
}

export function deviceRouter() {
  const r = Router();
  // a phone heartbeats every 2 s while live (30/min); allow headroom, stop key guessing
  r.use(
    rateLimit({
      windowMs: 60_000,
      limit: isTest ? 10_000 : 120,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      handler: (_req, res) => {
        res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many requests from this device. Wait a minute and try again." } });
      },
    }),
  );

  r.post("/hello", async (req, res) => {
    const device = await devices.deviceFromKey(req.get(DEVICE_KEY_HEADER));
    res.json(await devices.hello(device, parse(deviceHelloSchema, req.body ?? {})));
  });
  r.post("/heartbeat", async (req, res) => {
    const device = await devices.deviceFromKey(req.get(DEVICE_KEY_HEADER));
    res.json(await devices.heartbeat(device, parse(deviceHeartbeatSchema, req.body)));
  });
  // the phone answers a heartbeat's snapshotRequests with a full-quality PNG
  r.post("/snapshots/:requestId", async (req, res) => {
    const device = await devices.deviceFromKey(req.get(DEVICE_KEY_HEADER));
    await parseMultipart(req, res);
    const [img] = uploadedImages(req, ["image", "file"]);
    if (!img) throw new AppError("VALIDATION_ERROR", "Send the screenshot as the 'image' field", { image: "Required" });
    if (!fulfilSnapshot(device.id, p(req.params.requestId), img.buffer)) throw notFound("That capture request has expired");
    res.status(204).end();
  });
  r.post("/stream/start", async (req, res) => {
    const device = await devices.deviceFromKey(req.get(DEVICE_KEY_HEADER));
    res.json(await devices.streamStart(device, parse(deviceStreamStartSchema, req.body ?? {})));
  });
  r.post("/stream/stop", async (req, res) => {
    const device = await devices.deviceFromKey(req.get(DEVICE_KEY_HEADER));
    parse(deviceStreamStopSchema, req.body ?? {});
    await devices.streamStop(device);
    res.status(204).end();
  });
  return r;
}

/** MediaMTX → API: may this publish/read happen? 200 = yes, 401 = no. */
export function internalMediaRouter() {
  const r = Router();
  r.post("/auth", async (req, res) => {
    const ok = await media.authorize((req.body ?? {}) as media.MediaAuthRequest);
    res.status(ok ? 200 : 401).end();
  });
  return r;
}
