# Lux Battle — UI skin brief

Two looks over the **same pages and features** of the web portal (apps/web — team + manager):

| Skin  | Name        | Feel |
|-------|-------------|------|
| teal  | Teal Battle | Current app: sidebar, calm teal. Untouched. |
| lux   | Lux Battle  | Branded esports **site**: everything on top (top navigation), military-tactical graphics, lots of animation. |

The admin picks the look for everyone (admin console → Site look). `?skin=lux` previews it in one tab.

## How it is wired (done — don't change the plumbing)
- `packages/shared/src/skin.ts` — `UiSkin`, endpoints `GET /api/site/skin` (public), `PUT /api/admin/site/skin`.
- `apps/web/index.html` — boot script sets `<html data-skin="teal|lux">` before paint and loads the Lux fonts.
- `apps/web/src/lib/skin.tsx` — `SkinProvider`, `useSkin()` → `{ skin, isLux }`, `<SkinSwitch teal={…} lux={…} />` (lux side lazy-loaded).
  While Lux is on, `FullPageLoader` (from @7xen/ui) renders `src/skins/lux/LuxLoader.tsx` instead of a spinner.
- `apps/web/src/components/shell/AppShell.tsx` — renders `src/skins/lux/shell/LuxShell.tsx` (default export, same `AppShellProps`) under Lux.
- `apps/web/src/skins/lux/index.css` — imported for everyone; imports tokens/components/loaders/shell/scenes .css.
  **Every rule must be scoped** under `:root[data-skin="lux"]` / `[data-skin="lux"] …` so Teal never changes.
- Hooks for CSS: shadcn components carry `data-slot` (card, button, badge, input, tabs-*, dialog-*, skeleton, …);
  brand components now carry `data-slot="page-header" | "page-header-title" | "page-header-eyebrow" |
  "page-header-description" | "page-header-actions" | "stat-card" (+ data-tone) | "empty-state" | "page-loader"`.

## Visual direction: military tactical
- **Dark-first**. Palette (define as tokens, light variant too — light = "desert sand" daylight version):
  - background: near-black olive `oklch(0.15 0.012 120)`; card: olive drab `oklch(0.2 0.018 118)`; popover slightly lighter
  - primary: blaze/tactical orange `oklch(0.72 0.19 50)` with dark ink foreground
  - secondary/khaki: sand `oklch(0.8 0.06 85)` for labels, rules, brackets
  - HUD accent: radar/NV green `oklch(0.82 0.18 145)` (live, online, scanning)
  - destructive: signal red; warning: amber; success: the radar green
  - borders: khaki at ~14% alpha; grid lines khaki ~5%
- **Type**: display `"Black Ops One"` (headings, big numbers, slot numbers); UI `"Chakra Petch"`; mono `"Share Tech Mono"`
  (coordinates, codes, timers). Uppercase eyebrows/labels with wide tracking. Keep body text sentence case & readable.
- **Shape**: angular. Small radius (2–4px), chamfered corners (clip-path) on cards/buttons/badges, HUD corner brackets,
  thin rules, stencil serials ("UNIT-07", "GRID 24-B"), hazard stripes for warnings, subtle camo/topographic texture.
- **Motifs** (graphics "on top" like a branded site): aircraft flyover with dashed flight path, parachute drops,
  shrinking safe-zone circle, radar sweep with blips, crosshair reticle, topographic contour lines, map grid with
  coordinates (A–H / 1–8), scanlines, compass ticks, ticker/marquee strip, dog tags.
- **Motion**: staggered entrance, parallax backgrounds, radar sweeps, flight-path dash animation, "decrypt"/typewriter
  headings, hover target-lock (brackets snap in), glowing live dots. Smooth (cubic-bezier(.16,1,.3,1)), 60fps
  (animate transform/opacity only), and **everything off under `prefers-reduced-motion: reduce`**.
- **No spinners anywhere in Lux.** Loading = graphical animation (radar sweep, aircraft + chutes, scanning bars).

## Non-negotiables (from CLAUDE.md)
- Same features, same routes, same `data-tour` targets. Dead simple for non-technical users: plain words,
  one primary action per screen, big readable slot numbers, mobile responsive (test ~375px and 1440px).
- In TSX use theme tokens (`bg-card`, `text-primary`, `border`, `text-muted-foreground`, `bg-success/15`…) — the Lux
  tokens make them tactical. Raw colours only inside the Lux token definitions / SVG that reads `var(--…)`.
- Pure CSS/SVG/framer-motion (already a dependency). No new npm packages. No external image hosts.
- Lux-only code lives in `apps/web/src/skins/lux/`. Don't edit packages/ui or packages/shared.
- Check: `pnpm --filter @7xen/web typecheck`. Preview: dev server at http://localhost:5173 (`?skin=lux`).
  Screenshots: `pnpm dlx playwright@1.62.1 screenshot --viewport-size=1440,900 "http://localhost:5173/login?skin=lux" /tmp/x.png`.
