import { CalendarCheck, CalendarDays, CalendarRange } from "lucide-react";
import type { Recurrence } from "@7xen/shared";
import { cn } from "@7xen/ui/lib/utils";

const OPTIONS: { value: Recurrence; title: string; text: string; icon: typeof CalendarDays }[] = [
  { value: "ONCE", title: "One-time", text: "A single session on one date.", icon: CalendarCheck },
  { value: "DAILY", title: "Daily", text: "Every day at the same time.", icon: CalendarDays },
  { value: "WEEKENDS", title: "Weekends", text: "Every Saturday and Sunday.", icon: CalendarRange },
];

/** Three big selectable cards for how a scrim repeats. */
export function RecurrencePicker({ value, onChange }: { value: Recurrence; onChange: (r: Recurrence) => void }) {
  return (
    <div role="radiogroup" aria-label="How often it runs" className="grid gap-3 sm:grid-cols-3">
      {OPTIONS.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative flex items-start gap-3 rounded-xl border-2 p-4 text-left transition-all sm:flex-col sm:gap-2",
              active
                ? "border-primary bg-primary/10 shadow-glow"
                : "border-border bg-card hover:-translate-y-0.5 hover:border-primary/40",
            )}
          >
            <span className={cn("rounded-lg p-2", active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
              <Icon className="size-5" />
            </span>
            <span>
              <span className="block font-display text-lg font-bold leading-tight">{o.title}</span>
              <span className="block text-sm text-muted-foreground">{o.text}</span>
            </span>
            <span
              className={cn(
                "absolute top-3 right-3 size-4 rounded-full border-2 transition-all",
                active ? "border-primary bg-primary ring-2 ring-primary/30 ring-offset-2 ring-offset-background" : "border-input",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
