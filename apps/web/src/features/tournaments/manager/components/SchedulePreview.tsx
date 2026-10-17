import type { ReactNode } from "react";
import { useMemo } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, CalendarRange, Clock3, Lightbulb, Sparkles, Ticket, Wand2 } from "lucide-react";
import { MAP_LABELS, type ScheduleBlock, type ScheduleConfig, type SchedulePlan } from "@7xen/shared";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@7xen/ui/components/ui/tooltip";
import { cn } from "@7xen/ui/lib/utils";
import { formatDate, formatTime } from "@/features/manager/format";
import { groupName } from "../engine";
import { hm, plural, timeRange, toMinutes } from "../format";
import { suggestionPatch } from "../suggestions";

/** Per-group colours (theme chart tokens — fine in light & dark). */
export const GROUP_TONES = [
  "border-chart-1/60 bg-chart-1/20",
  "border-chart-2/60 bg-chart-2/20",
  "border-chart-3/60 bg-chart-3/20",
  "border-chart-4/60 bg-chart-4/20",
  "border-chart-5/60 bg-chart-5/20",
  "border-primary/60 bg-primary/15",
  "border-info/60 bg-info/15",
  "border-success/60 bg-success/15",
];

/**
 * Live result of planSchedule: evenings needed, one-click fixes, a per-day Gantt (one row per lobby) and the
 * time slots teams will choose from when they register.
 */
export function SchedulePreview({ plan, config, groupCount, onApply, showSlots = true, className }: {
  plan: SchedulePlan | null;
  config: ScheduleConfig;
  groupCount: number;
  onApply?: (next: ScheduleConfig) => void;
  showSlots?: boolean;
  className?: string;
}) {
  const days = useMemo(() => {
    if (!plan) return [];
    const by = new Map<string, ScheduleBlock[]>();
    for (const b of plan.blocks) by.set(b.date, [...(by.get(b.date) ?? []), b]);
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [plan]);

  if (!plan)
    return (
      <div className={cn("space-y-3", className)}>
        <div className="flex items-center gap-2 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          <Sparkles className="size-4 shrink-0 text-primary" /> The schedule preview is warming up — it will appear here in a moment. You can keep filling in the times.
        </div>
        <Skeleton className="h-28 rounded-xl" />
      </div>
    );

  const unscheduled = plan.unscheduledGroups.length;
  const fixes = plan.suggestions.map((s) => ({ text: s, next: onApply ? suggestionPatch(s, config) : null }));

  return (
    <div className={cn("space-y-5", className)}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat icon={<CalendarRange />} label={plan.days === 1 ? "Evening needed" : "Evenings needed"} value={plan.days} tone={unscheduled ? "warn" : "ok"} />
        <Stat icon={<Clock3 />} label="Groups scheduled" value={`${groupCount - unscheduled}/${groupCount}`} tone={unscheduled ? "bad" : "ok"} />
        <Stat icon={<Ticket />} label="Time slots for teams" value={plan.slotOptions.length} />
      </div>

      {unscheduled > 0 && (
        <p role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span>
            <span className="font-semibold">{plural(unscheduled, "group")} don't fit</span> ({plan.unscheduledGroups.map((g) => `Group ${groupName(g)}`).join(", ")}). Add days,
            longer hours or another lobby{fixes.some((f) => f.next) ? " — or tap a fix below." : "."}
          </span>
        </p>
      )}

      {fixes.length > 0 && (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            <Lightbulb className="size-3.5" /> Suggestions
          </p>
          <div className="flex flex-wrap gap-2">
            {fixes.map((f) =>
              f.next ? (
                <motion.button
                  key={f.text}
                  type="button"
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => onApply?.(f.next!)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-left text-xs font-semibold text-primary outline-none hover:bg-primary/15 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <Wand2 className="size-3.5 shrink-0" /> {f.text}
                </motion.button>
              ) : (
                <span key={f.text} className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
                  <Lightbulb className="size-3.5 shrink-0" /> {f.text}
                </span>
              ),
            )}
          </div>
        </div>
      )}

      {days.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">Nothing fits yet — check the dates and playing hours.</p>
      ) : (
        <div className="space-y-4">
          {days.map(([date, blocks], di) => (
            <DayRow key={date} date={date} blocks={blocks} config={config} index={di} />
          ))}
        </div>
      )}

      {showSlots && plan.slotOptions.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Teams will pick from these time slots</p>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {plan.slotOptions.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-2 rounded-xl border bg-background px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{o.label}</span>
                  <span className="block text-xs text-muted-foreground">{o.groupIndexes.map((g) => `Group ${groupName(g)}`).join(" · ")}</span>
                </span>
                <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 font-display text-sm font-bold">{o.capacity} spots</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: ReactNode; tone?: "ok" | "warn" | "bad" }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-background p-3">
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-lg [&_svg]:size-4.5",
          tone === "bad" ? "bg-destructive/10 text-destructive" : tone === "warn" ? "bg-warning/15 text-warning-foreground dark:text-warning" : "bg-primary/10 text-primary",
        )}
      >
        {icon}
      </span>
      <span>
        <span className="block font-display text-2xl leading-none font-bold">{value}</span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </span>
    </div>
  );
}

