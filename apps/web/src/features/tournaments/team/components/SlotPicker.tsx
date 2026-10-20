import { useMemo } from "react";
import { AnimatePresence, motion, Reorder, useDragControls } from "framer-motion";
import { ArrowDown, ArrowUp, Check, Clock, GripVertical, Plus, Sparkles, X } from "lucide-react";
import type { TimeSlotOption } from "@7xen/shared";
import { cn } from "@7xen/ui/lib/utils";
import { fmtTime, useTournamentFormat } from "../../shared/format";
import { useT } from "@/i18n/core";
import { ordFor } from "@/i18n/tournaments";
import { tHub } from "@/i18n/tournamentsHub";

type SlotOptionWithTaken = TimeSlotOption & { taken: number };

function RankedRow({
  opt,
  index,
  count,
  disabled,
  onMove,
  onRemove,
}: {
  opt: SlotOptionWithTaken;
  index: number;
  count: number;
  disabled?: boolean;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const controls = useDragControls();
  const th = useT(tHub);
  const { fmtDay } = useTournamentFormat();
  return (
    <Reorder.Item
      value={opt.id}
      dragListener={false}
      dragControls={controls}
      className="relative flex items-center gap-2 rounded-xl border border-primary/30 bg-card p-2 shadow-sm"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileDrag={{ scale: 1.02, boxShadow: "0 10px 30px -10px var(--glow)" }}
    >
      <button
        type="button"
        disabled={disabled}
        onPointerDown={(e) => !disabled && controls.start(e)}
        className="flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted-foreground hover:bg-accent active:cursor-grabbing disabled:opacity-40"
        aria-label={th("sp_drag", { label: opt.label })}
        tabIndex={-1}
      >
        <GripVertical className="size-4" />
      </button>
      <span className="flex h-8 min-w-10 shrink-0 items-center justify-center rounded-lg bg-primary px-1.5 font-display text-sm font-bold text-primary-foreground">
        {ordFor(th.lang, index + 1)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-base leading-tight font-bold">{fmtTime(opt.id)}</span>
        <span className="block truncate text-xs text-muted-foreground">{fmtDay(opt.id)}</span>
      </span>
      <span className="flex shrink-0 items-center">
        <button
          type="button"
          disabled={disabled || index === 0}
          onClick={() => onMove(-1)}
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-30"
          aria-label={th("sp_up", { label: opt.label })}
        >
          <ArrowUp className="size-4" />
        </button>
        <button
          type="button"
          disabled={disabled || index === count - 1}
          onClick={() => onMove(1)}
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-30"
          aria-label={th("sp_down", { label: opt.label })}
        >
          <ArrowDown className="size-4" />
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onRemove}
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-destructive/10 hover:text-destructive focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-30"
          aria-label={th("sp_remove", { label: opt.label })}
        >
          <X className="size-4" />
        </button>
      </span>
    </Reorder.Item>
  );
}

interface SlotPickerProps {
  options: SlotOptionWithTaken[];
  /** option ids in preference order; [] = any time works */
  value: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
}

/** Rank the time slots you can play: tap to add in order, drag or use arrows to reorder, or pick "Any time works". */
export function SlotPicker({ options, value, onChange, disabled }: SlotPickerProps) {
  const th = useT(tHub);
  const { fmtDay } = useTournamentFormat();
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const ranked = value.filter((id) => byId.has(id));
  const anyTime = ranked.length === 0;
  const days = useMemo(() => {
    const m = new Map<string, SlotOptionWithTaken[]>();
    for (const o of [...options].sort((a, b) => a.id.localeCompare(b.id))) {
      const list = m.get(o.date) ?? [];
      list.push(o);
      m.set(o.date, list);
    }
    return [...m.entries()];
  }, [options]);

  const toggle = (id: string) => onChange(ranked.includes(id) ? ranked.filter((x) => x !== id) : [...ranked, id]);
  const move = (i: number, dir: -1 | 1) => {
    const next = [...ranked];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };

  return (
    <div className="space-y-3" data-tour="slot-picker">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange([])}
        aria-pressed={anyTime}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl border p-3 text-left outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60",
          anyTime ? "border-primary/50 bg-primary/10" : "hover:bg-accent/40",
        )}
      >
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", anyTime ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
          {anyTime ? <Check className="size-5" /> : <Sparkles className="size-5" />}
        </span>
        <span className="min-w-0">
          <span className="block font-semibold">{th("sp_any")}</span>
          <span className="block text-xs text-muted-foreground">{th("sp_any_hint")}</span>
        </span>
      </button>

      <AnimatePresence initial={false}>
        {ranked.length > 0 && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <p className="mb-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">{th("sp_order")}</p>
            <Reorder.Group axis="y" values={ranked} onReorder={onChange} className="space-y-1.5">
              <AnimatePresence initial={false}>
                {ranked.map((id, i) => (
                  <RankedRow
                    key={id}
                    opt={byId.get(id)!}
                    index={i}
                    count={ranked.length}
                    disabled={disabled}
                    onMove={(d) => move(i, d)}
                    onRemove={() => toggle(id)}
                  />
                ))}
              </AnimatePresence>
            </Reorder.Group>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="space-y-2.5">
        <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          {ranked.length ? th("sp_tap_more") : th("sp_tap_first")}
        </p>
        {days.map(([date, opts]) => (
          <div key={date}>
            <p className="mb-1 text-xs font-semibold text-foreground/80">{fmtDay(opts[0]!.id)}</p>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-1.5">
              {opts.map((o) => {
                const pos = ranked.indexOf(o.id);
                const picked = pos >= 0;
                const left = Math.max(0, o.capacity - o.taken);
                const full = left === 0;
                return (
                  <button
                    key={o.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => toggle(o.id)}
                    aria-pressed={picked}
                    aria-label={`${o.label}${picked ? th("sp_aria_choice", { rank: ordFor(th.lang, pos + 1) }) : ""}${full ? th("sp_aria_popular") : th.plural("sp_aria_spots", left)}`}
                    className={cn(
                      "relative flex flex-col items-start rounded-xl border px-3 py-2 text-left outline-none transition-all focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.97] disabled:opacity-60",
                      picked ? "border-primary bg-primary/10 shadow-glow" : "bg-card hover:border-primary/40",
                    )}
                  >
                    <span className="flex w-full items-center justify-between gap-1">
                      <span className="flex items-center gap-1 font-display text-base font-bold whitespace-nowrap">
                        <Clock className="size-3.5 text-primary" /> {fmtTime(o.id)}
                      </span>
                      {picked ? (
                        <span className="rounded-full bg-primary px-1.5 font-display text-xs font-bold text-primary-foreground">{ordFor(th.lang, pos + 1)}</span>
                      ) : (
                        <Plus className="size-3.5 text-muted-foreground" />
                      )}
                    </span>
                    <span className={cn("text-[11px]", full ? "text-warning-foreground dark:text-warning" : "text-muted-foreground")}>
                      {full ? th("sp_popular") : th("sp_spots_of", { left, cap: o.capacity })}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
