import { Check } from "lucide-react";
import type { MatchStatus } from "@7xen/shared";
import { cn } from "@7xen/ui/lib/utils";

export type StepKey = "lineup" | "results" | "published";

const STEPS: { key: StepKey; title: string }[] = [
  { key: "lineup", title: "Team list" },
  { key: "results", title: "Results" },
  { key: "published", title: "Publish" },
];

export function stepForStatus(s: MatchStatus): StepKey {
  if (s === "SCHEDULED" || s === "LINEUP_REVIEW") return "lineup";
  if (s === "LIVE" || s === "RESULTS_REVIEW") return "results";
  return "published";
}

const ORDER: StepKey[] = ["lineup", "results", "published"];

/** Compact 1-2-3 progress bar. Completed steps can be revisited. */
export function MatchStepper({ status, active, onSelect }: { status: MatchStatus; active: StepKey; onSelect: (k: StepKey) => void }) {
  const reached = ORDER.indexOf(stepForStatus(status));
  return (
    <ol data-tour="match-stepper" className="grid grid-cols-3 gap-1.5 rounded-xl border bg-card p-1.5 shadow-sm">
      {STEPS.map((s, i) => {
        const done = i < reached || status === "PUBLISHED";
        const current = s.key === active;
        const enabled = i <= reached;
        return (
          <li key={s.key}>
            <button
              type="button"
              disabled={!enabled}
              onClick={() => onSelect(s.key)}
              aria-current={current ? "step" : undefined}
              className={cn(
                "flex h-11 w-full items-center justify-center gap-2 rounded-lg px-2 text-sm font-semibold outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                current ? "bg-primary text-primary-foreground shadow-glow" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                !enabled && "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full font-display text-xs font-bold",
                  current ? "bg-primary-foreground/20" : done ? "bg-success/15 text-success" : "bg-muted",
                )}
              >
                {done && !current ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className="truncate">{s.title}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
