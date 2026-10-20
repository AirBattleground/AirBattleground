import { MAP_LABELS, type GameMap } from "@7xen/shared";
import { cn } from "@7xen/ui/lib/utils";

/**
 * Each map gets a distinctive hue so organisers can scan match lists quickly.
 * Uses translucent fills + adaptive text so it reads well in light and dark.
 */
export const MAP_STYLES: Record<GameMap, { chip: string; dot: string; solid: string }> = {
  ERANGEL: { chip: "bg-emerald-500/12 text-emerald-700 border-emerald-500/30 dark:text-emerald-300", dot: "bg-emerald-500", solid: "from-emerald-500/25" },
  MIRAMAR: { chip: "bg-amber-500/15 text-amber-800 border-amber-500/35 dark:text-amber-300", dot: "bg-amber-500", solid: "from-amber-500/25" },
  SANHOK: { chip: "bg-lime-500/15 text-lime-800 border-lime-500/35 dark:text-lime-300", dot: "bg-lime-500", solid: "from-lime-500/25" },
  VIKENDI: { chip: "bg-sky-500/12 text-sky-700 border-sky-500/30 dark:text-sky-300", dot: "bg-sky-500", solid: "from-sky-500/25" },
  LIVIK: { chip: "bg-teal-500/12 text-teal-700 border-teal-500/30 dark:text-teal-300", dot: "bg-teal-500", solid: "from-teal-500/25" },
  KARAKIN: { chip: "bg-orange-500/12 text-orange-700 border-orange-500/30 dark:text-orange-300", dot: "bg-orange-500", solid: "from-orange-500/25" },
  NUSA: { chip: "bg-fuchsia-500/12 text-fuchsia-700 border-fuchsia-500/30 dark:text-fuchsia-300", dot: "bg-fuchsia-500", solid: "from-fuchsia-500/25" },
  RONDO: { chip: "bg-indigo-500/12 text-indigo-700 border-indigo-500/30 dark:text-indigo-300", dot: "bg-indigo-500", solid: "from-indigo-500/25" },
  WAREHOUSE: { chip: "bg-rose-500/12 text-rose-700 border-rose-500/30 dark:text-rose-300", dot: "bg-rose-500", solid: "from-rose-500/25" },
  HANGAR: { chip: "bg-slate-500/12 text-slate-700 border-slate-500/30 dark:text-slate-300", dot: "bg-slate-500", solid: "from-slate-500/25" },
  RUINS: { chip: "bg-yellow-500/15 text-yellow-800 border-yellow-500/35 dark:text-yellow-300", dot: "bg-yellow-500", solid: "from-yellow-500/25" },
  LIBRARY: { chip: "bg-violet-500/12 text-violet-700 border-violet-500/30 dark:text-violet-300", dot: "bg-violet-500", solid: "from-violet-500/25" },
  TOWN: { chip: "bg-cyan-500/12 text-cyan-700 border-cyan-500/30 dark:text-cyan-300", dot: "bg-cyan-500", solid: "from-cyan-500/25" },
};

export function MapChip({ map, index, className }: { map: GameMap; index?: number; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-semibold",
        MAP_STYLES[map].chip,
        className,
      )}
    >
      {index != null && <span className="font-display opacity-70">M{index + 1}</span>}
      {MAP_LABELS[map]}
    </span>
  );
}

export function MapChips({ maps, numbered = false, className }: { maps: GameMap[]; numbered?: boolean; className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {maps.map((m, i) => (
        <MapChip key={`${m}-${i}`} map={m} index={numbered ? i : undefined} />
      ))}
    </div>
  );
}