function DayRow({ date, blocks, config, index }: { date: string; blocks: ScheduleBlock[]; config: ScheduleConfig; index: number }) {
  const lobbies = Math.max(config.parallelLobbies, ...blocks.map((b) => b.lobbyIndex + 1));
  const starts = [...config.windows.map((w) => toMinutes(w.start)), ...blocks.map((b) => toMinutes(hm(b.start)))];
  const ends = [...config.windows.map((w) => toMinutes(w.end)), ...blocks.map((b) => toMinutes(hm(b.end)))];
  const from = Math.floor(Math.min(...starts) / 60) * 60;
  const to = Math.ceil(Math.max(...ends) / 60) * 60;
  const span = Math.max(60, to - from);
  const pct = (m: number) => ((m - from) / span) * 100;
  const hours = Array.from({ length: span / 60 + 1 }, (_, i) => from + i * 60);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className="rounded-xl border bg-background p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="font-display text-base font-bold">
          <span className="mr-2 text-primary">Day {index + 1}</span>
          {formatDate(date)}
        </p>
        <p className="text-xs text-muted-foreground">{plural(blocks.length, "group")}</p>
      </div>
      <div className="overflow-x-auto [scrollbar-width:thin]">
        <div className="min-w-[520px]">
          <div className="relative ml-16 h-5 text-[10px] text-muted-foreground">
            {hours.map((h) => (
              <span key={h} className={cn("absolute whitespace-nowrap", h === to ? "-translate-x-full" : h === from ? "" : "-translate-x-1/2")} style={{ left: `${pct(h)}%` }}>
                {formatTime(`${String(Math.floor(h / 60) % 24).padStart(2, "0")}:00`).replace(":00 ", " ")}
              </span>
            ))}
          </div>
          {Array.from({ length: lobbies }, (_, lobby) => (
            <div key={lobby} className="flex items-center gap-2 py-1">
              <span className="w-14 shrink-0 text-xs font-semibold text-muted-foreground">Lobby {lobby + 1}</span>
              <div className="relative h-14 flex-1 rounded-lg bg-muted/40">
                {config.windows.map((w, i) => (
                  <span
                    key={i}
                    aria-hidden
                    className="absolute inset-y-0 rounded-lg border border-dashed border-primary/25 bg-primary/5"
                    style={{ left: `${pct(toMinutes(w.start))}%`, width: `${pct(toMinutes(w.end)) - pct(toMinutes(w.start))}%` }}
                  />
                ))}
                {hours.slice(1, -1).map((h) => (
                  <span key={h} aria-hidden className="absolute inset-y-0 w-px bg-border/70" style={{ left: `${pct(h)}%` }} />
                ))}
                {blocks
                  .filter((b) => b.lobbyIndex === lobby)
                  .map((b, i) => (
                    <Tooltip key={b.groupIndex}>
                      <TooltipTrigger asChild>
                        <motion.div
                          tabIndex={0}
                          initial={{ opacity: 0, scaleX: 0.4 }}
                          animate={{ opacity: 1, scaleX: 1 }}
                          transition={{ delay: 0.05 * i, duration: 0.3 }}
                          style={{ left: `${pct(toMinutes(hm(b.start)))}%`, width: `${pct(toMinutes(hm(b.end))) - pct(toMinutes(hm(b.start)))}%`, transformOrigin: "left" }}
                          className={cn(
                            "absolute inset-y-1 flex min-w-0 flex-col justify-center overflow-hidden rounded-md border px-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                            GROUP_TONES[b.groupIndex % GROUP_TONES.length],
                          )}
                        >
                          <span className="truncate font-display text-sm leading-tight font-bold">Group {groupName(b.groupIndex)}</span>
                          <span className="truncate text-[10px] leading-tight text-foreground/70">{timeRange(hm(b.start), hm(b.end))}</span>
                        </motion.div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="font-semibold">
                          Group {groupName(b.groupIndex)} · Lobby {b.lobbyIndex + 1} · {timeRange(hm(b.start), hm(b.end))}
                        </p>
                        <ul className="mt-1 space-y-0.5">
                          {b.matches.map((m) => (
                            <li key={m.number}>
                              M{m.number} · {MAP_LABELS[m.map]} · {formatTime(hm(m.start))}
                            </li>
                          ))}
                        </ul>
                      </TooltipContent>
                    </Tooltip>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
