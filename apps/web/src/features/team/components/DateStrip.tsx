import { useEffect, useMemo, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { addDays } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { Calendar } from "@7xen/ui/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@7xen/ui/components/ui/popover";
import { cn } from "@7xen/ui/lib/utils";
import { formatDate, isWeekend } from "../format";

const STRIP_DAYS = 14;

/**
 * Horizontal strip of day pills (today + next 13 days) with a calendar popover for
 * further dates. Scrolls with snap on phones; arrows on larger screens.
 */
export function DateStrip({
  value,
  today,
  onChange,
  className,
  counts,
  onUpcoming,
}: {
  /** selected day; "" = the Upcoming pill is selected */
  value: string;
  today: string;
  onChange: (date: string) => void;
  className?: string;
  /** scrims per day (badge on the pill); missing = unknown */
  counts?: Map<string, number | undefined>;
  /** shows an "Upcoming" pill first that selects the multi-day view */
  onUpcoming?: () => void;
}) {
  const days = useMemo(() => Array.from({ length: STRIP_DAYS }, (_, i) => addDays(today, i)), [today]);
  const upcoming = value === "";
  const inStrip = upcoming || days.includes(value);
  const calValue = upcoming ? today : value;
  const scroller = useRef<HTMLDivElement>(null);
  const [calOpen, setCalOpen] = useState(false);

  // keep the selected pill in view
  useEffect(() => {
    const c = scroller.current;
    const el = c?.querySelector<HTMLElement>(`[data-date="${value}"]`);
    if (c && el) c.scrollTo({ left: el.offsetLeft - c.clientWidth / 2 + el.clientWidth / 2, behavior: "smooth" });
  }, [value]);

  const scrollBy = (dir: 1 | -1) => scroller.current?.scrollBy({ left: dir * 320, behavior: "smooth" });

  return (
    <div className={cn("flex items-stretch gap-2", className)} data-tour="date-strip">
      <Button variant="ghost" size="icon" className="hidden h-auto shrink-0 sm:inline-flex" onClick={() => scrollBy(-1)} aria-label="Earlier days">
        <ChevronLeft />
      </Button>

      <div
        ref={scroller}
        role="listbox"
        aria-label="Pick a day"
        className="relative -mx-1 flex min-w-0 flex-1 snap-x snap-mandatory gap-2 overflow-x-auto scroll-smooth px-1 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {onUpcoming && (
          <button
            type="button"
            role="option"
            aria-selected={upcoming}
            data-date=""
            onClick={onUpcoming}
            className={cn(
              "flex w-[5.5rem] shrink-0 snap-start flex-col items-center justify-center gap-0.5 rounded-2xl border px-2 py-2.5 transition-all duration-200 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              upcoming ? "-translate-y-0.5 border-primary bg-primary text-primary-foreground shadow-glow" : "bg-card hover:border-primary/40 hover:bg-accent/50",
            )}
          >
            <span className={cn("text-[10px] font-semibold tracking-wider uppercase", upcoming ? "text-primary-foreground/90" : "text-primary")}>Next 7</span>
            <span className="font-display text-xl leading-tight font-bold">Upcoming</span>
          </button>
        )}
        {days.map((d, i) => {
          const selected = d === value;
          const n = counts?.get(d);
          const weekend = isWeekend(d);
          const top = i === 0 ? "Today" : i === 1 ? "Tomorrow" : formatDate(d, "EEE");
          return (
            <button
              key={d}
              type="button"
              role="option"
              aria-selected={selected}
              data-date={d}
              onClick={() => onChange(d)}
              className={cn(
                "group relative flex w-[4.5rem] shrink-0 snap-start flex-col items-center rounded-2xl border px-2 py-2.5 transition-all duration-200 outline-none",
                "focus-visible:ring-[3px] focus-visible:ring-ring/50",
                selected
                  ? "border-primary bg-primary text-primary-foreground shadow-glow -translate-y-0.5"
                  : weekend
                    ? "border-primary/25 bg-accent/60 hover:border-primary/50 hover:bg-accent"
                    : "bg-card hover:border-primary/40 hover:bg-accent/50",
              )}
            >
              <span
                className={cn(
                  "text-[10px] font-semibold uppercase tracking-wider",
                  selected ? "text-primary-foreground/90" : i < 2 ? "text-primary" : weekend ? "text-accent-foreground" : "text-muted-foreground",
                )}
              >
                {top}
              </span>
              <span className="font-display text-3xl leading-tight font-bold tabular-nums">{format(parseISO(d), "d")}</span>
              <span className={cn("text-[11px] font-medium", selected ? "text-primary-foreground/85" : "text-muted-foreground")}>
                {i < 2 ? formatDate(d, "EEE, MMM") : formatDate(d, "MMM")}
              </span>
              {weekend && !selected && n == null && <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary/70" aria-hidden />}
              {n != null && n > 0 && (
                <span
                  aria-label={`${n} ${n === 1 ? "scrim" : "scrims"}`}
                  className={cn(
                    "absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold ring-2 ring-background",
                    selected ? "bg-primary-foreground text-primary" : "bg-primary text-primary-foreground",
                  )}
                >
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <Button variant="ghost" size="icon" className="hidden h-auto shrink-0 sm:inline-flex" onClick={() => scrollBy(1)} aria-label="Later days">
        <ChevronRight />
      </Button>

      <Popover open={calOpen} onOpenChange={setCalOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-tour="date-calendar"
            className={cn(
              "my-2 flex w-[4.5rem] shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border border-dashed px-2 text-xs font-semibold transition-colors",
              !inStrip ? "border-solid border-primary bg-primary text-primary-foreground shadow-glow" : "hover:border-primary/50 hover:bg-accent/50",
            )}
            aria-label="Pick another date"
          >
            <CalendarDays className="size-5" />
            {inStrip ? "More" : formatDate(value, "d MMM")}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-0">
          <Calendar
            mode="single"
            selected={upcoming ? undefined : parseISO(calValue)}
            defaultMonth={parseISO(calValue)}
            disabled={{ before: parseISO(today) }}
            onSelect={(d) => {
              if (!d) return;
              onChange(format(d, "yyyy-MM-dd"));
              setCalOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
