import { Minus, Plus } from "lucide-react";
import { DEFAULT_POINTS_SYSTEM, type PointsSystem } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { Label } from "@7xen/ui/components/ui/label";
import { cn } from "@7xen/ui/lib/utils";
import { Stepper } from "@/features/manager/components/Stepper";
import { ordinal } from "@/features/results/components/Rank";
import { Advanced } from "./form";

export const POINTS_PRESETS: { key: string; label: string; hint: string; ps: PointsSystem }[] = [
  { key: "bgmi", label: "BGMI standard", hint: "10/6/5/4/3/2/1/1 · +1 per finish", ps: DEFAULT_POINTS_SYSTEM },
  { key: "pro", label: "Pro league", hint: "15/12/10/8/6/4/2/1/1/1 · +1", ps: { placement: [15, 12, 10, 8, 6, 4, 2, 1, 1, 1], killPoints: 1 } },
  { key: "finish2", label: "Finishes count double", hint: "10/6/5/4/3/2/1/1 · +2", ps: { placement: [10, 6, 5, 4, 3, 2, 1, 1], killPoints: 2 } },
];

export const samePoints = (a: PointsSystem, b: PointsSystem) => a.killPoints === b.killPoints && a.placement.join(",") === b.placement.join(",");

export function pointsLabel(ps: PointsSystem): string {
  return POINTS_PRESETS.find((p) => samePoints(p.ps, ps))?.label ?? `Custom · ${ps.placement.join("/")} · +${ps.killPoints}`;
}

/** Points-system presets with a custom editor tucked under "Advanced". */
export function PointsPicker({ value, onChange }: { value: PointsSystem; onChange: (ps: PointsSystem) => void }) {
  const setPlace = (i: number, n: number) => onChange({ ...value, placement: value.placement.map((v, j) => (j === i ? n : v)) });
  const custom = !POINTS_PRESETS.some((p) => samePoints(p.ps, value));
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Points system">
        {POINTS_PRESETS.map((p) => {
          const on = samePoints(value, p.ps);
          return (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(p.ps)}
              className={cn(
                "rounded-xl border p-3 text-left outline-none transition-all hover:border-primary/50 focus-visible:ring-[3px] focus-visible:ring-ring/50",
                on ? "border-primary bg-primary/10 shadow-glow" : "bg-background",
              )}
            >
              <p className="font-semibold">{p.label}</p>
              <p className="text-xs text-muted-foreground">{p.hint}</p>
            </button>
          );
        })}
      </div>
      <Advanced title={custom ? "Custom points (in use)" : "Custom points"} hint="Set your own placement and finish points" defaultOpen={custom}>
        <div className="space-y-4">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label>Placement points</Label>
              <div className="flex gap-1">
                <Button type="button" size="xs" variant="outline" disabled={value.placement.length <= 1} onClick={() => onChange({ ...value, placement: value.placement.slice(0, -1) })}>
                  <Minus /> Place
                </Button>
                <Button type="button" size="xs" variant="outline" disabled={value.placement.length >= 25} onClick={() => onChange({ ...value, placement: [...value.placement, 0] })}>
                  <Plus /> Place
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
              {value.placement.map((v, i) => (
                <label key={i} className="flex flex-col items-center rounded-lg border bg-background p-1.5 focus-within:border-primary">
                  <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{ordinal(i + 1)}</span>
                  <input
                    inputMode="numeric"
                    aria-label={`Points for ${ordinal(i + 1)} place`}
                    value={v}
                    onChange={(e) => setPlace(i, Math.min(100, Number(e.target.value.replace(/\D/g, "") || 0)))}
                    className="w-full bg-transparent text-center font-display text-xl font-bold outline-none"
                  />
                </label>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Label htmlFor="t-kill-points">Points per finish</Label>
              <p className="text-xs text-muted-foreground">Each kill (finish) adds this many points.</p>
            </div>
            <Stepper id="t-kill-points" value={value.killPoints} onChange={(n) => onChange({ ...value, killPoints: n })} min={0} max={10} />
          </div>
        </div>
      </Advanced>
    </div>
  );
}
