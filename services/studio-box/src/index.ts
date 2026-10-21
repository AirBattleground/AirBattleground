/**
 * 7XEN Studio Box — the venue PC: pairs the phones (device API), checks the media server's publishes/reads, serves
 * the web app with the box's Studio, and proxies everything else to the website. The Studio worker on the same PC
 * renders and sends the show (it reports this box in its poll via GET /box/worker-info).
 */
import http from "node:http";
import { ManagerAuth } from "./auth.js";
import { loadConfig } from "./config.js";
import { Devices } from "./devices.js";
import { MediaClient } from "./media.js";
import { advertise } from "./mdns.js";
import { makeApiProxy } from "./proxy.js";
import { createApp } from "./server.js";
import { makeStatic } from "./static.js";
import { Store } from "./store.js";
import { Tokens } from "./tokens.js";

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

const cfg = loadConfig();
const store = new Store(cfg.dataDir);
const tokens = new Tokens(store.secret);
const media = new MediaClient(cfg.mediaHlsUrl, cfg.mediaApiUrl, tokens);
const devices = new Devices({ store, tokens, media, boxName: () => cfg.boxName, lanHost: cfg.lanHost, rtmpPort: cfg.mediaRtmpPort });

const server = http.createServer(
  createApp({
    boxName: cfg.boxName,
    lanUrl: cfg.lanUrl,
    store,
    tokens,
    devices,
    media,
    auth: new ManagerAuth(cfg.apiUrl),
    devNoAuth: cfg.devNoAuth,
    proxy: makeApiProxy(cfg.apiUrl),
    serveStatic: makeStatic(cfg.webDist),
  }),
);
// long-polls through the proxy wait up to ~30 s; phones keep connections alive between heartbeats
server.requestTimeout = 0;
server.headersTimeout = 30_000;
server.keepAliveTimeout = 65_000;

server.listen(cfg.port, "0.0.0.0", () => {
  log(`7XEN Studio box "${cfg.boxName}" on ${cfg.lanUrl}  (website ${cfg.apiUrl})`);
  log(`media: RTMP rtmp://${cfg.lanHost}:${cfg.mediaRtmpPort}/live · HLS ${cfg.mediaHlsUrl} · API ${cfg.mediaApiUrl}`);
  log(`web app: ${cfg.webDist}`);
  if (!cfg.boxKey) log("BOX_KEY is empty — create a Studio box on the website and put its key here and in the Studio worker's .env");
  if (cfg.devNoAuth) log("WARNING: BOX_DEV_NO_AUTH=1 — the Studio API is open to anyone on this network (development only)");
});

const stopMdns = cfg.mdns ? advertise(cfg.boxName, cfg.port, cfg.lanUrl, log) : () => {};

const shutdown = (signal: string) => {
  log(`${signal}: shutting down`);
  stopMdns();
  server.close();
  setTimeout(() => process.exit(0), 1500).unref();
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
