import { cn } from "@7xen/ui/lib/utils";

/** Blips as [angle°, distance 0–1]; each lights up as the sweep passes over it. */
const DEFAULT_BLIPS: [number, number][] = [
  [38, 0.62],
  [112, 0.38],
  [205, 0.74],
  [290, 0.5],
];
const SWEEP_S = 4;

/** Radar/NV scope: rings, cross hairs, rotating sweep, blips that glow when swept. Square — size it with className. */
export function RadarScope({ className, blips = DEFAULT_BLIPS }: { className?: string; blips?: [number, number][] }) {
  return (
    <div aria-hidden className={cn("lux-sc-scene lux-sc-radar pointer-events-none relative aspect-square rounded-full", className)}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full">
        <g fill="none" stroke="var(--success)" strokeOpacity="0.35">
          <circle cx="50" cy="50" r="49" strokeOpacity="0.6" />
          <circle cx="50" cy="50" r="36" />
          <circle cx="50" cy="50" r="23" />
          <circle cx="50" cy="50" r="10" />
          <line x1="50" y1="1" x2="50" y2="99" strokeOpacity="0.22" />
          <line x1="1" y1="50" x2="99" y2="50" strokeOpacity="0.22" />
        </g>
      </svg>
      <div className="lux-sc-radar__sweep absolute inset-0 rounded-full" style={{ animationDuration: `${SWEEP_S}s` }} />
      {blips.map(([deg, dist], i) => {
        const rad = ((deg - 90) * Math.PI) / 180;
        return (
          <span
            key={i}
            className="lux-sc-radar__blip"
            style={{
              left: `${50 + Math.cos(rad) * dist * 48}%`,
              top: `${50 + Math.sin(rad) * dist * 48}%`,
              // sweep starts at 12 o'clock and turns clockwise → light the blip when the beam reaches its angle
              animationDelay: `${(deg / 360) * SWEEP_S - SWEEP_S}s`,
              animationDuration: `${SWEEP_S}s`,
            }}
          />
        );
      })}
    </div>
  );
}
