import { cn } from "@7xen/ui/lib/utils";
import { pad2, remaining, shortCountdown } from "@/features/team/format";
import { useNow } from "@/features/team/useNow";

export interface CountdownProps {
  /** ISO instant to count down to */
  to: string;
  /** "inline" → "3h 12m" text; "blocks" → big 02 : 14 : 33 segments for hero cards */
  variant?: "inline" | "blocks";
  /** shown once the moment is reached */
  doneText?: string;
  /** accessible label for the blocks variant */
  label?: string;
  className?: string;
}

/** Live countdown. Inline text by default, or big segmented blocks (`variant="blocks"`). */
export function Countdown({ to, variant = "inline", doneText = "Now", label = "Time remaining", className }: CountdownProps) {
  const now = useNow(1000);
  const r = remaining(to, now);
  if (variant === "inline") return <span className={cn("tabular-nums", className)}>{r.totalMs <= 0 ? doneText : shortCountdown(r)}</span>;

  if (r.totalMs <= 0)
    return (
      <div className={cn("inline-flex items-center gap-2 rounded-xl bg-success/15 px-4 py-2 font-display text-lg font-bold text-success", className)}>
        <span className="size-2 animate-pulse rounded-full bg-success" /> {doneText}
      </div>
    );
  const parts: [string, number][] =
    r.days > 0
      ? [
          ["days", r.days],
          ["hrs", r.hours],
          ["min", r.minutes],
        ]
      : [
          ["hrs", r.hours],
          ["min", r.minutes],
          ["sec", r.seconds],
        ];
  return (
    <div className={cn("flex items-end gap-1", className)} role="timer" aria-label={`${label}: ${shortCountdown(r)}`}>
      {parts.map(([unit, v], i) => (
        <div key={unit} className="flex items-end gap-1" aria-hidden>
          {i > 0 && <span className="pb-4 font-display text-xl font-bold text-muted-foreground">:</span>}
          <div className="flex flex-col items-center">
            <span className="min-w-11 rounded-lg border bg-background/70 px-1.5 py-0.5 text-center font-display text-2xl font-bold tabular-nums sm:min-w-12 sm:text-3xl">
              {pad2(v)}
            </span>
            <span className="mt-0.5 text-[9px] font-semibold tracking-widest text-muted-foreground uppercase">{unit}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
