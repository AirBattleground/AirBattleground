import { MAX_WIN_COINS } from "@7xen/shared";
import { BgCoin } from "./BgCoin";
import { Input } from "@7xen/ui/components/ui/input";
import { cn } from "@7xen/ui/lib/utils";

const PRESETS = [0, 50, 100, 250, 500];

/** "BG coins per match win": a number box plus one-tap presets. */
export function WinCoinsInput({ id, value, onChange, invalid }: { id?: string; value: number | undefined; onChange: (v: number) => void; invalid?: boolean }) {
  const v = value ?? 0;
  return (
    <div className="space-y-3">
      <div className="relative w-full sm:w-56">
        <BgCoin className="pointer-events-none absolute top-1/2 left-2.5 size-6 -translate-y-1/2" />
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX_WIN_COINS}
          step={1}
          value={Number.isFinite(v) ? v : ""}
          onChange={(e) => onChange(e.target.value === "" ? 0 : e.target.valueAsNumber)}
          aria-invalid={invalid || undefined}
          className="h-11 pl-10 font-display text-lg font-bold"
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
              v === p ? "border-warning/60 bg-warning/15 text-foreground" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {p === 0 ? "No coins" : `${p} coins`}
          </button>
        ))}
      </div>
    </div>
  );
}

/** "250 BG coins" / "No coins". */
export const coinsLabel = (n: number) => (n > 0 ? `${n.toLocaleString("en-IN")} BG coins` : "No coins");
