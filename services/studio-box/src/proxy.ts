/**
 * /api/* (except the device API) → the website (AWS), streamed both ways. Cookies are rewritten for the box origin
 * (plain http on the LAN): no Domain=, no Secure. Long-polls (the Studio control poll waits up to 25 s) are fine —
 * the upstream timeout is 60 s.
 */
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import https from "node:https";
import { sendJson } from "./http.js";

const HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "trailers", "upgrade"]);
export const UPSTREAM_TIMEOUT_MS = 60_000;

/** One Set-Cookie header made usable on http://<lan-ip>:<port>: drop Domain and Secure (SameSite=None needs Secure → Lax). */
export function rewriteSetCookie(cookie: string): string {
  const parts = cookie.split(";").map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const k = p.split("=")[0]!.trim().toLowerCase();
    if (k === "domain" || k === "secure" || k === "partitioned") continue;
    if (k === "samesite" && /=\s*none$/i.test(p)) {
      out.push("SameSite=Lax");
      continue;
    }
    out.push(p);
  }
  return out.join("; ");
}

/** Absolute redirects to the website become relative, so the browser stays on the box. */
export function rewriteLocation(location: string, apiUrl: string): string {
  return location.startsWith(apiUrl + "/") ? location.slice(apiUrl.length) : location === apiUrl ? "/" : location;
}

export function makeApiProxy(apiUrl: string) {
  const target = new URL(apiUrl);
  const isHttps = target.protocol === "https:";
  const agent = isHttps ? new https.Agent({ keepAlive: true }) : new http.Agent({ keepAlive: true });
  const basePath = target.pathname.replace(/\/+$/, "");

  return (req: IncomingMessage, res: ServerResponse) => {
    const headers: http.OutgoingHttpHeaders = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined || HOP.has(k)) continue;
      headers[k] = v;
    }
    headers.host = target.host;
    // the website sees itself as the origin (the browser is same-origin with the box)
    if (headers.origin) headers.origin = target.origin;
    if (typeof headers.referer === "string") headers.referer = target.origin + "/";
    const ip = req.socket.remoteAddress ?? "";
    headers["x-forwarded-for"] = req.headers["x-forwarded-for"] ? `${req.headers["x-forwarded-for"]}, ${ip}` : ip;
    headers["x-forwarded-proto"] = "http";
    headers["x-forwarded-host"] = req.headers.host ?? "";

    const upstream = (isHttps ? https : http).request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        method: req.method,
        path: basePath + (req.url ?? "/"),
        headers,
        agent,
        timeout: UPSTREAM_TIMEOUT_MS,
      },
      (up) => {
        const out: http.OutgoingHttpHeaders = {};
        for (const [k, v] of Object.entries(up.headers)) {
          if (v === undefined || HOP.has(k)) continue;
          if (k === "set-cookie") out[k] = (Array.isArray(v) ? v : [v]).map(rewriteSetCookie);
          else if (k === "location" && typeof v === "string") out[k] = rewriteLocation(v, target.origin + basePath);
          else if (k === "strict-transport-security") continue;
          else out[k] = v;
        }
        res.writeHead(up.statusCode ?? 502, out);
        up.pipe(res);
        up.on("error", () => res.destroy());
      },
    );
    upstream.on("timeout", () => upstream.destroy(new Error("upstream timeout")));
    upstream.on("error", () => {
      if (!res.headersSent) sendJson(res, 502, { error: { code: "INTERNAL", message: "The Studio box can't reach AirBattleground right now. Check the internet connection." } });
      else res.destroy();
    });
    res.on("close", () => {
      if (!res.writableFinished) upstream.destroy();
    });
    req.pipe(upstream);
  };
}
