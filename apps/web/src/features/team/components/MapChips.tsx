import { MAP_LABELS, type GameMap } from "@7xen/shared";
import { cn } from "@7xen/ui/lib/utils";

/** Per-map tint, built only from theme tokens so it works in light and dark. */
const MAP_TONE: Record<GameMap, string> = {
  ERANGEL: "bg-info/10 text-info border-info/30",
  MIRAMAR: "bg-warning/15 text-warning-foreground dark:text-warning border-warning/40",
  SANHOK: "bg-success/10 text-success border-success/30",
  VIKENDI: "bg-muted text-foreground border-border",
  LIVIK: "bg-chart-5/10 text-chart-5 border-chart-5/30",
  KARAKIN: "bg-primary/10 text-primary border-primary/30",
  NUSA: "bg-chart-2/10 text-chart-2 border-chart-2/30",
  RONDO: "bg-destructive/10 text-destructive border-destructive/30",
};

const MAP_DOT: Record<GameMap, string> = {
  ERANGEL: "bg-info",
  MIRAMAR: "bg-warning",
  SANHOK: "bg-success",
  VIKENDI: "bg-muted-foreground",
  LIVIK: "bg-chart-5",
  KARAKIN: "bg-primary",
  NUSA: "bg-chart-2",
  RONDO: "bg-destructive",
};

export function MapChip({ map, index, className }: { map: GameMap; index?: number; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2 py-1 text-xs font-semibold",
        MAP_TONE[map],
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", MAP_DOT[map])} />
      {index != null && <span className="font-display opacity-70">M{index + 1}</span>}
      {MAP_LABELS[map]}
    </span>
  );
}

/** One chip per match, in order ("M1 Erangel", "M2 Miramar", …). */
export function MapChips({ maps, className, numbered = true }: { maps: GameMap[]; className?: string; numbered?: boolean }) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {maps.map((m, i) => (
        <MapChip key={`${m}-${i}`} map={m} index={numbered && maps.length > 1 ? i : undefined} />
      ))}
    </div>
  );
}

/** Compact one-line map list ("● Erangel  ● Miramar  ● Sanhok") for dense rows. */
export function MapDots({ maps, className }: { maps: GameMap[]; className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-x-2.5 overflow-hidden whitespace-nowrap text-xs font-medium text-muted-foreground", className)}>
      {maps.map((m, i) => (
        <span key={`${m}-${i}`} className="inline-flex shrink-0 items-center gap-1">
          <span className={cn("size-1.5 rounded-full", MAP_DOT[m])} />
          {MAP_LABELS[m]}
        </span>
      ))}
    </span>
  );
}
