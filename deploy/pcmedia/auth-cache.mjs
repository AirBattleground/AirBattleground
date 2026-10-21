// Caching relay for MediaMTX's auth hook on the studio PC. Every HLS request from the media server would otherwise
// ask the AWS API "may this read?" through the SSH tunnel (~0.4 s each); this answers repeats from memory.
// Allowed answers are kept for ALLOW_TTL_MS (a revoked token keeps working at most that long); refusals for DENY_TTL_MS.
//   node deploy/pcmedia/auth-cache.mjs          (listens on 127.0.0.1:14001, forwards to the tunnel on :14000)
import { createHash } from "node:crypto";
import { createServer } from "node:http";

const LISTEN_PORT = Number(process.env.AUTH_CACHE_PORT ?? 14001);
const UPSTREAM = process.env.AUTH_UPSTREAM ?? "http://127.0.0.1:14000/api/internal/media/auth";
const ALLOW_TTL_MS = 60_000;
const DENY_TTL_MS = 5_000;
const cache = new Map(); // key → { ok, until }

const keyOf = (body) => {
  // the connection id and client address change per request; the decision doesn't depend on them
  const { id: _id, ip: _ip, ...rest } = body;
  return createHash("sha256").update(JSON.stringify(rest)).digest("hex");
};

createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", async () => {
    let body;
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      res.writeHead(400).end();
      return;
    }
    const key = keyOf(body);
    const hit = cache.get(key);
    if (hit && hit.until > Date.now()) {
      res.writeHead(hit.ok ? 200 : 401).end();
      return;
    }
    try {
      const r = await fetch(UPSTREAM, { method: "POST", headers: { "content-type": "application/json" }, body: raw, signal: AbortSignal.timeout(8_000) });
      const ok = r.ok;
      if (cache.size > 5000) cache.clear();
      cache.set(key, { ok, until: Date.now() + (ok ? ALLOW_TTL_MS : DENY_TTL_MS) });
      res.writeHead(ok ? 200 : 401).end();
    } catch (err) {
      // tunnel or API unreachable: refuse (and don't cache) — MediaMTX asks again on the next request
      console.warn(`upstream failed for ${body.action} ${body.path}: ${err?.cause?.code ?? err?.name ?? err}`);
      res.writeHead(503).end();
    }
  });
}).listen(LISTEN_PORT, "127.0.0.1", () => console.log(`auth cache on 127.0.0.1:${LISTEN_PORT} → ${UPSTREAM}`));
