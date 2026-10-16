import { useEffect, useState } from "react";
import { Minus, Plus, Settings2 } from "lucide-react";
import { DEFAULT_POINTS_SYSTEM, pointsSystemSchema, type PointsSystem } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { Label } from "@7xen/ui/components/ui/label";
import { cn } from "@7xen/ui/lib/utils";
import { Stepper } from "@/features/manager/components/Stepper";
import { useUpdatePointsSystem } from "../api";
import { ordinal } from "./Rank";

const PRESETS: { key: string; label: string; hint: string; ps: PointsSystem }[] = [
  { key: "bgmi", label: "BGMI standard", hint: "10/6/5/4/3/2/1/1 · +1 per finish", ps: DEFAULT_POINTS_SYSTEM },
  { key: "pro", label: "Pro league", hint: "15/12/10/8/6/4/2/1/1/1 · +1", ps: { placement: [15, 12, 10, 8, 6, 4, 2, 1, 1, 1], killPoints: 1 } },
  { key: "finish2", label: "Finishes count double", hint: "10/6/5/4/3/2/1/1 · +2", ps: { placement: [10, 6, 5, 4, 3, 2, 1, 1], killPoints: 2 } },
];

const same = (a: PointsSystem, b: PointsSystem) => a.killPoints === b.killPoints && a.placement.join(",") === b.placement.join(",");

/** Small dialog for the manager to change the scrim's points system. */
export function PointsSystemDialog({
  open,
  onOpenChange,
  scrimId,
  value,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  scrimId: string;
  value: PointsSystem;
}) {
  const [ps, setPs] = useState<PointsSystem>(value);
  const save = useUpdatePointsSystem(scrimId);
  useEffect(() => {
    if (open) setPs(value);
  }, [open, value]);

  const valid = pointsSystemSchema.safeParse(ps).success;
  const setPlace = (i: number, n: number) => setPs((p) => ({ ...p, placement: p.placement.map((v, j) => (j === i ? n : v)) }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-2xl">
            <Settings2 className="size-5 text-primary" /> Points system
          </DialogTitle>
          <DialogDescription>
            Applies to every session of this scrim. Published results are recalculated straight away.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div>
            <Label className="mb-2 block">Start from a preset</Label>
            <div className="grid gap-2 sm:grid-cols-3">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setPs(p.ps)}
                  aria-pressed={same(ps, p.ps)}
                  className={cn(
                    "rounded-xl border p-3 text-left outline-none transition-all hover:border-primary/50 focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    same(ps, p.ps) ? "border-primary bg-primary/10 shadow-glow" : "bg-background",
                  )}
                >
                  <p className="font-semibold">{p.label}</p>
                  <p className="text-xs text-muted-foreground">{p.hint}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label>Placement points</Label>
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={ps.placement.length <= 1}
                  onClick={() => setPs((p) => ({ ...p, placement: p.placement.slice(0, -1) }))}
                >
                  <Minus /> Place
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={ps.placement.length >= 25}
                  onClick={() => setPs((p) => ({ ...p, placement: [...p.placement, 0] }))}
                >
                  <Plus /> Place
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {ps.placement.map((v, i) => (
                <label key={i} className="flex flex-col items-center rounded-lg border bg-background p-1.5 focus-within:border-primary">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{ordinal(i + 1)}</span>
                  <input
                    inputMode="numeric"
                    aria-label={`Points for ${ordinal(i + 1)} place`}
                    value={v}
                    onChange={(e) => {
                      const n = Number(e.target.value.replace(/\D/g, "") || 0);
                      setPlace(i, Math.min(100, n));
                    }}
                    className="w-full bg-transparent text-center font-display text-xl font-bold outline-none"
                  />
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">Places after {ordinal(ps.placement.length)} get 0.</p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Label htmlFor="kill-points">Points per finish</Label>
              <p className="text-xs text-muted-foreground">Each kill (finish) adds this many points.</p>
            </div>
            <Stepper id="kill-points" value={ps.killPoints} onChange={(n) => setPs((p) => ({ ...p, killPoints: n }))} min={0} max={10} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!valid || save.isPending || same(ps, value)}
            onClick={() => save.mutate(ps, { onSuccess: () => onOpenChange(false) })}
          >
            {save.isPending ? "Saving…" : "Save points system"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
