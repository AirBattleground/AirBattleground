/**
 * Station HTTP API (internal; only apps/api calls it). Every request must carry `X-Station-Token`.
 * Plain node:http — a handful of JSON routes don't need a framework.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z } from "zod";
import { stationCaptureSchema, stationDeviceStartSchema, stationDeviceStopSchema, stationInputSchema } from "@7xen/shared";
import { WebSocketServer } from "ws";
import type { BsFrame, BsLink } from "./bluestacks.js";
import { sanitizeClientMessage } from "./bluestacks.js";
import type { ApiHooks } from "./apiClient.js";
import { log } from "./log.js";
import { StationError, type Station } from "./session.js";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "invalid id");
const prepareSchema = z.object({
  matchId: id,
  recordingId: id,
  title: z.string().max(200).default(""),
  videoKey: z.string().regex(/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)*\.mp4$/, "invalid video key").max(300),
  launchBgmi: z.boolean().default(true),
  bitrateMbps: z.number().min(1).max(20).optional(),
  maxFps: z.number().int().min(10).max(60).optional(),
});
const matchSchema = z.object({ matchId: id });

/** Constant-time comparison of the shared secret (hashing first makes lengths equal). */
function tokenMatches(expected: string, given: string | string[] | undefined): boolean {
  if (!expected || typeof given !== "string" || !given) return false;
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(given).digest();
  return timingSafeEqual(a, b);
}

function send(res: ServerResponse, status: number, body?: unknown) {
  if (body === undefined) {
    res.writeHead(status).end();
    return;
  }
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(text);
}

const fail = (res: ServerResponse, status: number, code: string, message: string) => send(res, status, { error: { code, message } });

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 64 * 1024) throw new StationError(413, "VALIDATION_ERROR", "Request is too large");
    chunks.push(c as Buffer);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new StationError(400, "VALIDATION_ERROR", "Body isn't valid JSON");
  }
}

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new StationError(400, "VALIDATION_ERROR", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

/** Max bytes queued for one slow browser before it is skipped to the next keyframe. */
const MAX_VIEWER_BACKLOG = 4 * 1024 * 1024;

/** `GET /device/stream` (WebSocket): relays the BlueStacks stream + input to a manager's browser (via the API). */
function attachStreamRelay(server: Server, station: Station, link: BsLink, token: string) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://station");
    if (url.pathname !== "/device/stream") return void socket.destroy();
    const given = req.headers["x-station-token"] ?? url.searchParams.get("token") ?? undefined;
    if (!tokenMatches(token, given ?? undefined)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return void socket.destroy();
    }
    const matchId = url.searchParams.get("matchId");
    if (!station.streamAllowed(matchId)) {
      socket.write("HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n");
      return void socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const release = link.acquire();
      let needKey = true;
      ws.send(JSON.stringify({ type: "hello", backend: "station" }));
      if (link.lastMode) ws.send(link.lastMode);
      if (link.lastConfig) ws.send(link.lastConfig);
      const onFrame = (f: BsFrame) => {
        if (needKey && !f.key) return;
        if (ws.bufferedAmount > MAX_VIEWER_BACKLOG) {
          needKey = true; // too slow: drop until the next keyframe
          return;
        }
        needKey = false;
        ws.send(f.raw, { binary: true });
      };
      const onText = (t: string) => {
        if (t.includes('"config"')) needKey = true; // new codec/stream: wait for its keyframe
        ws.send(t);
      };
      link.on("frame", onFrame);
      link.on("config", onText);
      link.on("mode", onText);
      link.requestKeyframe();
      ws.on("message", (data, isBinary) => {
        if (!isBinary) return;
        const msg = sanitizeClientMessage(data as Buffer);
        if (!msg) return;
        // only the match that owns the station may touch it
        if (!station.streamAllowed(matchId)) return;
        if (msg[0] === 2) needKey = true;
        link.send(msg);
      });
      ws.on("close", () => {
        link.off("frame", onFrame);
        link.off("config", onText);
        link.off("mode", onText);
        release();
      });
      ws.on("error", () => ws.terminate());
    });
  });
}

export function createStationServer(station: Station, opts: { token: string; api?: ApiHooks; link?: BsLink }): Server {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://station");
    const route = `${req.method} ${url.pathname.replace(/\/+$/, "") || "/"}`;
    try {
      if (!tokenMatches(opts.token, req.headers["x-station-token"])) {
        fail(res, 401, "UNAUTHENTICATED", "Missing or wrong station token");
        return;
      }
      switch (route) {
        case "GET /health":
          return send(res, 200, await station.status(url.searchParams.has("fresh")));
        case "POST /sessions": {
          const body = parse(prepareSchema, await readJson(req));
          return send(res, 200, await station.prepare(body));
        }
        case "POST /sessions/stop": {
          const { matchId } = parse(matchSchema, await readJson(req));
          return send(res, 200, await station.stop(matchId));
        }
        case "POST /sessions/capture": {
          const body = parse(matchSchema.merge(stationCaptureSchema), await readJson(req));
          const shot = await station.capture(body.matchId, body.kind);
          // hand it to the API's normal screenshot pipeline (source STATION); the API also dedupes by hash,
          // so its own read of `file` after this is harmless
          if (opts.api) {
            await opts.api.screenshot(body.matchId, body.kind, shot.png).catch((err) => log.warn("screenshot hook failed; the API will read the file", { err }));
          }
          return send(res, 200, { file: shot.file });
        }
        case "POST /sessions/input": {
          const raw = (await readJson(req)) as Record<string, unknown>;
          const { matchId } = parse(matchSchema, raw);
          const input = parse(stationInputSchema, raw);
          await station.input(matchId, input);
          return send(res, 204);
        }
        case "POST /device/start":
          return send(res, 200, await station.deviceStart(parse(stationDeviceStartSchema, await readJson(req))));
        case "POST /device/stop":
          return send(res, 200, await station.deviceStop(parse(stationDeviceStopSchema, await readJson(req))));
        case "POST /bgmi/launch":
          await station.launchBgmi();
          return send(res, 204);
        default:
          return fail(res, 404, "NOT_FOUND", "Not found");
      }
    } catch (err) {
      if (err instanceof StationError) return fail(res, err.status, err.code, err.message);
      log.error("request failed", { route, err });
      return fail(res, 500, "INTERNAL", err instanceof Error ? err.message : "Something went wrong");
    }
  });
  if (opts.link) attachStreamRelay(server, station, opts.link, opts.token);
  return server;
}
