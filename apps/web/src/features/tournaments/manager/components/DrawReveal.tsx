import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { FastForward, Hash, Shuffle, Sparkles } from "lucide-react";
import type { GroupDetail } from "@7xen/shared";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { cn } from "@7xen/ui/lib/utils";
import { slot2 } from "@/features/tournaments/shared/format";
import { GROUP_TONES } from "./SchedulePreview";

/**
 * Full-screen draw reveal: teams come out one by one (in draw order), the current one is spotlighted and then
 * lands in its group card. Skippable; respects reduced motion.
 */
export function DrawReveal({ groups, seed, stageName, onDone }: { groups: GroupDetail[]; seed: string | null; stageName: string; onDone: () => void }) {
  const reduce = useReducedMotion();
  const order = useMemo(
    () =>
      groups
        .flatMap((g) => g.teams.map((t) => ({ ...t, groupIndex: g.index, groupName: g.name })))
        .sort((a, b) => (a.seed ?? 9999) - (b.seed ?? 9999) || a.groupIndex - b.groupIndex || a.slotNumber - b.slotNumber),
    [groups],
  );
  const total = order.length;
  const [shown, setShown] = useState(reduce ? total : 0);
  const done = shown >= total;
  const tick = Math.max(28, Math.min(220, Math.floor(4200 / Math.max(1, total))));

  useEffect(() => {
    if (done) return;
    const id = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 500 : tick);
    return () => clearTimeout(id);
  }, [shown, done, tick]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (done ? onDone() : setShown(total));
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [done, onDone, total]);

  const current = order[Math.min(shown, total) - 1];
  const landed = new Set(order.slice(0, shown).map((t) => t.team.id));
  const cols = groups.length <= 2 ? "sm:grid-cols-2" : groups.length <= 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6";

  return createPortal(
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={`${stageName} draw`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] overflow-y-auto bg-background/95 backdrop-blur-xl"
    >
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-60" />
      <div className="relative mx-auto flex min-h-full max-w-7xl flex-col gap-5 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold tracking-[0.2em] text-primary uppercase">
              <Shuffle className="size-3.5" /> {stageName} draw
            </p>
            <p className="font-display text-3xl font-bold" aria-live="polite">
              {done ? "The groups are set!" : `Drawing team ${Math.max(1, shown)} of ${total}…`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {seed && (
              <span className="flex items-center gap-1 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground" title="Same seed → same draw. Anyone can verify it.">
                <Hash className="size-3" /> Seed <span className="font-mono font-semibold text-foreground">{seed}</span>
              </span>
            )}
            {done ? (
              <Button size="lg" onClick={onDone} className="shadow-glow" autoFocus>
                <Sparkles /> See the groups
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setShown(total)}>
                <FastForward /> Skip
              </Button>
            )}
          </div>
        </div>

        {/* spotlight */}
        <div className="flex h-24 items-center justify-center">
          <AnimatePresence mode="popLayout">
            {current && !done && (
              <motion.div
                key={current.team.id}
                initial={{ opacity: 0, scale: 0.6, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.5, y: 60 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                className="flex items-center gap-3 rounded-2xl border border-primary/50 bg-card px-5 py-3 shadow-glow"
              >
                <TeamAvatar name={current.team.name} tag={current.team.tag} />
                <div>
                  <p className="font-display text-xl leading-tight font-bold">{current.team.name}</p>
                  <p className="text-sm text-muted-foreground">
                    → <span className="font-semibold text-primary">Group {current.groupName}</span> · Slot {slot2(current.slotNumber)}
                  </p>
                </div>
              </motion.div>
            )}
            {done && (
              <motion.p key="done" initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="font-display text-5xl font-bold text-gradient-brand">
                {groups.length} groups · {total} teams
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        <div className={cn("grid gap-3", cols)}>
          {groups.map((g) => {
            const teams = [...g.teams].filter((t) => landed.has(t.team.id)).sort((a, b) => a.slotNumber - b.slotNumber);
            const active = current?.groupIndex === g.index && !done;
            return (
              <motion.div
                key={g.id}
                animate={active ? { scale: 1.03 } : { scale: 1 }}
                className={cn("rounded-2xl border bg-card p-3 shadow-sm transition-shadow", active && "shadow-glow", GROUP_TONES[g.index % GROUP_TONES.length]?.split(" ")[0])}
              >
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-display text-lg font-bold">Group {g.name}</p>
                  <span className="font-display text-sm font-bold text-muted-foreground tabular-nums">
                    {teams.length}/{g.teams.length}
                  </span>
                </div>
                <ul className="space-y-1">
                  <AnimatePresence initial={false}>
                    {teams.map((t) => (
                      <motion.li
                        key={t.team.id}
                        layout
                        initial={reduce ? false : { opacity: 0, y: -80, scale: 1.4 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ type: "spring", stiffness: 420, damping: 28 }}
                        className="flex items-center gap-2 rounded-lg bg-muted/50 px-1.5 py-1 text-sm"
                      >
                        <span className="w-8 shrink-0 text-center font-display text-xs font-bold">{slot2(t.slotNumber)}</span>
                        <TeamAvatar name={t.team.name} tag={t.team.tag} size="sm" className="size-5 rounded text-[7px]" />
                        <span className="min-w-0 flex-1 truncate">{t.team.name}</span>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              </motion.div>
            );
          })}
        </div>
      </div>
    </motion.div>,
    document.body,
  );
}
