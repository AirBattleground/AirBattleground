import { memo } from "react";

/**
 * Animated tactical backdrop: map grid with A–H / 1–8 coordinates, topographic contours, a drifting
 * safe-zone circle, a slow radar sweep, an occasional aircraft on a dashed flight path, scanlines and a
 * vignette. Fixed behind everything, never interactive. All motion is CSS transforms (shell.css) and is
 * switched off under prefers-reduced-motion.
 */

const COLS = "ABCDEFGH".split("");
const ROWS = [1, 2, 3, 4, 5, 6, 7, 8];

/** Closed, wobbly contour ring around (cx, cy) in a 1000×1000 box. Deterministic (no randomness). */
function ring(cx: number, cy: number, r: number, seed: number) {
  const pts: string[] = [];
  const n = 48;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + 0.12 * Math.sin(a * 3 + seed) + 0.07 * Math.sin(a * 5 + seed * 1.7) + 0.04 * Math.cos(a * 7 + seed * 0.6);
    const x = cx + Math.cos(a) * r * k * 1.25;
    const y = cy + Math.sin(a) * r * k;
    pts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return pts.join(" ") + "Z";
}

const HILLS: { cx: number; cy: number; seed: number; rings: number }[] = [
  { cx: 220, cy: 260, seed: 1.3, rings: 7 },
  { cx: 790, cy: 720, seed: 4.1, rings: 8 },
  { cx: 860, cy: 180, seed: 2.6, rings: 4 },
  { cx: 300, cy: 860, seed: 5.4, rings: 4 },
];

const CONTOURS = HILLS.flatMap((h) => Array.from({ length: h.rings }, (_, i) => ({ d: ring(h.cx, h.cy, 26 + i * 30, h.seed + i * 0.35), major: i % 3 === 2 })));

function Plane() {
  return (
    <svg viewBox="0 0 48 48" className="size-7" aria-hidden>
      <path
        d="M46 24c0-1.4-1.3-2.2-3-2.2H30.5L19 5h-4.5l6 16.8H11L6.8 16H3l2.6 8L3 32h3.8L11 26.2h9.5L14.5 43H19l11.5-16.8H43c1.7 0 3-.8 3-2.2Z"
        fill="currentColor"
      />
    </svg>
  );
}

export const LuxBackdrop = memo(function LuxBackdrop() {
  return (
    <div aria-hidden className="lux-sh-backdrop pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* map grid + coordinates */}
      <div className="lux-sh-bd-grid absolute inset-0" />
      <div className="lux-sh-bd-coords lux-sh-bd-coords-x absolute inset-x-0 bottom-0 hidden font-mono sm:grid">
        {COLS.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <div className="lux-sh-bd-coords lux-sh-bd-coords-y absolute inset-y-0 left-0 hidden font-mono sm:grid">
        {ROWS.map((r) => (
          <span key={r}>{r}</span>
        ))}
      </div>

      {/* topographic contours (slow parallax drift) */}
      <svg className="lux-sh-bd-topo lux-sh-anim absolute -inset-[6%] h-[112%] w-[112%]" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice">
        {CONTOURS.map((c, i) => (
          <path key={i} d={c.d} fill="none" vectorEffect="non-scaling-stroke" className={c.major ? "lux-sh-bd-contour-major" : "lux-sh-bd-contour"} />
        ))}
      </svg>

      {/* drifting, shrinking safe zone */}
      <div className="lux-sh-bd-zone lux-sh-anim absolute">
        <div className="lux-sh-bd-zone-ring" />
        <div className="lux-sh-bd-zone-next" />
      </div>

      {/* radar sweep with blips */}
      <div className="lux-sh-bd-radar absolute">
        <div className="lux-sh-bd-radar-rings" />
        <div className="lux-sh-bd-radar-sweep lux-sh-anim" />
        <span className="lux-sh-bd-blip lux-sh-anim" style={{ left: "62%", top: "30%" }} />
        <span className="lux-sh-bd-blip lux-sh-anim" style={{ left: "28%", top: "58%", animationDelay: "-2.4s" }} />
        <span className="lux-sh-bd-blip lux-sh-anim" style={{ left: "70%", top: "70%", animationDelay: "-4.1s" }} />
      </div>

      {/* aircraft flyover on a dashed flight path */}
      <div className="lux-sh-bd-flight absolute">
        <div className="lux-sh-bd-flight-path lux-sh-anim" />
        <div className="lux-sh-bd-plane lux-sh-anim text-foreground">
          <Plane />
        </div>
      </div>

      <div className="lux-sh-bd-scan absolute inset-0" />
      <div className="lux-sh-bd-vignette absolute inset-0" />
    </div>
  );
});
