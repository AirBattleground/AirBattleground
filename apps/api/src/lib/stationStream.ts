/**
 * Live view + control of the station's BlueStacks device for the manager's browser.
 *
 *   browser ──ws /api/(manager|admin)/matches/:id/station/stream──▶ API ──ws /device/stream (X-Station-Token)──▶ station
 *
 * Express routes can't upgrade a socket, so this hooks the HTTP server's `upgrade` event: it authenticates exactly
 * like the REST routes (session cookie or bearer, MANAGER on /manager, ADMIN on /admin), checks the user may use the
 * match, refuses cross-site pages (Origin), then connects to the station first and only then accepts the browser, so
 * a busy/offline station shows up as a failed upgrade (409 / 503) instead of a silent socket.
 */
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { ADMIN_COOKIE, APP_COOKIE, STATION_TOKEN_HEADER } from "@7xen/shared";
import { WebSocket, WebSocketServer } from "ws";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { logger } from "../logger.js";
import { loadOwnMatch } from "../services/matches.js";
import { bearerToken, verifyToken } from "./auth.js";
import { stationToken, stationUrl } from "./stationClient.js";

const PATH_RE = /^\/api\/(manager|admin)\/matches\/([A-Za-z0-9_-]{1,64})\/station\/stream$/;
/** per-browser queue limit before delta frames are skipped until the next keyframe */
const MAX_BACKLOG = 4 * 1024 * 1024;

function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Browsers always send Origin on a WebSocket handshake: it must be this site (or an allowed origin). */
function originAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true; // not a browser (curl / native app with a bearer token)
  try {
    const o = new URL(origin);
    if (host && o.host === host) return true;
  } catch {
    return false;
  }
  return env.CORS_ORIGINS.includes(origin);
}

function reject(socket: Duplex, status: number, message: string) {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

async function authorize(req: IncomingMessage, area: "manager" | "admin", matchId: string): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const bearer = bearerToken(req.headers.authorization);
  const token = bearer ?? cookieValue(req.headers.cookie, area === "admin" ? ADMIN_COOKIE : APP_COOKIE);
  const payload = token ? verifyToken(token) : null;
  if (!payload) return { ok: false, status: 401, message: "Unauthorized" };
  const role = area === "admin" ? "ADMIN" : "MANAGER";
  if (payload.role !== role) return { ok: false, status: 403, message: "Forbidden" };
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.isActive || user.role !== payload.role) return { ok: false, status: 401, message: "Unauthorized" };
  try {
    await loadOwnMatch(matchId, user.id, area === "admin");
  } catch {
    return { ok: false, status: 404, message: "Not Found" };
  }
  return { ok: true };
}

export function attachStationStream(server: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  server.on("upgrade", (req, socket, head) => {
    const m = PATH_RE.exec((req.url ?? "").split("?")[0] ?? "");
    if (!m) return void socket.destroy();
    socket.on("error", () => {});
    void (async () => {
      const [, area, matchId] = m as unknown as [string, "manager" | "admin", string];
      if (!originAllowed(req.headers.origin, req.headers.host)) return reject(socket, 403, "Forbidden");
      if (!stationToken()) return reject(socket, 503, "Service Unavailable");
      const auth = await authorize(req, area, matchId);
      if (!auth.ok) return reject(socket, auth.status, auth.message);

      const upstream = new WebSocket(`${stationUrl().replace(/^http/, "ws")}/device/stream?matchId=${encodeURIComponent(matchId)}`, {
        headers: { [STATION_TOKEN_HEADER]: stationToken() },
        handshakeTimeout: 8000,
      });
      upstream.binaryType = "nodebuffer";
      let accepted = false;
      upstream.once("unexpected-response", (_r, res) => {
        res.resume();
        if (!accepted) reject(socket, res.statusCode === 409 ? 409 : 503, res.statusCode === 409 ? "Conflict" : "Service Unavailable");
      });
      upstream.once("error", (err) => {
        if (!accepted) {
          logger.warn({ err: err.message }, "station stream unreachable");
          reject(socket, 503, "Service Unavailable");
        }
      });
      upstream.once("open", () => {
        accepted = true;
        wss.handleUpgrade(req, socket, head, (client) => {
          let needKey = false;
          upstream.on("message", (data, isBinary) => {
            if (client.readyState !== WebSocket.OPEN) return;
            const buf = data as Buffer;
            if (isBinary) {
              const key = buf[0] === 1;
              if (client.bufferedAmount > MAX_BACKLOG) needKey = true;
              if (needKey && !key) return;
              needKey = false;
              client.send(buf, { binary: true });
            } else {
              client.send(buf.toString("utf8"));
            }
          });
          client.on("message", (data, isBinary) => {
            if (isBinary && upstream.readyState === WebSocket.OPEN) upstream.send(data as Buffer, { binary: true });
          });
          const closeBoth = () => {
            try {
              client.close();
            } catch {
              /* closed */
            }
            try {
              upstream.close();
            } catch {
              /* closed */
            }
          };
          client.on("close", closeBoth);
          client.on("error", () => client.terminate());
          upstream.on("close", closeBoth);
          upstream.on("error", () => upstream.terminate());
        });
      });
    })().catch((err) => {
      logger.error({ err }, "station stream upgrade failed");
      reject(socket, 500, "Internal Server Error");
    });
  });
}
