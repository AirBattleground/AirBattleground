import { useEffect, useRef } from "react";
import { format, parseISO } from "date-fns";
import { todayInAppTz } from "@7xen/shared";
import { cn } from "@7xen/ui/lib/utils";
import { isWeekend } from "../format";

/**
 * Horizontally scrolling row of date "tiles". Weekend days get a subtle marker,
 * today is labelled, and an optional per-date dot shows activity.
 */
export function DateStrip({
  dates,
  value,
  onChange,
  marks,
  className,
}: {
  dates: string[];
  value: string;
  onChange: (date: string) => void;
  /** optional small badge per date (e.g. number of sessions) */
  marks?: Record<string, number | undefined>;
  className?: string;
}) {
  const today = todayInAppTz();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-date="${value}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [value]);

  return (
    <div ref={ref} className={cn("-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]", className)}>
      {dates.map((d) => {
        const active = d === value;
        const weekend = isWeekend(d);
        const mark = marks?.[d];
        const dt = parseISO(d);
        return (
          <button
            key={d}
            type="button"
            data-date={d}
            onClick={() => onChange(d)}
            aria-pressed={active}
            className={cn(
              "relative flex w-16 shrink-0 snap-start flex-col items-center rounded-xl border px-2 py-2.5 transition-all",
              active
                ? "border-primary bg-primary text-primary-foreground shadow-glow"
                : "bg-card hover:-translate-y-0.5 hover:border-primary/40",
              !active && weekend && "border-primary/25 bg-primary/5",
            )}
          >
            <span className={cn("text-[10px] font-semibold uppercase tracking-wider", active ? "text-primary-foreground/80" : weekend ? "text-primary" : "text-muted-foreground")}>
              {d === today ? "Today" : format(dt, "EEE")}
            </span>
            <span className="font-display text-2xl font-bold leading-tight">{format(dt, "d")}</span>
            <span className={cn("text-[10px]", active ? "text-primary-foreground/80" : "text-muted-foreground")}>{format(dt, "MMM")}</span>
            {mark ? (
              <span
                className={cn(
                  "absolute -top-1.5 -right-1.5 grid min-w-5 place-items-center rounded-full px-1 text-[10px] font-bold",
                  active ? "bg-background text-primary" : "bg-primary text-primary-foreground",
                )}
              >
                {mark}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
