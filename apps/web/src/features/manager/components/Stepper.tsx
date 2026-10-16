import { Minus, Plus } from "lucide-react";
import { Button } from "@7xen/ui/components/ui/button";
import { cn } from "@7xen/ui/lib/utils";

/** Big −/+ number stepper. */
export function Stepper({ value, onChange, min, max, suffix, className, id }: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  suffix?: string;
  className?: string;
  id?: string;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <div className={cn("inline-flex items-center gap-1 rounded-xl border bg-background p-1", className)}>
      <Button type="button" variant="ghost" size="icon" aria-label="Decrease" disabled={value <= min} onClick={() => onChange(clamp(value - 1))}>
        <Minus />
      </Button>
      <input
        id={id}
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/\D/g, ""));
          if (!Number.isNaN(n)) onChange(clamp(n));
        }}
        className="w-12 bg-transparent text-center font-display text-2xl font-bold outline-none"
      />
      {suffix && <span className="pr-1 text-xs text-muted-foreground">{suffix}</span>}
      <Button type="button" variant="ghost" size="icon" aria-label="Increase" disabled={value >= max} onClick={() => onChange(clamp(value + 1))}>
        <Plus />
      </Button>
    </div>
  );
}
