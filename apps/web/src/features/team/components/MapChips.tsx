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
  WAREHOUSE: "bg-chart-1/10 text-chart-1 border-chart-1/30",
  HANGAR: "bg-chart-3/10 text-chart-3 border-chart-3/30",
  RUINS: "bg-chart-4/10 text-chart-4 border-chart-4/30",
  LIBRARY: "bg-chart-2/10 text-chart-2 border-chart-2/30",
  TOWN: "bg-chart-5/10 text-chart-5 border-chart-5/30",
};

/** keep in step with the poster presets' MAP_HEX (features/posters/ScrimPosterArt.tsx) */
const MAP_DOT: Record<GameMap, string> = {
  ERANGEL: "bg-info",
  MIRAMAR: "bg-warning",
  SANHOK: "bg-success",
  VIKENDI: "bg-muted-foreground",
  LIVIK: "bg-chart-5",
  KARAKIN: "bg-primary",
  NUSA: "bg-chart-2",
  RONDO: "bg-destructive",
  WAREHOUSE: "bg-chart-1",
  HANGAR: "bg-chart-3",
  RUINS: "bg-chart-4",
  LIBRARY: "bg-chart-2",
  TOWN: "bg-chart-5",
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

/**
 * A scrim's matches in a tight row: one or two show their map names; more become one map-coloured bar per match +
 * "N matches" (names on hover / for screen readers, and in the card's match-times ⓘ).
 */
export function MatchBars({ maps, label, className }: { maps: GameMap[]; label: string; className?: string }) {
  if (maps.length <= 2) return <MapDots maps={maps} className={className} />;
  const names = maps.map((m) => MAP_LABELS[m]).join(", ");
  return (
    <span className={cn("flex min-w-0 items-center gap-2 text-xs font-medium whitespace-nowrap text-muted-foreground", className)} title={names}>
      <span aria-hidden className="flex shrink-0 items-center gap-0.5">
        {maps.map((m, i) => (
          <span key={`${m}-${i}`} className={cn("h-1.5 w-3 rounded-full", MAP_DOT[m])} />
        ))}
      </span>
      <span className="truncate">{label}</span>
      <span className="sr-only">: {names}</span>
    </span>
  );
}
