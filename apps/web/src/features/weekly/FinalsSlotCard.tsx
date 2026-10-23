import { Link } from "react-router-dom";
import { ArrowRight, CalendarDays, Sparkles, Trophy } from "lucide-react";
import type { FinalsSlot } from "@7xen/shared";
import { cn } from "@7xen/ui/lib/utils";
import { useDateFormat, useT } from "@/i18n/core";
import { weeklyMsg } from "@/i18n/weekly";
import { useFinalsSlots } from "./api";

/** One Finals Slot: gold card with the tournament, the final it leads into, and what it was won for. */
export function FinalsSlotCard({ slot, className }: { slot: FinalsSlot; className?: string }) {
  const t = useT(weeklyMsg);
  const fmt = useDateFormat();
  return (
    <Link
      to={`/team/tournaments/${slot.tournament.id}`}
      data-tour="finals-slot"
      className={cn(
        "group relative block overflow-hidden rounded-2xl border-2 border-warning/60 bg-card p-4 shadow-glow outline-none transition-all hover:-translate-y-0.5 hover:border-warning focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:p-5",
        className,
      )}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-br from-warning/25 via-warning/5 to-transparent" />
      <div aria-hidden className="pointer-events-none absolute -top-16 -right-10 size-48 rounded-full bg-warning/25 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-grid opacity-20" />
      <div className="relative flex items-start gap-4">
        <div className="relative shrink-0">
          {slot.tournament.posterUrl ? (
            <img src={slot.tournament.posterUrl} alt="" className="size-16 rounded-xl border border-warning/40 object-cover shadow-md sm:size-20" />
          ) : (
            <span className="flex size-16 items-center justify-center rounded-xl bg-warning/15 text-warning sm:size-20">
              <Trophy className="size-8" />
            </span>
          )}
          <span className="absolute -right-2 -bottom-2 flex size-8 items-center justify-center rounded-full bg-warning text-warning-foreground shadow-lg">
            <Trophy className="size-4" />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 font-display text-2xl leading-none font-extrabold tracking-wide text-warning-foreground uppercase dark:text-warning">
            <Sparkles className="size-5" /> {t("finals_slot")}
          </p>
          <p className="mt-1.5 truncate font-display text-xl leading-tight font-bold uppercase">{slot.tournament.title}</p>
          <p className="text-sm font-semibold">{t("fs_direct", { stage: slot.stage.name })}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {slot.stage.startDate && (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="size-3.5" /> {t("fs_starts", { date: fmt(slot.stage.startDate, "EEE, d MMM") })}
              </span>
            )}
            <span>{t("fs_by", { org: slot.tournament.organizer })}</span>
          </p>
        </div>
        <ArrowRight className="mt-1 size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-label={t("fs_open")} />
      </div>
      {slot.note && (
        <p className="relative mt-3 flex items-center gap-1.5 rounded-lg border border-warning/30 bg-background/60 px-3 py-1.5 text-xs font-semibold">
          <Trophy className="size-3.5 shrink-0 text-warning" /> <span className="truncate">{slot.note}</span>
        </p>
      )}
    </Link>
  );
}

/** My team's Finals Slots (nothing when there are none). */
export function FinalsSlots({ enabled = true, className }: { enabled?: boolean; className?: string }) {
  const q = useFinalsSlots(enabled);
  if (!q.data?.length) return null;
  return (
    <div className={cn("space-y-3", className)}>
      {q.data.map((s) => (
        <FinalsSlotCard key={s.entryId} slot={s} />
      ))}
    </div>
  );
}
