import http, { type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ManagerAuth, type FetchLike } from "../src/auth.js";
import { detectLanHost, loadConfig } from "../src/config.js";
import { Devices } from "../src/devices.js";
import { HttpError } from "../src/http.js";
import { authorizeMedia } from "../src/media.js";
import { mdnsCommand } from "../src/mdns.js";
import { rewriteLocation, rewriteSetCookie } from "../src/proxy.js";
import { createApp } from "../src/server.js";
import { Store } from "../src/store.js";
import { PUBLISH_TOKEN_TTL_MS, Tokens } from "../src/tokens.js";

const tmp = mkdtempSync(path.join(os.tmpdir(), "box-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("tokens", () => {
  const t = new Tokens(Buffer.alloc(32, 7));
  it("publish token verifies for that device + key only, until it expires", () => {
    const now = 1_000_000;
    const { token, expiresAt } = t.publishToken("dev12345", "hashA", now);
    expect(expiresAt.getTime()).toBe(now + PUBLISH_TOKEN_TTL_MS);
    expect(t.verifyPublishToken("dev12345", "hashA", token, now + 1000)).toBe(true);
    expect(t.verifyPublishToken("dev12345", "hashB", token, now)).toBe(false);
    expect(t.verifyPublishToken("other123", "hashA", token, now)).toBe(false);
    expect(t.verifyPublishToken("dev12345", "hashA", token, now + PUBLISH_TOKEN_TTL_MS + 1)).toBe(false);
    expect(t.verifyPublishToken("dev12345", "hashA", "garbage", now)).toBe(false);
  });
  it("internal credentials come from the secret", () => {
    expect(t.isInternal("box", t.internalPass)).toBe(true);
    expect(t.isInternal("box", "nope")).toBe(false);
    expect(new Tokens(Buffer.alloc(32, 8)).internalPass).not.toBe(t.internalPass);
  });
});

describe("media auth hook", () => {
  const tokens = new Tokens(Buffer.alloc(32, 1));
  const deps = { tokens, deviceKeyHash: (id: string) => (id === "dev12345" ? "kh" : undefined) };
  const tok = tokens.publishToken("dev12345", "kh").token;
  it.each([
    [{ action: "publish", path: "live/dev_dev12345", query: `token=${tok}`, ip: "192.168.1.5" }, true],
    [{ action: "publish", path: "live/dev_dev12345", query: "token=1.x", ip: "192.168.1.5" }, false],
    [{ action: "publish", path: "live/dev_unknown1", query: `token=${tok}`, ip: "192.168.1.5" }, false],
    [{ action: "publish", path: "live/show_abcdefgh1", ip: "127.0.0.1" }, true],
    [{ action: "publish", path: "live/show_abcdefgh1", ip: "192.168.1.5" }, false],
    [{ action: "read", path: "live/dev_dev12345", ip: "127.0.0.1" }, true],
    [{ action: "read", path: "live/dev_dev12345", ip: "::ffff:127.0.0.1" }, true],
    [{ action: "read", path: "live/dev_dev12345", ip: "192.168.1.9" }, false],
    [{ action: "api", ip: "192.168.1.9" }, false],
    [{ action: "api", ip: "127.0.0.1" }, false],
    [{ action: "api", user: "box", password: tokens.internalPass, ip: "192.168.1.9" }, true],
    [{ action: "publish", path: "live/anything", user: "box", password: tokens.internalPass }, true],
  ])("%j → %s", (req, ok) => {
    expect(authorizeMedia(req, deps)).toBe(ok);
  });
});

