import { Link } from "react-router-dom";
import { ArrowRight, Crosshair, Drumstick, Trophy } from "lucide-react";
import type { TeamResultsSummary } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { formatDate } from "@/features/team/format";
import { ordinal, RankBadge } from "./Rank";

/** Compact "Your last result" card for the team dashboard. */
export function LastResultCard({ results, loading }: { results: TeamResultsSummary | null; loading?: boolean }) {
  if (loading) return <Skeleton className="h-24 rounded-2xl" />;
  const last = results?.latest;
  if (!last)
    return (
      <div data-tour="last-result" className="flex items-start gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:items-center sm:p-6">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Trophy className="size-6" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">Your last result</p>
          <p className="mt-0.5 font-display text-xl leading-tight font-bold">No results yet</p>
          <p className="mt-0.5 text-sm text-muted-foreground">After you play, your rank and points show up here once the organiser publishes them.</p>
        </div>
      </div>
    );
  return (
    <Link
      to={`/team/results/${last.scrim.id}/${last.date}`}
      data-tour="last-result"
      className="group relative flex flex-wrap items-center gap-4 overflow-hidden rounded-2xl border bg-card p-5 shadow-sm sm:p-6 outline-none transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-glow focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <div className="pointer-events-none absolute -top-12 -left-12 size-40 rounded-full bg-gradient-to-br from-warning/25 to-transparent blur-2xl" />
      <RankBadge rank={last.rank} size="lg" className="relative" />
      <div className="relative min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your last result</p>
        <p className="truncate font-display text-xl font-bold">
          {ordinal(last.rank)} of {last.teamsCount} · {last.scrim.title}
        </p>
        <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          <span>{formatDate(last.date)}</span>
          <span className="inline-flex items-center gap-1">
            <Crosshair className="size-3" /> {last.kills} finishes
          </span>
          {last.wins > 0 && (
            <span className="inline-flex items-center gap-1 font-semibold text-warning-foreground dark:text-warning">
              <Drumstick className="size-3" /> {last.wins} chicken dinner{last.wins === 1 ? "" : "s"}
            </span>
          )}
        </p>
      </div>
      <div className="relative text-right">
        <p className="font-display text-4xl font-bold leading-none tabular-nums">{last.totalPoints}</p>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">points</p>
      </div>
      <Button asChild variant="ghost" size="sm" className="relative hidden sm:inline-flex">
        <span>
          Points table <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </Button>
    </Link>
  );
}
