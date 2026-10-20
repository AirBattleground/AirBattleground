import { useId, type CSSProperties } from "react";
import { cn } from "@7xen/ui/lib/utils";

/** Top-down transport plane (nose → right), 160×110. */
export function PlaneSilhouette({ className, contrail = true }: { className?: string; contrail?: boolean }) {
  const id = useId().replace(/:/g, "");
  const engines = [20, 36, 74, 90];
  return (
    <svg aria-hidden viewBox="-260 0 420 110" className={cn("overflow-visible", className)}>
      <defs>
        <linearGradient id={`trail-${id}`} x1="1" x2="0" y1="0" y2="0">
          <stop offset="0" stopColor="var(--foreground)" stopOpacity="0.55" />
          <stop offset="1" stopColor="var(--foreground)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {contrail &&
        engines.map((y) => <rect key={y} x="-250" y={y + 1.5} width="342" height="2" rx="1" fill={`url(#trail-${id})`} />)}
      {/* ground shadow */}
      <g transform="translate(-14 16)" fill="var(--background)" fillOpacity="0.35">
        <Plane />
      </g>
      <g fill="var(--lux-khaki, var(--foreground))" stroke="var(--background)" strokeOpacity="0.5" strokeWidth="1">
        <Plane />
      </g>
      {/* cockpit glint + nav lights */}
      <path d="M140 51 C145 52 146 58 140 59" fill="none" stroke="var(--background)" strokeWidth="2" strokeOpacity="0.6" />
      <circle className="lux-sc-blink" cx="89" cy="6" r="2.4" fill="var(--destructive)" />
      <circle className="lux-sc-blink" cx="89" cy="104" r="2.4" fill="var(--success)" />
    </svg>
  );
}

function Plane() {
  return (
    <>
      <path d="M150 55C150 50 144 47 136 47L30 48 14 51 10 55 14 59 30 62 136 63C144 63 150 60 150 55Z" />
      <path d="M103 48 95 4 84 4 80 48Z M103 62 95 106 84 106 80 62Z" />
      <path d="M33 49 23 30 15 30 18 49Z M33 61 23 80 15 80 18 61Z" />
      {[20, 36, 74, 90].map((y) => (
        <rect key={y} x="92" y={y} width="15" height="5" rx="2" />
      ))}
    </>
  );
}

/**
 * Plane crossing its container on a dashed flight path, with contrails.
 * Position the flight line with `top` (any CSS length) and tilt it with `angle` (deg).
 */
export function AircraftFlyover({
  className,
  top = "22%",
  angle = -6,
  duration = 16,
  delay = 0,
  size = 150,
  path = true,
}: {
  className?: string;
  top?: string;
  angle?: number;
  duration?: number;
  delay?: number;
  /** plane width in px (body, without contrail) */
  size?: number;
  path?: boolean;
}) {
  const style = { top, "--lux-sc-angle": `${angle}deg`, "--lux-sc-plane": `${size}px` } as CSSProperties;
  return (
    <div aria-hidden className={cn("lux-sc-scene lux-sc-flight pointer-events-none", className)} style={style}>
      {path && (
        <div className="lux-sc-flight__path">
          <i />
        </div>
      )}
      <div className="lux-sc-flight__track" style={{ animationDuration: `${duration}s`, animationDelay: `${delay}s` }}>
        <PlaneSilhouette className="lux-sc-flight__plane" />
      </div>
    </div>
  );
}
