/**
 * Phase 6b: draws the broadcast layout as a transparent PNG (OUTPUT_WIDTH × OUTPUT_HEIGHT) with satori (flexbox → SVG)
 * and resvg (SVG → PNG). No browser needed. The compositor puts this image over the phone's video once a second.
 */
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import { OUTPUT_HEIGHT, OUTPUT_WIDTH, type StreamLayoutConfig } from "@7xen/shared";
import type { OverlayData } from "./data.js";

// ---------------------------------------------------------------- fonts / images

/** assets/fonts next to package.json: cwd in Docker (/app) and `pnpm dev`; module-relative as a fallback (bundled → dist/). */
const FONT_DIR =
  [join(process.cwd(), "assets/fonts"), join(dirname(fileURLToPath(import.meta.url)), "../assets/fonts"), join(dirname(fileURLToPath(import.meta.url)), "../../../assets/fonts")].find((d) =>
    existsSync(join(d, "Rajdhani-Bold.ttf")),
  ) ?? join(process.cwd(), "assets/fonts");
let fonts: { name: string; data: Buffer; weight: 500 | 600 | 700; style: "normal" }[] | null = null;
function loadFonts() {
  fonts ??= ([500, 600, 700] as const).map((weight) => ({
    name: "Rajdhani",
    weight,
    style: "normal" as const,
    data: readFileSync(join(FONT_DIR, `Rajdhani-${weight === 500 ? "Medium" : weight === 600 ? "SemiBold" : "Bold"}.ttf`)),
  }));
  return fonts;
}

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const imageCache = new Map<string, string | null>();
/** File → data URI (cached; null when unreadable or a type satori can't draw). */
async function dataUri(path: string | null): Promise<string | null> {
  if (!path) return null;
  if (imageCache.has(path)) return imageCache.get(path)!;
  const mime = MIME[extname(path).toLowerCase()];
  let uri: string | null = null;
  if (mime && mime !== "image/webp") {
    uri = await readFile(path)
      .then((b) => `data:${mime};base64,${b.toString("base64")}`)
      .catch(() => null);
  }
  if (imageCache.size > 300) imageCache.clear();
  imageCache.set(path, uri);
  return uri;
}

// ---------------------------------------------------------------- tiny element builder (satori takes React-like objects)

type Style = Record<string, string | number>;
type Node = { type: string; props: Record<string, unknown> } | string | null | false | undefined;
const h = (type: string, style: Style, ...children: Node[]): Node => ({
  type,
  props: { style: { display: "flex", ...style }, children: children.filter((c) => c !== null && c !== false && c !== undefined) },
});
const img = (src: string, style: Style): Node => ({ type: "img", props: { src, style } });

