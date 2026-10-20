import { cn } from "@7xen/ui/lib/utils";

const COLS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const ROWS = ["1", "2", "3", "4", "5", "6", "7", "8"];

/** 8×8 tactical map grid with A–H / 1–8 coordinates along the top and left edges. */
export function MapGrid({ className, labels = true }: { className?: string; labels?: boolean }) {
  return (
    <div aria-hidden className={cn("lux-sc-scene lux-sc-mapgrid pointer-events-none absolute inset-0", className)}>
      {labels && (
        <>
          <div className="lux-sc-mapgrid__cols font-mono">
            {COLS.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          <div className="lux-sc-mapgrid__rows font-mono">
            {ROWS.map((r) => (
              <span key={r}>{r}</span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
