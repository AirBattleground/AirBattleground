import { useId } from "react";
import { cn } from "@7xen/ui/lib/utils";

/**
 * The BG coin: gold face with a reeded rim, embossed "BG" and a light sweep. Built from the theme's --warning (gold)
 * so it sits right in light and dark. `shine` adds a slow glint (off under reduced motion).
 */
export function BgCoin({ className, shine = false, title }: { className?: string; shine?: boolean; title?: string }) {
  const id = useId().replace(/:/g, "");
  const face = `bgc-face-${id}`;
  const rim = `bgc-rim-${id}`;
  const glint = `bgc-glint-${id}`;
  const clip = `bgc-clip-${id}`;
  return (
    <svg viewBox="0 0 48 48" className={cn("size-6 shrink-0 drop-shadow-[0_2px_6px_color-mix(in_oklch,var(--warning)_45%,transparent)]", className)} role={title ? "img" : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <defs>
        <radialGradient id={face} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="color-mix(in oklch, var(--warning) 45%, white)" />
          <stop offset="55%" stopColor="var(--warning)" />
          <stop offset="100%" stopColor="color-mix(in oklch, var(--warning) 65%, black)" />
        </radialGradient>
        <linearGradient id={rim} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="color-mix(in oklch, var(--warning) 70%, white)" />
          <stop offset="100%" stopColor="color-mix(in oklch, var(--warning) 55%, black)" />
        </linearGradient>
        <linearGradient id={glint} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="white" stopOpacity="0" />
          <stop offset="50%" stopColor="white" stopOpacity="0.75" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <clipPath id={clip}>
          <circle cx="24" cy="24" r="21" />
        </clipPath>
      </defs>
      {/* rim + reeding */}
      <circle cx="24" cy="24" r="22.5" fill={`url(#${rim})`} />
      <circle cx="24" cy="24" r="21.2" fill="none" stroke="color-mix(in oklch, var(--warning) 50%, black)" strokeOpacity="0.45" strokeWidth="1.6" strokeDasharray="1.1 1.4" />
      {/* face */}
      <circle cx="24" cy="24" r="18.5" fill={`url(#${face})`} />
      <circle cx="24" cy="24" r="16" fill="none" stroke="color-mix(in oklch, var(--warning) 55%, black)" strokeOpacity="0.35" strokeWidth="0.8" />
      {/* embossed BG: dark offset + light top */}
      <text x="24" y="29.6" textAnchor="middle" fontSize="15" fontWeight="900" fontFamily="var(--font-display), system-ui, sans-serif" letterSpacing="-0.5" fill="color-mix(in oklch, var(--warning) 50%, black)" fillOpacity="0.55">
        BG
      </text>
      <text x="24" y="28.6" textAnchor="middle" fontSize="15" fontWeight="900" fontFamily="var(--font-display), system-ui, sans-serif" letterSpacing="-0.5" fill="color-mix(in oklch, var(--warning) 25%, white)">
        BG
      </text>
      {/* glint */}
      <g clipPath={`url(#${clip})`}>
        <g transform="rotate(25 24 24)">
          <rect x={shine ? -30 : 4} y="-6" width="14" height="60" fill={`url(#${glint})`} className={shine ? "bg-coin-glint" : undefined} opacity={shine ? 1 : 0.35} />
        </g>
      </g>
    </svg>
  );
}
