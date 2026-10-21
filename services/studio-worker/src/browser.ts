/**
 * Headless Google Chrome showing the render page. The page hands us MediaRecorder chunks through
 * window.__swChunk(base64) and its health through window.__swStatus(status) — both exposed before it loads.
 * Real Chrome (not Playwright's Chromium) because the phone feeds are H.264/AAC HLS.
 */
import type { RenderStatus } from "@7xen/shared";
import { STUDIO_HEIGHT, STUDIO_WIDTH } from "@7xen/shared";
import { chromium, type Browser, type BrowserContext } from "playwright-core";
import { log, rateLimited } from "./log.js";

export interface RenderOpts {
  url: string;
  chromePath: string | null;
  extraArgs?: string[];
  /** session cookie (the show's manager) */
  cookie?: { name: string; value: string };
  /** read phone feeds from a media server on this machine instead of through the API (see Config.localHlsBase) */
  deviceHls?: { base: string; token: string } | null;
  onChunk: (buf: Buffer) => Promise<void>;
  onStatus: (s: RenderStatus) => void;
  /** browser crashed / page closed */
  onExit: (reason: string) => void;
}

export const CHROME_ARGS = [
  "--autoplay-policy=no-user-gesture-required",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  "--disable-features=CalculateNativeWinOcclusion",
  "--ignore-gpu-blocklist",
  "--enable-gpu-rasterization",
  "--no-first-run",
  "--no-default-browser-check",
];

/** /api/manager/devices/<id>/live/<file>?q → <base>/live/dev_<id>/<file>?q&rtoken=… (null = not a phone feed request) */
export function localDeviceHlsUrl(requestUrl: string, base: string, token: string): string | null {
  const u = new URL(requestUrl);
  const m = /^\/api\/manager\/devices\/([A-Za-z0-9]+)\/live\/([A-Za-z0-9_.-]+)$/.exec(u.pathname);
  if (!m) return null;
  const q = new URLSearchParams(u.search);
  q.set("rtoken", token);
  return `${base}/live/dev_${m[1]}/${m[2]}?${q}`;
}

export class RenderBrowser {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private closing = false;

  constructor(private readonly opts: RenderOpts) {}

  /** Serve the page's phone-feed HLS from the local media server; anything that fails falls back to the API. */
  private async routeDeviceHls(context: BrowserContext, hls: { base: string; token: string }) {
    const warn = rateLimited(3, 60_000);
    await context.route(/\/api\/manager\/devices\/[A-Za-z0-9]+\/live\//, async (route) => {
      const target = localDeviceHlsUrl(route.request().url(), hls.base, hls.token);
      if (!target) return route.continue();
      try {
        const r = await fetch(target, { signal: AbortSignal.timeout(15_000) });
        if (!r.ok) {
          warn(() => log.warn(`local phone feed answered ${r.status} — using the API instead`));
          return route.continue();
        }
        const body = Buffer.from(await r.arrayBuffer());
        await route.fulfill({ status: 200, body, headers: { "content-type": r.headers.get("content-type") ?? "application/octet-stream", "cache-control": "no-store" } });
      } catch (err) {
        warn(() => log.warn(`local phone feed failed (${(err as Error).message}) — using the API instead`));
        await route.continue().catch(() => undefined);
      }
    });
  }

  async start(): Promise<void> {
    const o = this.opts;
    this.browser = await chromium.launch({
      headless: true,
      ...(o.chromePath ? { executablePath: o.chromePath } : { channel: "chrome" }),
      args: [...CHROME_ARGS, ...(o.extraArgs ?? [])],
    });
    this.browser.on("disconnected", () => this.exit("Chrome closed unexpectedly"));
    this.context = await this.browser.newContext({
      viewport: { width: STUDIO_WIDTH, height: STUDIO_HEIGHT },
      deviceScaleFactor: 1,
    });
    if (o.cookie) {
      const origin = new URL(o.url).origin;
      await this.context.addCookies([{ name: o.cookie.name, value: o.cookie.value, url: origin, httpOnly: true, sameSite: "Lax" }]);
    }
    if (o.deviceHls) await this.routeDeviceHls(this.context, o.deviceHls);
    await this.context.exposeBinding("__swChunk", async (_src, b64: unknown) => {
      if (typeof b64 === "string" && b64.length) await o.onChunk(Buffer.from(b64, "base64"));
    });
    await this.context.exposeBinding("__swStatus", (_src, s: unknown) => {
      if (s && typeof s === "object") {
        const r = s as Partial<RenderStatus>;
        o.onStatus({ fps: Number(r.fps) || 0, recording: !!r.recording, error: typeof r.error === "string" ? r.error : null });
      }
    });

    const page = await this.context.newPage();
    const consoleLog = rateLimited(10, 30_000);
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") {
        consoleLog((dropped) => log.warn(`page ${m.type()}: ${m.text().slice(0, 300)}`, dropped ? { dropped } : undefined));
      }
    });
    page.on("pageerror", (err) => consoleLog(() => log.warn(`page error: ${err.message.slice(0, 300)}`)));
    page.on("crash", () => this.exit("The render page crashed"));
    page.on("close", () => this.exit("The render page closed"));
    const res = await page.goto(o.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (res && !res.ok()) throw new Error(`Render page answered ${res.status()} (${o.url})`);
  }

  private exit(reason: string) {
    if (this.closing) return;
    this.closing = true;
    this.opts.onExit(reason);
  }

  async stop(): Promise<void> {
    this.closing = true;
    const b = this.browser;
    this.browser = null;
    this.context = null;
    if (!b) return;
    await Promise.race([b.close().catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
  }
}