describe("cookie / location rewrite", () => {
  it("drops Domain and Secure, keeps the rest", () => {
    expect(rewriteSetCookie("sx_app=abc; Max-Age=600; Path=/; Domain=airbattleground.com; HttpOnly; Secure; SameSite=Lax")).toBe(
      "sx_app=abc; Max-Age=600; Path=/; HttpOnly; SameSite=Lax",
    );
    expect(rewriteSetCookie("a=b; secure; samesite=None")).toBe("a=b; SameSite=Lax");
    expect(rewriteSetCookie("sx_app=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT")).toBe("sx_app=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  });
  it("makes redirects to the website relative", () => {
    expect(rewriteLocation("https://x.com/studio?a=1", "https://x.com")).toBe("/studio?a=1");
    expect(rewriteLocation("https://other.com/", "https://x.com")).toBe("https://other.com/");
  });
});

describe("manager auth", () => {
  it("asks /api/auth/me with the cookies, requires MANAGER, caches 60 s", async () => {
    let t = 0;
    const calls: string[] = [];
    const role = { v: "MANAGER" };
    const f: FetchLike = async (url, init) => {
      calls.push(`${url} ${init.headers.cookie}`);
      if (init.headers.cookie === "bad") return { status: 401, ok: false, json: async () => ({}) };
      return { status: 200, ok: true, json: async () => ({ user: { id: "u1", role: role.v } }) };
    };
    const a = new ManagerAuth("https://site", f, () => t);
    await expect(a.require("sx_app=1")).resolves.toEqual({ userId: "u1" });
    await a.require("sx_app=1");
    expect(calls).toEqual(["https://site/api/auth/me sx_app=1"]);
    await expect(a.require(undefined)).rejects.toMatchObject({ status: 401 });
    await expect(a.require("bad")).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    role.v = "PLAYER";
    await expect(a.require("sx_app=2")).rejects.toMatchObject({ status: 403 });
    t = 61_000;
    role.v = "MANAGER";
    await a.require("sx_app=2");
    expect(calls.length).toBe(4);
  });
});

describe("config + mdns", () => {
  it("defaults", () => {
    const c = loadConfig({ LAN_HOST: "10.0.0.5" });
    expect(c.port).toBe(4300);
    expect(c.lanUrl).toBe("http://10.0.0.5:4300");
    expect(c.apiUrl).toBe("https://airbattleground.com");
    expect(c.mediaRtmpPort).toBe(1935);
    expect(loadConfig({ BOX_DEV_NO_AUTH: "1", NODE_ENV: "production" }).devNoAuth).toBe(false);
    expect(loadConfig({ BOX_DEV_NO_AUTH: "1" }).devNoAuth).toBe(true);
  });
  it("detects a private LAN address, skipping docker bridges", () => {
    const i = (address: string, internal = false) => ({ address, family: "IPv4", internal, netmask: "", mac: "", cidr: null }) as os.NetworkInterfaceInfo;
    expect(detectLanHost({ lo: [i("127.0.0.1", true)], docker0: [i("172.17.0.1")], wlan0: [i("192.168.1.20")] })).toBe("192.168.1.20");
    expect(detectLanHost({ lo: [i("127.0.0.1", true)] })).toBe("127.0.0.1");
  });
  it("mdns command", () => {
    expect(mdnsCommand("linux", "Box", 4300, "http://a:4300")).toEqual(["avahi-publish-service", ["Box", "_7xen-studio._tcp", "4300", "name=Box", "api=http://a:4300"]]);
    expect(mdnsCommand("darwin", "Box", 4300, "u")[0]).toBe("dns-sd");
  });
});

// ---------------------------------------------------------------- HTTP

describe("box HTTP", () => {
  let base = "";
  let server: http.Server;
  let store: Store;
  let tokens: Tokens;
  let ready = new Set<string>();
  const authed = { ok: true };
  const hlsHits: string[] = [];

  beforeAll(async () => {
    store = new Store(path.join(tmp, "data"));
    tokens = new Tokens(store.secret);
    const media = {
      pathReady: async (id: string) => (ready.has(id) ? { readySince: new Date("2026-01-01T00:00:00Z") } : null),
      kick: async () => {},
      fetchHlsPath: async (p: string, file: string, search: string) => {
        const id = p.replace(/^live\/(dev|show)_/, "");
        hlsHits.push(`${id}/${file}${search}`);
        return ready.has(id) ? new Response("#EXTM3U\n", { headers: { "content-type": "application/vnd.apple.mpegurl" } }) : null;
      },
    };
    const devices = new Devices({ store, tokens, media, boxName: () => "Opus Studio", lanHost: "192.168.1.20", rtmpPort: 1935 });
    const proxy: RequestListener = (req, res) => {
      res.writeHead(200, { "content-type": "application/json", "set-cookie": "x=1; Secure; Domain=a.com" }).end(JSON.stringify({ proxied: req.url }));
    };
    const serveStatic: RequestListener = (_req, res) => void res.writeHead(200, { "content-type": "text/html" }).end("<html>");
    server = http.createServer(
      createApp({
        boxName: "Opus Studio",
        lanUrl: "http://192.168.1.20:4300",
        store,
        tokens,
        devices,
        media,
        auth: {
          require: async () => {
            if (!authed.ok) throw new HttpError(401, "UNAUTHENTICATED", "Please log in to continue");
            return { userId: "m1" };
          },
        },
        proxy,
        serveStatic,
      }),
    );
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  beforeEach(() => {
    authed.ok = true;
    ready = new Set();
  });

  const call = (p: string, init: RequestInit & { key?: string; json?: unknown } = {}) =>
    fetch(base + p, {
      ...init,
      headers: { ...(init.key ? { "X-Device-Key": init.key } : {}), ...(init.json !== undefined ? { "content-type": "application/json" } : {}), ...(init.headers as Record<string, string>) },
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });

  async function addDevice(name = "iPad 1") {
    const r = await call("/box/devices", { method: "POST", json: { name } });
    expect(r.status).toBe(201);
    return (await r.json()) as { device: { id: string; name: string }; key: string; pairUrl: string };
  }

  it("device API: 401 shape on a bad key", async () => {
    for (const key of [undefined, "nope", "7xk_wrongwrongwrong"]) {
      const r = await call("/api/device/hello", { method: "POST", key, json: {} });
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ error: { code: "DEVICE_KEY_INVALID", message: expect.any(String) } });
    }
  });

  it("pair → hello → stream/start → heartbeat → list → stop", async () => {
    const { device, key, pairUrl } = await addDevice();
    expect(key.startsWith("7xk_")).toBe(true);
    expect(pairUrl).toBe(`7xen://pair?host=${encodeURIComponent("http://192.168.1.20:4300")}&key=${encodeURIComponent(key)}&name=Opus%20Studio`);

    const hello = await call("/api/device/hello", { method: "POST", key, json: { deviceModel: "iPhone 15", osVersion: "18.1", appVersion: "2.0" } });
    expect(await hello.json()).toEqual({ device: { id: device.id, name: "iPad 1" }, manager: { name: "Opus Studio" }, assignedMatch: null, studio: { name: "Opus Studio" } });

    const start = await call("/api/device/stream/start", { method: "POST", key, json: { quality: "1080p", fps: 60 } });
    const s = (await start.json()) as { rtmpUrl: string; streamName: string; expiresAt: string };
    expect(s.rtmpUrl).toBe("rtmp://192.168.1.20:1935/live");
    const m = /^dev_([a-z0-9]+)\?token=(.+)$/.exec(s.streamName);
    expect(m?.[1]).toBe(device.id);
    expect(authorizeMedia({ action: "publish", path: `live/dev_${device.id}`, query: `token=${m![2]}`, ip: "192.168.1.30" }, { tokens, deviceKeyHash: (id) => store.get(id)?.keyHash })).toBe(true);

    const bad = await call("/api/device/stream/start", { method: "POST", key, json: { quality: "4k" } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");

    const hb = await call("/api/device/heartbeat", { method: "POST", key, json: { state: "LIVE", battery: 0.8, fps: 60 } });
    expect(await hb.json()).toEqual({ assignedMatch: null, snapshotRequests: [] });

    ready.add(device.id);
    const list = (await (await call("/box/devices")).json()) as { items: Record<string, unknown>[] };
    const row = list.items.find((d) => d.id === device.id)!;
    expect(row).toMatchObject({ online: true, streaming: true, videoReady: true, model: "iPhone 15", hlsUrl: `/box/devices/${device.id}/live/index.m3u8` });
    expect(row.health).toMatchObject({ battery: 0.8, fps: 60 });
    expect(row.streamingSince).toEqual(expect.any(String));

    const stop = await call("/api/device/stream/stop", { method: "POST", key, json: {} });
    expect(stop.status).toBe(204);
    ready.delete(device.id);
    const after = (await (await call(`/box/devices/${device.id}`)).json()) as Record<string, unknown>;
    expect(after).toMatchObject({ online: true, streaming: false, videoReady: false, streamingSince: null });
  });

  it("snapshot request rides on the heartbeat, phone uploads multipart PNG", async () => {
    const { device, key } = await addDevice("Snap phone");
    const pending = fetch(`${base}/box/devices/${device.id}/snapshot.png`);
    await new Promise((r) => setTimeout(r, 50));
    const hb = (await (await call("/api/device/heartbeat", { method: "POST", key, json: { state: "LIVE" } })).json()) as { snapshotRequests: { id: string }[] };
    expect(hb.snapshotRequests).toHaveLength(1);
    const png = Buffer.concat([Buffer.from([0x89]), Buffer.from("PNG\r\n\x1a\n"), Buffer.alloc(20, 1)]);
    const fd = new FormData();
    fd.append("image", new Blob([png], { type: "image/png" }), "s.png");
    const up = await fetch(`${base}/api/device/snapshots/${hb.snapshotRequests[0]!.id}`, { method: "POST", headers: { "X-Device-Key": key }, body: fd });
    expect(up.status).toBe(204);
    const got = await pending;
    expect(got.status).toBe(200);
    expect(Buffer.from(await got.arrayBuffer()).equals(png)).toBe(true);
    const again = await fetch(`${base}/api/device/snapshots/${hb.snapshotRequests[0]!.id}`, { method: "POST", headers: { "X-Device-Key": key }, body: fd });
    expect(again.status).toBe(404);
  });

  it("rename, HLS proxy (query kept), delete voids the key", async () => {
    const { device, key } = await addDevice("Old");
    const r = await call(`/box/devices/${device.id}`, { method: "PATCH", json: { name: "New name" } });
    expect(((await r.json()) as { name: string }).name).toBe("New name");
    expect((await call(`/box/devices/${device.id}`, { method: "PATCH", json: { name: "x" } })).status).toBe(400);

    expect((await call(`/box/devices/${device.id}/live/index.m3u8`)).status).toBe(404);
    ready.add(device.id);
    const hls = await call(`/box/devices/${device.id}/live/index.m3u8?_HLS_msn=3`);
    expect(hls.status).toBe(200);
    expect(hls.headers.get("content-type")).toBe("application/vnd.apple.mpegurl");
    expect(await hls.text()).toBe("#EXTM3U\n");
    expect(hlsHits.at(-1)).toBe(`${device.id}/index.m3u8?_HLS_msn=3`);
    expect((await call(`/box/devices/${device.id}/live/..%2Fsecret`)).status).toBe(404);
    ready.add("show12345");
    expect((await call("/box/shows/show12345/live/index.m3u8")).status).toBe(200);
    expect((await call("/box/shows/nope/live/index.m3u8")).status).toBe(404);

    expect((await call(`/box/devices/${device.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await call("/api/device/hello", { method: "POST", key, json: {} })).status).toBe(401);
    expect((await call(`/box/devices/${device.id}`)).status).toBe(404);
  });

  it("Studio API needs a manager; info is public; worker-info + media hook are local", async () => {
    authed.ok = false;
    expect((await call("/box/devices")).status).toBe(401);
    const info = (await (await call("/box/info")).json()) as Record<string, unknown>;
    expect(info).toMatchObject({ name: "Opus Studio", lanUrl: "http://192.168.1.20:4300", devices: expect.any(Number), streaming: expect.any(Number) });
    const wi = (await (await call("/box/worker-info")).json()) as Record<string, unknown>;
    expect(Object.keys(wi).sort()).toEqual(["devices", "lanUrl", "streaming"]);
    const hook = await call("/box/media/auth", { method: "POST", json: { action: "read", path: "live/dev_x", ip: "192.168.0.2" } });
    expect(hook.status).toBe(401);
    const hookOk = await call("/box/media/auth", { method: "POST", json: { action: "read", path: "live/dev_x", ip: "127.0.0.1" } });
    expect(hookOk.status).toBe(200);
  });

  it("other /api goes to the proxy, everything else to the web app", async () => {
    const r = await call("/api/manager/studio/shows?x=1");
    expect(await r.json()).toEqual({ proxied: "/api/manager/studio/shows?x=1" });
    expect(await (await call("/studio")).text()).toBe("<html>");
    expect((await call("/box/nope")).status).toBe(404);
  });
});

describe("API proxy (real upstream)", () => {
  it("streams body both ways, sets Host, rewrites cookies + redirects", async () => {
    const { makeApiProxy } = await import("../src/proxy.js");
    const seen: { host?: string; origin?: string; body?: string; url?: string } = {};
    const upstream = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        Object.assign(seen, { host: req.headers.host, origin: req.headers.origin, body, url: req.url });
        res.writeHead(req.url === "/api/redirect" ? 302 : 200, {
          "content-type": "application/json",
          "set-cookie": ["sx_app=tok; Path=/; Domain=example.com; HttpOnly; Secure; SameSite=Lax"],
          location: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/studio`,
          "strict-transport-security": "max-age=1",
        });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
    const upUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    const box = http.createServer(makeApiProxy(upUrl));
    await new Promise<void>((r) => box.listen(0, "127.0.0.1", r));
    const boxUrl = `http://127.0.0.1:${(box.address() as AddressInfo).port}`;
    try {
      const r = await fetch(`${boxUrl}/api/auth/login?x=1`, { method: "POST", headers: { "content-type": "application/json", origin: boxUrl }, body: '{"a":1}', redirect: "manual" });
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ ok: true });
      expect(r.headers.get("set-cookie")).toBe("sx_app=tok; Path=/; HttpOnly; SameSite=Lax");
      expect(r.headers.get("location")).toBe("/studio");
      expect(r.headers.get("strict-transport-security")).toBeNull();
      expect(seen).toEqual({ host: new URL(upUrl).host, origin: upUrl, body: '{"a":1}', url: "/api/auth/login?x=1" });
    } finally {
      box.close();
      upstream.close();
    }
  });
});
