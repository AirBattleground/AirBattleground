import { Check, ListChecks, Trophy, Upload } from "lucide-react";
import type { MatchStatus } from "@7xen/shared";
import { cn } from "@7xen/ui/lib/utils";

export type StepKey = "lineup" | "results" | "published";

const STEPS: { key: StepKey; title: string; text: string; icon: typeof Upload }[] = [
  { key: "lineup", title: "Team list", text: "Upload the slot screenshots, check names", icon: ListChecks },
  { key: "results", title: "Results", text: "Upload the final results, check ranks & finishes", icon: Upload },
  { key: "published", title: "Publish", text: "Teams see the scorecard and points table", icon: Trophy },
];

export function stepForStatus(s: MatchStatus): StepKey {
  if (s === "SCHEDULED" || s === "LINEUP_REVIEW") return "lineup";
  if (s === "LIVE" || s === "RESULTS_REVIEW") return "results";
  return "published";
}

const ORDER: StepKey[] = ["lineup", "results", "published"];

/** Big guided 1-2-3 header. Completed steps can be revisited. */
export function MatchStepper({ status, active, onSelect }: { status: MatchStatus; active: StepKey; onSelect: (k: StepKey) => void }) {
  const reached = ORDER.indexOf(stepForStatus(status));
  return (
    <ol data-tour="match-stepper" className="grid gap-2 sm:grid-cols-3">
      {STEPS.map((s, i) => {
        const done = i < reached || status === "PUBLISHED";
        const current = s.key === active;
        const enabled = i <= reached;
        const Icon = s.icon;
        return (
          <li key={s.key}>
            <button
              type="button"
              disabled={!enabled}
              onClick={() => onSelect(s.key)}
              aria-current={current ? "step" : undefined}
              className={cn(
                "relative flex w-full items-center gap-3 overflow-hidden rounded-xl border p-3 text-left outline-none transition-all focus-visible:ring-[3px] focus-visible:ring-ring/50",
                current ? "border-primary bg-primary/10 shadow-glow" : "bg-card hover:border-primary/40",
                !enabled && "cursor-not-allowed opacity-55 hover:border-border",
              )}
            >
              <span
                className={cn(
                  "grid size-10 shrink-0 place-items-center rounded-xl border font-display text-lg font-bold",
                  done ? "border-success/40 bg-success/15 text-success" : current ? "border-primary bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {done ? <Check className="size-5" /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 font-display text-base font-bold">
                  <Icon className="size-4 text-primary" /> {s.title}
                </span>
                <span className="hidden truncate text-xs text-muted-foreground sm:block">{s.text}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
