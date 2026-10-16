import { Link } from "react-router-dom";
import { ArrowRight, Clock, Lock, Users } from "lucide-react";
import type { ScrimOnDate } from "@7xen/shared";
import { Pill } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Progress } from "@7xen/ui/components/ui/progress";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { cn } from "@7xen/ui/lib/utils";
import { formatTime } from "../format";
import { MapChips } from "./maps";

/** One scrim running on one date: time, maps, fill progress, pending count, Manage. */
export function SessionCard({ session, className, ...rest }: { session: ScrimOnDate; className?: string; "data-tour"?: string }) {
  const { scrim, counts, registrationOpen, date } = session;
  const pct = Math.round((counts.approved / Math.max(1, scrim.slotCount)) * 100);
  const full = counts.slotsLeft === 0;
  return (
    <div
      className={cn(
        "group relative flex flex-col gap-4 overflow-hidden rounded-xl border bg-card p-4 shadow-sm transition-all hover:border-primary/40 hover:shadow-glow sm:flex-row sm:items-center sm:p-5",
        className,
      )}
      {...rest}
    >
      <div className="flex items-center gap-4 sm:w-28 sm:flex-col sm:items-start sm:gap-0">
        <span className="font-display text-3xl font-bold leading-none">{formatTime(scrim.startTime).replace(/ (AM|PM)$/, "")}</span>
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {formatTime(scrim.startTime).slice(-2)} IST
        </span>
      </div>

      <div className="min-w-0 flex-1 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate font-display text-xl font-bold">{scrim.title}</h3>
          {counts.pending > 0 && (
            <Pill tone="warning" icon={<Clock className="size-3.5" />}>
              {counts.pending} waiting
            </Pill>
          )}
          {!registrationOpen && (
            <Pill tone="neutral" icon={<Lock className="size-3.5" />}>
              Closed
            </Pill>
          )}
        </div>
        <MapChips maps={scrim.maps} numbered />
        <div className="flex items-center gap-3">
          <Progress value={pct} className={cn("h-2 max-w-xs", full && "[&>[data-slot=progress-indicator]]:bg-success")} />
          <span className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
            <Users className="size-4" />
            <span className="font-semibold text-foreground">{counts.approved}</span>/{scrim.slotCount} teams
            {full ? <span className="font-semibold text-success">· Full</span> : <span>· {counts.slotsLeft} left</span>}
          </span>
        </div>
      </div>

      <Button asChild variant={counts.pending > 0 ? "default" : "outline"} className="sm:self-center">
        <Link to={`/manager/scrims/${scrim.id}?date=${date}`}>
          Manage <ArrowRight />
        </Link>
      </Button>
    </div>
  );
}

export function SessionCardSkeleton() {
  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-5 sm:flex-row sm:items-center">
      <Skeleton className="h-10 w-20" />
      <div className="flex-1 space-y-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-2 w-72" />
      </div>
      <Skeleton className="h-9 w-28" />
    </div>
  );
}
