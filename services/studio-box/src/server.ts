/**
 * The box's HTTP server (one port, default 4300):
 *   /api/device/*         phone device API (phase-6 contract, served locally)
 *   /box/media/auth       MediaMTX auth hook (127.0.0.1 only)
 *   /box/worker-info      BoxPollInfo for the Studio worker on this PC (127.0.0.1 only)
 *   /box/info             BoxInfo (public: lets the web app detect it runs on a box)
 *   /box/devices…         Studio API (signed-in manager, checked against the website)
 *   /box/shows/:id/live/* the show's local copy on this box (preview; additive)
 *   /api/*                proxied to the website
 *   everything else       the web app build (SPA)
 */
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { z } from "zod";
import {
  DEVICE_KEY_HEADER,
  boxDeviceNameSchema,
  boxPairUrl,
  deviceHeartbeatSchema,
  deviceHelloSchema,
  deviceStreamStartSchema,
  deviceStreamStopSchema,
  type BoxInfo,
  type BoxPollInfo,
} from "@7xen/shared";
import type { ManagerAuth } from "./auth.js";
import type { Devices } from "./devices.js";
import { HttpError, isImage, multipartFile, notFound, parse, rateLimiter, readBody, readJson, remoteIp, sendError, sendJson } from "./http.js";
import { authorizeMedia, devicePath, isLoopback, type MediaAuthRequest, type MediaClient } from "./media.js";
import type { Store } from "./store.js";
import type { Tokens } from "./tokens.js";

const HLS_FILE_RE = /^[A-Za-z0-9_.-]{1,80}\.(m3u8|mp4|m4s|ts)$/;
const MAX_SNAPSHOT_BYTES = 15 * 1024 * 1024;

/** stream/start on the box also takes the frame rate the phone will send */
export const boxStreamStartSchema = deviceStreamStartSchema.extend({ fps: z.number().int().min(1).max(120).optional() });

export interface AppContext {
  boxName: string;
  lanUrl: string;
  store: Store;
  tokens: Tokens;
  devices: Devices;
  media: Pick<MediaClient, "fetchHlsPath">;
  auth: Pick<ManagerAuth, "require">;
  /** skip the manager check (BOX_DEV_NO_AUTH, never in production) */
  devNoAuth?: boolean;
  proxy: RequestListener;
  serveStatic: RequestListener;
}

const header = (req: IncomingMessage, name: string) => {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};

