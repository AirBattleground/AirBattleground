import { Check } from "lucide-react";
import { POSTER_TEMPLATES, type PosterTemplate } from "@7xen/shared";
import { cn } from "@7xen/ui/lib/utils";
import { POSTER_PRESETS, ScrimPosterArt, type PosterData } from "./ScrimPosterArt";

/** Pick the preset teams see while the scrim has no uploaded poster; each tile previews it with this scrim's details. */
export function PosterPresetPicker({ value, onChange, data, disabled, className }: {
  value: PosterTemplate;
  onChange: (t: PosterTemplate) => void;
  data: Omit<PosterData, "template">;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label="Poster preset" className={cn("grid grid-cols-3 gap-2 sm:gap-3", className)}>
      {POSTER_TEMPLATES.map((t) => {
        const active = t === value;
        const p = POSTER_PRESETS[t];
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`${p.label}: ${p.description}`}
            disabled={disabled}
            onClick={() => onChange(t)}
            className={cn(
              "group flex flex-col gap-1.5 rounded-xl text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60",
            )}
          >
            <span
              className={cn(
                "relative block aspect-square w-full overflow-hidden rounded-xl border-2 transition-all",
                active ? "border-primary shadow-glow" : "border-border group-hover:border-primary/40",
              )}
            >
              <ScrimPosterArt variant="square" data={{ ...data, template: t }} />
              {active && (
                <span className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground shadow">
                  <Check className="size-3.5" />
                </span>
              )}
            </span>
            <span className={cn("px-0.5 text-sm font-semibold", active ? "text-primary" : "text-foreground")}>{p.label}</span>
          </button>
        );
      })}
    </div>
  );
}
