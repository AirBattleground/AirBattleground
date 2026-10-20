/**
 * Lux Battle loading animation — replaces every FullPageLoader (and the lazy Lux shell fallback) while Lux is on.
 * No spinner: a radar scope with a rotating sweep, range rings, bearing ticks, blips that light up as the beam passes,
 * and an aircraft crossing on a dashed flight path. Pure SVG + CSS (styles in loaders.css, `lux-loader-*`), all
 * colours from theme tokens. Motion stops under prefers-reduced-motion.
 */

const SWEEP_SECONDS = 2.4;

/** blips: bearing (deg, clockwise from north) + range (0..1); each flashes when the sweep passes its bearing */
const BLIPS = [
  { b: 38, r: 0.62 },
  { b: 112, r: 0.38 },
  { b: 205, r: 0.74 },
  { b: 290, r: 0.5 },
];

const TICKS = Array.from({ length: 72 }, (_, i) => i * 5);

function polar(bearing: number, r: number) {
  const a = ((bearing - 90) * Math.PI) / 180;
  return { x: 100 + Math.cos(a) * r, y: 100 + Math.sin(a) * r };
}

export function LuxLoader({ label, fullscreen }: { label: string; fullscreen?: boolean }) {
  return (
    <div
      data-slot="lux-loader"
      data-fullscreen={fullscreen ? "true" : undefined}
      role="status"
      aria-live="polite"
      className={fullscreen ? "lux-loader flex min-h-dvh items-center justify-center bg-background p-6" : "lux-loader flex min-h-[50vh] items-center justify-center p-6"}
    >
      <div className="flex flex-col items-center gap-5">
        <div className="lux-loader-scope" aria-hidden="true">
          <div className="lux-loader-sweep" style={{ animationDuration: `${SWEEP_SECONDS}s` }} />
          <svg viewBox="0 0 200 200" className="lux-loader-svg">
            {/* range rings */}
            <circle cx="100" cy="100" r="92" className="lux-loader-ring lux-loader-ring-outer" />
            <circle cx="100" cy="100" r="68" className="lux-loader-ring" />
            <circle cx="100" cy="100" r="44" className="lux-loader-ring" />
            <circle cx="100" cy="100" r="20" className="lux-loader-ring" />
            {/* crosshair */}
            <path d="M100 6 V194 M6 100 H194" className="lux-loader-cross" />
            <path d="M33.5 33.5 L166.5 166.5 M166.5 33.5 L33.5 166.5" className="lux-loader-cross lux-loader-cross-diag" />
            {/* bearing ticks */}
            {TICKS.map((t) => {
              const major = t % 30 === 0;
              const a = polar(t, 92);
              const b = polar(t, major ? 84 : 88);
              return <line key={t} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={major ? "lux-loader-tick lux-loader-tick-major" : "lux-loader-tick"} />;
            })}
            {/* cardinal marks */}
            <text x="100" y="20" className="lux-loader-cardinal">N</text>
            <text x="183" y="103" className="lux-loader-cardinal">E</text>
            <text x="100" y="187" className="lux-loader-cardinal">S</text>
            <text x="17" y="103" className="lux-loader-cardinal">W</text>
            {/* flight path + aircraft */}
            <path d="M-10 150 L210 46" className="lux-loader-path" />
            <g className="lux-loader-plane">
              <g transform="rotate(-25.3)">
                <path d="M7 0 L-1 -1.6 L-4 -8 L-6.5 -8 L-4.5 -1.4 L-8 -1.2 L-10 -4 L-11.5 -4 L-10.5 0 L-11.5 4 L-10 4 L-8 1.2 L-4.5 1.4 L-6.5 8 L-4 8 L-1 1.6 Z" />
              </g>
            </g>
            {/* blips */}
            {BLIPS.map((p) => {
              const c = polar(p.b, p.r * 88);
              return (
                <g key={p.b} className="lux-loader-blip" style={{ animationDelay: `${(p.b / 360) * SWEEP_SECONDS}s`, animationDuration: `${SWEEP_SECONDS}s` }}>
                  <circle cx={c.x} cy={c.y} r="3" />
                  <circle cx={c.x} cy={c.y} r="7" className="lux-loader-blip-halo" />
                </g>
              );
            })}
            <circle cx="100" cy="100" r="2.5" className="lux-loader-center" />
          </svg>
          {/* HUD brackets around the scope */}
          <span className="lux-loader-bracket lux-loader-bracket-tl" />
          <span className="lux-loader-bracket lux-loader-bracket-tr" />
          <span className="lux-loader-bracket lux-loader-bracket-bl" />
          <span className="lux-loader-bracket lux-loader-bracket-br" />
        </div>
        <div className="flex flex-col items-center gap-1.5 text-center">
          <div className="lux-loader-status" aria-hidden="true">
            <span className="lux-loader-live" />
            Acquiring target<span className="lux-loader-dots" />
          </div>
          <div className="lux-loader-bar" aria-hidden="true">
            <span />
          </div>
          <span className="lux-loader-label">{label}</span>
        </div>
      </div>
    </div>
  );
}