export function createApp(ctx: AppContext): RequestListener {
  const deviceLimit = rateLimiter(240, 60_000);

  async function workerInfo(): Promise<BoxPollInfo> {
    return { lanUrl: ctx.lanUrl, ...(await ctx.devices.counts()) };
  }

  async function deviceApi(req: IncomingMessage, res: ServerResponse, sub: string) {
    if (req.method !== "POST") throw notFound();
    if (!deviceLimit(remoteIp(req))) throw new HttpError(429, "RATE_LIMITED", "Too many requests from this device. Wait a minute and try again.");
    const dev = ctx.devices.fromKey(header(req, DEVICE_KEY_HEADER));
    const snap = /^snapshots\/([A-Za-z0-9-]{1,80})$/.exec(sub);
    if (snap) {
      const body = await readBody(req, MAX_SNAPSHOT_BYTES + 64 * 1024);
      const ct = header(req, "content-type");
      const img = /^multipart\/form-data/i.test(ct ?? "") ? multipartFile(body, ct, ["image", "file"]) : body;
      if (!img || !img.length) throw new HttpError(400, "VALIDATION_ERROR", "Send the screenshot as the 'image' field", { image: "Required" });
      if (!isImage(img)) throw new HttpError(400, "VALIDATION_ERROR", "Only PNG, JPEG or WebP images", { image: "Only PNG, JPEG or WebP images" });
      if (!ctx.devices.fulfilSnapshot(dev.id, snap[1]!, Buffer.from(img))) throw notFound("That capture request has expired");
      res.writeHead(204).end();
      return;
    }
    const body = await readJson(req);
    switch (sub) {
      case "hello":
        return sendJson(res, 200, ctx.devices.hello(dev, parse(deviceHelloSchema, body)));
      case "heartbeat":
        return sendJson(res, 200, ctx.devices.heartbeat(dev, parse(deviceHeartbeatSchema, body)));
      case "stream/start":
        return sendJson(res, 200, ctx.devices.streamStart(dev, parse(boxStreamStartSchema, body)));
      case "stream/stop":
        parse(deviceStreamStopSchema, body);
        ctx.devices.streamStop(dev);
        res.writeHead(204).end();
        return;
      default:
        throw notFound();
    }
  }

  async function hlsProxy(res: ServerResponse, mediaPath: string, file: string, search: string, missing: string) {
    if (!HLS_FILE_RE.test(file)) throw notFound();
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    const up = await ctx.media.fetchHlsPath(mediaPath, file, search, abort.signal);
    if (!up || !up.ok || !up.body) throw notFound(missing);
    res.writeHead(up.status, {
      "Content-Type": up.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": file.endsWith(".m3u8") ? "no-store" : "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
      ...(up.headers.get("content-length") ? { "Content-Length": up.headers.get("content-length")! } : {}),
    });
    await new Promise<void>((resolve) => {
      const body = Readable.fromWeb(up.body as WebReadableStream);
      body.on("error", () => {
        res.destroy();
        resolve();
      });
      body.on("end", resolve);
      res.on("close", () => {
        body.destroy();
        resolve();
      });
      body.pipe(res);
    });
  }

  async function boxApi(req: IncomingMessage, res: ServerResponse, sub: string, search: string) {
    const m = req.method ?? "GET";
    const local = isLoopback(remoteIp(req));

    if (sub === "media/auth") {
      if (m !== "POST" || !local) throw notFound();
      const body = (await readJson(req).catch(() => ({}))) as MediaAuthRequest;
      const ok = authorizeMedia(body, { tokens: ctx.tokens, deviceKeyHash: (id) => ctx.store.get(id)?.keyHash });
      res.writeHead(ok ? 200 : 401).end();
      return;
    }
    if (sub === "worker-info") {
      if (m !== "GET" || !local) throw notFound();
      return sendJson(res, 200, await workerInfo());
    }
    if (sub === "info") {
      if (m !== "GET") throw notFound();
      const info: BoxInfo = { name: ctx.boxName, ...(await workerInfo()) };
      return sendJson(res, 200, info);
    }

    const seg = sub.split("/");
    if (seg[0] !== "devices" && seg[0] !== "shows") throw notFound();
    if (!ctx.devNoAuth) await ctx.auth.require(header(req, "cookie"));
    const id = seg[1];

    // additive: the Studio worker's local copy of a show (BOX_RTMP_BASE) — a preview that doesn't need AWS / YouTube
    if (seg[0] === "shows") {
      if (!id || !/^[A-Za-z0-9]{8,40}$/.test(id) || seg[2] !== "live" || seg.length !== 4 || (m !== "GET" && m !== "HEAD")) throw notFound();
      return hlsProxy(res, `live/show_${id}`, seg[3]!, search, "The show isn't on this box right now");
    }

    if (!id) {
      if (m === "GET") return sendJson(res, 200, { items: await ctx.devices.rows() });
      if (m === "POST") {
        const { name } = parse(boxDeviceNameSchema, await readJson(req));
        const { device, key } = ctx.devices.create(name);
        return sendJson(res, 201, { device: await ctx.devices.row(device), key, pairUrl: boxPairUrl(ctx.lanUrl, key, ctx.boxName) });
      }
      throw notFound();
    }
    const dev = ctx.store.get(id);
    if (!dev) throw notFound("Device not found");
    if (seg.length === 2) {
      if (m === "GET") return sendJson(res, 200, await ctx.devices.row(dev));
      if (m === "PATCH") {
        const { name } = parse(boxDeviceNameSchema, await readJson(req));
        return sendJson(res, 200, await ctx.devices.row(ctx.store.update(id, { name })!));
      }
      if (m === "DELETE") {
        await ctx.devices.remove(id);
        res.writeHead(204).end();
        return;
      }
      throw notFound();
    }
    if (seg[2] === "live" && seg.length === 4 && (m === "GET" || m === "HEAD")) return hlsProxy(res, devicePath(id), seg[3]!, search, "The phone isn't streaming right now");
    // additive: a full-quality screenshot from the phone (rides on its next heartbeat), 504 when it doesn't answer in 5 s
    if (seg[2] === "snapshot.png" && seg.length === 3 && m === "GET") {
      const png = await ctx.devices.requestSnapshot(id);
      if (!png) throw new HttpError(504, "INTERNAL", "The phone didn't send a screenshot. Is the 7XEN Stream app streaming?");
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store", "Content-Length": png.length }).end(png);
      return;
    }
    throw notFound();
  }

  return (req, res) => {
    const url = req.url ?? "/";
    const q = url.indexOf("?");
    const pathname = q < 0 ? url : url.slice(0, q);
    const search = q < 0 ? "" : url.slice(q);
    const run = async () => {
      if (pathname.startsWith("/api/device/")) return deviceApi(req, res, pathname.slice("/api/device/".length));
      if (pathname === "/api" || pathname.startsWith("/api/")) return ctx.proxy(req, res);
      if (pathname.startsWith("/box/")) return boxApi(req, res, pathname.slice("/box/".length).replace(/\/+$/, ""), search);
      return ctx.serveStatic(req, res);
    };
    run().catch((err) => sendError(res, err));
  };
}
