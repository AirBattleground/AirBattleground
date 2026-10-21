/** Box settings from the environment (`node --env-file-if-exists=.env`, see .env.example). */
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOX_DEFAULT_PORT } from "@7xen/shared";

export interface Config {
  /** the AirBattleground website (AWS) */
  apiUrl: string;
  /** the Studio worker key from the website (Studio → Studio boxes); "" = not paired yet */
  boxKey: string;
  boxName: string;
  port: number;
  /** LAN address phones and managers use to reach this PC */
  lanHost: string;
  /** http://<lanHost>:<port> unless LAN_URL overrides it (e.g. http://studio-box.local:4300) */
  lanUrl: string;
  mediaRtmpPort: number;
  mediaHlsUrl: string;
  mediaApiUrl: string;
  webDist: string;
  dataDir: string;
  /** dev only: skip the manager check on /box/* (never honoured with NODE_ENV=production) */
  devNoAuth: boolean;
  /** advertise _7xen-studio._tcp on the LAN (avahi / dns-sd when installed) */
  mdns: boolean;
}

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PRIVATE_V4 = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];

/** First private IPv4 of this machine (Wi-Fi / Ethernet), else 127.0.0.1. */
export function detectLanHost(ifaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): string {
  const all = Object.entries(ifaces)
    // docker / VPN bridges are never what the phones can reach
    .filter(([name]) => !/^(docker|br-|veth|virbr|tun|tap|wg|zt|tailscale|lo)/i.test(name))
    .flatMap(([, list]) => list ?? [])
    .filter((i) => i.family === "IPv4" && !i.internal);
  return all.find((i) => PRIVATE_V4.some((re) => re.test(i.address)))?.address ?? all[0]?.address ?? "127.0.0.1";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
  const num = (v: string | undefined, d: number) => {
    const n = Number(blank(v) ?? d);
    return Number.isInteger(n) && n > 0 && n < 65536 ? n : d;
  };
  const port = num(env.PORT, BOX_DEFAULT_PORT);
  const lanHost = blank(env.LAN_HOST) ?? detectLanHost();
  const resolve = (p: string) => (path.isAbsolute(p) ? p : path.resolve(PKG_DIR, p));
  const mediaHlsUrl = (blank(env.MEDIA_HLS_URL) ?? "http://127.0.0.1:8888").replace(/\/+$/, "");
  return {
    apiUrl: (blank(env.API_URL) ?? "https://airbattleground.com").replace(/\/+$/, ""),
    boxKey: blank(env.BOX_KEY) ?? "",
    boxName: (blank(env.BOX_NAME) ?? os.hostname()).slice(0, 40),
    port,
    lanHost,
    lanUrl: (blank(env.LAN_URL) ?? `http://${lanHost}:${port}`).replace(/\/+$/, ""),
    mediaRtmpPort: num(env.MEDIA_RTMP_PORT, 1935),
    mediaHlsUrl,
    mediaApiUrl: (blank(env.MEDIA_API_URL) ?? "http://127.0.0.1:9997").replace(/\/+$/, ""),
    webDist: resolve(blank(env.WEB_DIST) ?? "../../apps/web/dist"),
    dataDir: resolve(blank(env.DATA_DIR) ?? "./data"),
    devNoAuth: env.BOX_DEV_NO_AUTH === "1" && env.NODE_ENV !== "production",
    mdns: env.MDNS !== "0",
  };
}
