import type { ReactNode } from "react";
import { cn } from "@7xen/ui/lib/utils";

/** 240° sweep, from -120° (left) to +120° (right), 0° = straight up. */
const SWEEP = 240;
const START = -120;
const R = 80;
const CX = 100;
const CY = 100;

function polar(deg: number, r = R) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

function arc(fromDeg: number, toDeg: number, r = R) {
  const a = polar(fromDeg, r);
  const b = polar(toDeg, r);
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`;
}

const toneOf = (pct: number, warnAt: number, dangerAt: number) => (pct >= dangerAt ? "text-destructive" : pct >= warnAt ? "text-warning" : "text-success");

/**
 * Speedometer: coloured value arc + needle, big reading in the middle. `pct` 0–100 drives the needle;
 * `value`/`unit` is what's printed. Colour bands: green < warnAt ≤ amber < dangerAt ≤ red (`neutral` = always brand).
 */
export function Gauge({ label, pct, value, unit, sub, warnAt = 60, dangerAt = 85, neutral = false, icon, className }: {
  label: string;
  pct: number;
  value: ReactNode;
  unit?: ReactNode;
  sub?: ReactNode;
  warnAt?: number;
  dangerAt?: number;
  neutral?: boolean;
  icon?: ReactNode;
  className?: string;
}) {
  const p = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  const needle = START + (SWEEP * p) / 100;
  const tone = neutral ? "text-primary" : toneOf(p, warnAt, dangerAt);
  const ticks = Array.from({ length: 11 }, (_, i) => START + (SWEEP * i) / 10);
  const band = (from: number, to: number) => arc(START + (SWEEP * from) / 100, START + (SWEEP * to) / 100, R + 11);

  return (
    <div className={cn("flex flex-col items-center rounded-xl border bg-card p-4 shadow-sm", className)}>
      <div className="mb-1 flex items-center gap-1.5 self-start text-xs font-semibold tracking-wider text-muted-foreground uppercase [&_svg]:size-3.5">
        {icon}
        {label}
      </div>
      <div className="relative w-full max-w-[220px]">
        <svg viewBox="0 0 200 172" className="w-full" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p)}>
          {/* thin band ring: where green / amber / red start */}
          {!neutral && (
            <g fill="none" strokeWidth={3} strokeLinecap="round" opacity={0.55}>
              <path d={band(0, warnAt)} className="text-success" stroke="currentColor" />
              <path d={band(warnAt, dangerAt)} className="text-warning" stroke="currentColor" />
              <path d={band(dangerAt, 100)} className="text-destructive" stroke="currentColor" />
            </g>
          )}
          {/* track + value arc */}
          <path d={arc(START, START + SWEEP)} fill="none" strokeWidth={14} strokeLinecap="round" className="text-muted" stroke="currentColor" />
          {p > 0.5 && (
            <path
              d={arc(START, needle)}
              fill="none"
              strokeWidth={14}
              strokeLinecap="round"
              className={cn(tone, "transition-[d] duration-700 ease-out")}
              stroke="currentColor"
              style={{ filter: "drop-shadow(0 0 6px currentColor)" }}
            />
          )}
          {/* ticks */}
          {ticks.map((t, i) => {
            const a = polar(t, R - 13);
            const b = polar(t, R - (i % 5 === 0 ? 22 : 18));
            return <line key={t} x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={i % 5 === 0 ? 2 : 1} className="text-muted-foreground/50" stroke="currentColor" />;
          })}
          {/* needle */}
          <g className="transition-transform duration-700 ease-[cubic-bezier(0.34,1.4,0.64,1)]" style={{ transform: `rotate(${needle}deg)`, transformOrigin: `${CX}px ${CY}px` }}>
            <path d={`M ${CX - 3.5} ${CY} L ${CX} ${CY - R + 18} L ${CX + 3.5} ${CY} Z`} className="text-foreground" fill="currentColor" />
          </g>
          <circle cx={CX} cy={CY} r={8} className="text-foreground" fill="currentColor" />
          <circle cx={CX} cy={CY} r={3.5} className="text-card" fill="currentColor" />
        </svg>
        <div className="pointer-events-none absolute inset-x-0 bottom-1 flex flex-col items-center">
          <div className="font-display text-3xl leading-none font-bold tabular-nums">
            {value}
            {unit && <span className="ml-1 text-base font-semibold text-muted-foreground">{unit}</span>}
          </div>
        </div>
      </div>
      {sub && <div className="mt-1 text-center text-xs text-muted-foreground tabular-nums">{sub}</div>}
    </div>
  );
}
