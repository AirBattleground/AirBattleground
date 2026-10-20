import { Check, type LucideIcon } from "lucide-react";
import { cn } from "@7xen/ui/lib/utils";

/** Compact step indicator for the creation wizards: numbered/iconed buttons, ticks for done steps, a red dot for problems. */
export function WizardSteps({ steps, step, onGo, problems, tour }: {
  steps: readonly { key: string; label: string; icon: LucideIcon }[];
  step: number;
  onGo: (i: number) => void;
  problems?: boolean[];
  tour?: string;
}) {
  return (
    <nav aria-label="Steps" data-tour={tour} className="mb-6">
      <ol className="grid gap-1.5 sm:gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s, i) => {
          const Icon = s.icon;
          const active = i === step;
          const done = i < step;
          return (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => onGo(i)}
                aria-current={active ? "step" : undefined}
                aria-label={`Step ${i + 1}: ${s.label}`}
                className={cn(
                  "relative flex min-h-11 w-full flex-col items-center gap-1 rounded-xl border px-1 py-2 text-[11px] font-semibold outline-none transition-all focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:flex-row sm:gap-2.5 sm:px-3 sm:text-sm",
                  active ? "border-primary bg-primary/10 text-foreground" : "bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-lg transition-colors",
                    active ? "bg-primary text-primary-foreground" : done ? "bg-success/15 text-success" : "bg-muted",
                  )}
                >
                  {done ? <Check className="size-4" /> : <Icon className="size-4" />}
                </span>
                <span className="max-w-full truncate">{s.label}</span>
                {problems?.[i] && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-destructive" aria-label="Needs attention" />}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
