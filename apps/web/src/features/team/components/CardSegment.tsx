import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@7xen/ui/lib/utils";

/** One cell of a `.tc-card` segmented spec strip (label + big value; accent bar fills on card hover). */
export function CardSegment({ icon: Icon, label, value, delay, className }: { icon: LucideIcon; label: string; value: ReactNode; delay: number; className?: string }) {
  return (
    <div className={cn("tc-seg relative min-w-0 px-3 py-2.5", className)} style={{ animationDelay: `${delay}ms` }}>
      <span className="tc-seg-bar absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-primary to-warning" />
      <p className="flex items-center gap-1 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        <Icon className="size-3 text-primary" /> {label}
      </p>
      <div className="mt-0.5 truncate font-display text-base leading-tight font-bold tabular-nums">{value}</div>
    </div>
  );
}

export const HUD_CORNERS = [
  "top-2.5 left-2.5 border-t-2 border-l-2 rounded-tl-lg",
  "top-2.5 right-2.5 border-t-2 border-r-2 rounded-tr-lg",
  "bottom-2.5 left-2.5 border-b-2 border-l-2 rounded-bl-lg",
  "bottom-2.5 right-2.5 border-b-2 border-r-2 rounded-br-lg",
];

/** Corner brackets that grow in on `.tc-card` hover. */
export function HudCorners() {
  return (
    <>
      {HUD_CORNERS.map((c) => (
        <span key={c} aria-hidden className={cn("tc-corner pointer-events-none absolute z-20 size-3 border-[var(--tc-accent)] opacity-0", c)} />
      ))}
    </>
  );
}
