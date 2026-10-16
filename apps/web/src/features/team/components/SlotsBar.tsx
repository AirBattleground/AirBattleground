import { cn } from "@7xen/ui/lib/utils";

/** "12 of 16 slots filled" with a coloured bar and a plain "4 left" / "Full" label. */
export function SlotsBar({ approved, total, className }: { approved: number; total: number; className?: string }) {
  const filled = Math.min(approved, total);
  const left = Math.max(0, total - filled);
  const pct = total > 0 ? Math.round((filled / total) * 100) : 0;
  const full = left === 0;
  const almost = !full && left <= Math.max(2, Math.ceil(total * 0.2));
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">
          <span className="font-semibold text-foreground">{filled}</span> of {total} slots filled
        </span>
        <span className={cn("font-display text-sm font-bold", full ? "text-destructive" : almost ? "text-warning" : "text-success")}>
          {full ? "Full" : `${left} left`}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={filled} aria-valuemin={0} aria-valuemax={total}>
        <div
          className={cn("h-full rounded-full transition-[width] duration-700 ease-out", full ? "bg-destructive" : almost ? "bg-warning" : "bg-success")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
