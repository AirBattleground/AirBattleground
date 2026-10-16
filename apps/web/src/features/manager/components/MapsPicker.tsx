import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ArrowUp, Plus, Sparkles, X } from "lucide-react";
import { MAP_LABELS, MAPS, type GameMap } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { cn } from "@7xen/ui/lib/utils";
import { MAP_STYLES } from "./maps";

const MAX_MATCHES = 8;
const CLASSIC: GameMap[] = ["ERANGEL", "MIRAMAR", "SANHOK", "ERANGEL"];

/** Ordered list of matches (one map each) with add / reorder / remove. */
export function MapsPicker({ value, onChange }: { value: GameMap[]; onChange: (maps: GameMap[]) => void }) {
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  const full = value.length >= MAX_MATCHES;

  return (
    <div className="space-y-4">
      {value.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed p-6 text-center text-sm text-muted-foreground">
          No matches yet. Tap a map below to add Match 1.
        </div>
      ) : (
        <ol className="space-y-2">
          <AnimatePresence initial={false}>
            {value.map((m, i) => (
              <motion.li
                layout
                key={`${i}-${m}`}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.18 }}
                className={cn("flex items-center gap-3 rounded-xl border bg-gradient-to-r to-transparent p-2 pl-3", MAP_STYLES[m].solid)}
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-background/80 font-display text-lg font-bold">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Match {i + 1}</span>
                  <span className="block font-display text-lg font-bold leading-tight">{MAP_LABELS[m]}</span>
                </span>
                <div className="flex items-center">
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move match ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move match ${i + 1} down`} disabled={i === value.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove match ${i + 1}`}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => onChange(value.filter((_, k) => k !== i))}
                  >
                    <X />
                  </Button>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm font-medium">
            {full ? `That's the maximum of ${MAX_MATCHES} matches.` : `Add Match ${value.length + 1}:`}
          </p>
          {value.length === 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(CLASSIC)}>
              <Sparkles /> Use classic 4 (Erangel, Miramar, Sanhok, Erangel)
            </Button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {MAPS.map((m) => (
            <button
              key={m}
              type="button"
              disabled={full}
              onClick={() => onChange([...value, m])}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-all hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-40",
                MAP_STYLES[m].chip,
              )}
            >
              <span className={cn("size-2.5 rounded-full", MAP_STYLES[m].dot)} />
              {MAP_LABELS[m]}
              <Plus className="ml-auto size-4 opacity-60" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
