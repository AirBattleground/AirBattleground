import type { CSSProperties } from "react";
import { cn } from "@7xen/ui/lib/utils";

/** A chute with a jumper (or a supply crate). 40×58. */
export function Parachute({ className, crate = false }: { className?: string; crate?: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 40 58" className={className}>
      <path d="M3 18C3 5 37 5 37 18Q33 14.5 28.75 18Q24.5 14.5 20 18Q15.5 14.5 11.25 18Q7 14.5 3 18Z" fill={crate ? "var(--lux-khaki, var(--muted-foreground))" : "var(--primary)"} />
      <path d="M11.25 18Q12 9 20 7.5M28.75 18Q28 9 20 7.5M20 18V7.5" fill="none" stroke="var(--background)" strokeOpacity="0.35" strokeWidth="0.8" />
      <g stroke="var(--foreground)" strokeOpacity="0.55" strokeWidth="0.6">
        <line x1="3" y1="18" x2="20" y2="42" />
        <line x1="11.25" y1="18" x2="20" y2="42" />
        <line x1="28.75" y1="18" x2="20" y2="42" />
        <line x1="37" y1="18" x2="20" y2="42" />
      </g>
      {crate ? (
        <g>
          <rect x="13" y="42" width="14" height="12" rx="1" fill="var(--lux-khaki, var(--muted-foreground))" stroke="var(--background)" strokeOpacity="0.5" />
          <path d="M13 48H27M20 42V54" stroke="var(--background)" strokeOpacity="0.45" />
        </g>
      ) : (
        <g fill="var(--foreground)">
          <circle cx="20" cy="44" r="2.6" />
          <path d="M17.5 47h5l1 7h-7z" />
        </g>
      )}
    </svg>
  );
}

/** x (% of width), start top (%), fall (px), duration (s), delay (s), scale, crate? */
const DROPS: [number, number, number, number, number, number, boolean?][] = [
  [18, 6, 300, 9, 0, 1],
  [34, 2, 340, 10.5, 2.4, 0.8],
  [52, 8, 280, 9.5, 4.8, 1.1, true],
  [66, 0, 360, 11, 1.2, 0.75],
  [80, 10, 260, 8.5, 6, 0.95],
  [44, 4, 320, 10, 7.4, 0.7],
  [72, 5, 300, 9.8, 3.6, 0.85],
  [26, 9, 260, 9.2, 8.6, 0.9, true],
];

/**
 * Staggered chutes descending with a gentle sway, fading out as they land.
 * `count` caps how many (≤ 8), `fall` scales the drop distance (1 = default px values).
 */
export function ParachuteDrop({ className, count = 6, fall = 1 }: { className?: string; count?: number; fall?: number }) {
  return (
    <div aria-hidden className={cn("lux-sc-scene lux-sc-drop pointer-events-none absolute inset-0 overflow-hidden", className)}>
      {DROPS.slice(0, Math.min(count, DROPS.length)).map(([x, y, f, dur, del, s, crate], i) => (
        <div
          key={i}
          className="lux-sc-chute"
          style={{ left: `${x}%`, top: `${y}%`, "--lux-sc-fall": `${Math.round(f * fall)}px`, "--lux-sc-s": s, animationDuration: `${dur}s`, animationDelay: `${del}s` } as CSSProperties}
        >
          <div className="lux-sc-chute__sway" style={{ animationDelay: `${-i * 0.7}s` }}>
            <Parachute crate={crate} className="lux-sc-chute__svg" />
          </div>
        </div>
      ))}
    </div>
  );
}