function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const fmtElapsed = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return hh ? `${hh}:${String(mm).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
};

// ---------------------------------------------------------------- layout

export interface RenderOptions {
  sponsorPaths: string[];
  /** when the broadcast went live (drives the LIVE timer); null = no timer */
  liveSince: Date | null;
  now?: Date;
}

const M = 18; // outer margin
const TITLE_H = 64;
const TICKER_H = 34;

export async function renderOverlay(cfg: StreamLayoutConfig, d: OverlayData, opts: RenderOptions): Promise<Buffer> {
  const accent = cfg.accent;
  const panel = `rgba(8, 12, 16, ${cfg.panelOpacity / 100})`;
  const white = "#f5f7fa";
  const muted = "rgba(245, 247, 250, 0.62)";
  const now = opts.now ?? new Date();

  const [orgLogo, sponsorUris, teamLogos] = await Promise.all([
    cfg.titleBar.showLogo ? dataUri(d.orgLogoPath) : Promise.resolve(null),
    cfg.sponsors.enabled ? Promise.all(opts.sponsorPaths.map(dataUri)) : Promise.resolve([]),
    Promise.all(d.teams.map((t) => dataUri(t.logoPath))),
  ]);

  const topY = M + (cfg.titleBar.enabled ? TITLE_H + 12 : 0);
  const bottomReserve = M + (cfg.ticker.enabled && cfg.ticker.text ? TICKER_H + 10 : 0);
  const logos = sponsorUris.filter((u): u is string => !!u);
  const sponsorsOn = cfg.sponsors.enabled && logos.length > 0;
  const [sponsorV, sponsorH] = cfg.sponsors.corner.split("-") as ["top" | "bottom", "left" | "right"];
  const SPONSOR_H = 52 + 10;
  /** vertical room for a side panel: below the title bar, above the ticker, clear of the sponsor strip in that corner */
  const sideBox = (side: "left" | "right") => {
    const top = topY + (sponsorsOn && sponsorH === side && sponsorV === "top" ? SPONSOR_H : 0);
    const bottom = bottomReserve + (sponsorsOn && sponsorH === side && sponsorV === "bottom" ? SPONSOR_H : 0);
    return { top, height: OUTPUT_HEIGHT - top - bottom };
  };

  // both panels on one side → points move to the other side
  const teamsSide = cfg.teams.side;
  const pointsSide = cfg.teams.enabled && cfg.points.enabled && cfg.points.side === teamsSide ? (teamsSide === "left" ? "right" : "left") : cfg.points.side;

  const nodes: Node[] = [];

  // ---- title bar
  if (cfg.titleBar.enabled) {
    const title = (cfg.titleBar.title || d.title).toUpperCase();
    const info = [cfg.titleBar.showMatchInfo && d.subtitle, cfg.titleBar.showMap && d.mapLabel && d.mapLabel.toUpperCase()].filter(Boolean).join("  •  ");
    nodes.push(
      h(
        "div",
        { position: "absolute", left: M, top: M, height: TITLE_H, alignItems: "center", background: panel, borderRadius: 14, overflow: "hidden", maxWidth: OUTPUT_WIDTH - 2 * M - (cfg.socials.enabled && cfg.socials.text ? 340 : 0) },
        h("div", { width: 6, height: "100%", background: accent }),
        orgLogo && h("div", { width: TITLE_H - 12, height: TITLE_H - 12, marginLeft: 10, borderRadius: 10, background: "#ffffff", alignItems: "center", justifyContent: "center", overflow: "hidden" }, img(orgLogo, { width: TITLE_H - 18, height: TITLE_H - 18, objectFit: "contain" })),
        h(
          "div",
          { flexDirection: "column", justifyContent: "center", padding: "0 18px 0 14px", maxWidth: 760 },
          h("div", { fontSize: 30, fontWeight: 700, color: white, letterSpacing: 1, lineHeight: 1 }, title),
          info && h("div", { fontSize: 17, fontWeight: 600, color: accent, letterSpacing: 1.5, marginTop: 4, lineHeight: 1 }, info),
        ),
        cfg.titleBar.showLiveTimer &&
          opts.liveSince &&
          h(
            "div",
            { alignItems: "center", height: "100%", padding: "0 16px", background: "rgba(220, 38, 38, 0.92)", gap: 8 },
            h("div", { width: 10, height: 10, borderRadius: 10, background: "#ffffff" }),
            h("div", { fontSize: 22, fontWeight: 700, color: "#ffffff", letterSpacing: 1 }, `LIVE  ${fmtElapsed(now.getTime() - opts.liveSince.getTime())}`),
          ),
      ),
    );
  }

  // ---- side panels
  const sidePanel = (side: "left" | "right", width: number, header: string, note: string | null, rows: Node[]) =>
    h(
      "div",
      { position: "absolute", top: sideBox(side).top, [side]: M, width, maxHeight: sideBox(side).height, flexDirection: "column", background: panel, borderRadius: 12, overflow: "hidden" },
      h(
        "div",
        { alignItems: "center", justifyContent: "space-between", padding: "7px 12px", background: rgba(accent, 0.92) },
        h("div", { fontSize: 17, fontWeight: 700, color: "#061014", letterSpacing: 1.5 }, header),
        note && h("div", { fontSize: 13, fontWeight: 700, color: "rgba(6, 16, 20, 0.75)" }, note.toUpperCase()),
      ),
      h("div", { flexDirection: "column", padding: "4px 0" }, ...rows),
    );

  const ROW = 26;
  if (cfg.teams.enabled && d.teams.length) {
    const fit = Math.max(1, Math.min(cfg.teams.maxRows, Math.floor((sideBox(teamsSide).height - 44) / ROW)));
    const shown = d.teams.slice(0, fit);
    nodes.push(
      sidePanel(
        teamsSide,
        250,
        `TEAMS  ·  ${d.teams.length}`,
        null,
        shown.map((t, i) =>
          h(
            "div",
            { height: ROW, alignItems: "center", padding: "0 12px", gap: 8, background: i % 2 ? "rgba(255,255,255,0.04)" : "transparent" },
            h("div", { width: 30, fontSize: 16, fontWeight: 700, color: accent }, `#${String(t.slot).padStart(2, "0")}`),
            teamLogos[d.teams.indexOf(t)]
              ? img(teamLogos[d.teams.indexOf(t)]!, { width: 18, height: 18, borderRadius: 4, objectFit: "cover" })
              : h("div", { width: 18, height: 18, borderRadius: 4, background: rgba(accent, 0.25) }),
            h("div", { flex: 1, fontSize: 16, fontWeight: 600, color: white, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }, t.name),
          ),
        ),
      ),
    );
  }

  if (cfg.points.enabled && d.standings.length) {
    const fit = Math.max(1, Math.min(cfg.points.topN, Math.floor((sideBox(pointsSide).height - 68) / ROW)));
    const rows = d.standings.slice(0, fit);
    nodes.push(
      sidePanel(pointsSide, 300, "POINTS TABLE", d.standingsNote, [
        h(
          "div",
          { height: 22, alignItems: "center", padding: "0 12px", gap: 8, fontSize: 13, fontWeight: 700, color: muted, letterSpacing: 1 },
          h("div", { width: 24 }, "#"),
          h("div", { flex: 1 }, "TEAM"),
          h("div", { width: 40, justifyContent: "flex-end" }, "KILLS"),
          h("div", { width: 40, justifyContent: "flex-end" }, "PTS"),
        ),
        ...rows.map((r, i) =>
          h(
            "div",
            { height: ROW, alignItems: "center", padding: "0 12px", gap: 8, background: i % 2 ? "rgba(255,255,255,0.04)" : "transparent" },
            h("div", { width: 24, fontSize: 16, fontWeight: 700, color: r.rank <= 3 ? accent : muted }, String(r.rank)),
            h("div", { flex: 1, fontSize: 16, fontWeight: 600, color: white, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }, r.name),
            h("div", { width: 40, justifyContent: "flex-end", fontSize: 16, fontWeight: 600, color: muted }, String(r.kills)),
            h("div", { width: 40, justifyContent: "flex-end", fontSize: 17, fontWeight: 700, color: white }, String(r.points)),
          ),
        ),
      ]),
    );
  }

  // ---- ticker
  if (cfg.ticker.enabled && cfg.ticker.text) {
    nodes.push(
      h(
        "div",
        { position: "absolute", left: M, right: M, bottom: M, height: TICKER_H, alignItems: "center", background: panel, borderRadius: 10, overflow: "hidden" },
        h("div", { height: "100%", alignItems: "center", padding: "0 14px", background: accent, fontSize: 16, fontWeight: 700, color: "#061014", letterSpacing: 1.5 }, (d.orgName ?? "NEWS").toUpperCase()),
        h("div", { flex: 1, padding: "0 14px", fontSize: 18, fontWeight: 600, color: white, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }, cfg.ticker.text),
      ),
    );
  }

  // ---- sponsors + socials
  if (sponsorsOn) {
    nodes.push(
      h(
        "div",
        { position: "absolute", [sponsorV]: sponsorV === "top" ? topY : bottomReserve, [sponsorH]: M, gap: 8, padding: 6, background: panel, borderRadius: 10, alignItems: "center" },
        h("div", { fontSize: 11, fontWeight: 700, color: muted, letterSpacing: 1.5, marginRight: 2 }, "POWERED BY"),
        ...logos.map((u) => h("div", { height: 40, padding: "4px 8px", background: "#ffffff", borderRadius: 8, alignItems: "center" }, img(u, { height: 32, maxWidth: 120, objectFit: "contain" }))),
      ),
    );
  }
  if (cfg.socials.enabled && cfg.socials.text) {
    nodes.push(
      h(
        "div",
        { position: "absolute", top: M + (cfg.titleBar.enabled ? (TITLE_H - 30) / 2 : 0), right: M, height: 30, alignItems: "center", padding: "0 12px", background: panel, borderRadius: 15, border: `1.5px solid ${rgba(accent, 0.7)}` },
        h("div", { fontSize: 15, fontWeight: 700, color: white, letterSpacing: 0.5 }, cfg.socials.text),
      ),
    );
  }

  const root = h("div", { position: "relative", width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT, fontFamily: "Rajdhani" }, ...nodes);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svg = await satori(root as any, { width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT, fonts: loadFonts() });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: "original" }, font: { loadSystemFonts: false } }).render().asPng());
}
