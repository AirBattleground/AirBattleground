import { Link } from "react-router-dom";
import { ArrowRight, Clock, Lock } from "lucide-react";
import type { ScrimOnDate } from "@7xen/shared";
import { Pill } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Progress } from "@7xen/ui/components/ui/progress";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { cn } from "@7xen/ui/lib/utils";
import { formatTime } from "../format";

/**
 * One scrim running on one date, as a flat row (put several in a `divide-y` list inside one panel):
 * time · title · how full · one status pill · Manage.
 */
export function SessionCard({ session, className, ...rest }: { session: ScrimOnDate; className?: string; "data-tour"?: string }) {
  const { scrim, counts, registrationOpen, date } = session;
  const pct = Math.round((counts.approved / Math.max(1, scrim.slotCount)) * 100);
  const full = counts.slotsLeft === 0;
  const time = formatTime(scrim.startTime);
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 py-3", className)} {...rest}>
      <div className="w-16 shrink-0">
        <p className="font-display text-2xl font-bold leading-none tabular-nums">{time.replace(/ (AM|PM)$/, "")}</p>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{time.slice(-2)} IST</p>
      </div>

      <div className="min-w-0 flex-1 basis-40">
        <Link to={`/manager/scrims/${scrim.id}?date=${date}`} className="block truncate font-display text-lg font-bold hover:text-primary">
          {scrim.title}
        </Link>
        <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
          <Progress value={pct} className={cn("h-1.5 w-20", full && "[&>[data-slot=progress-indicator]]:bg-success")} />
          <span>
            <span className="font-semibold text-foreground">{counts.approved}</span>/{scrim.slotCount} teams
            {full && <span className="font-semibold text-success"> · Full</span>}
          </span>
          <span className="hidden sm:inline">· {scrim.maps.length} match{scrim.maps.length === 1 ? "" : "es"}</span>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {counts.pending > 0 ? (
          <Pill tone="warning" icon={<Clock className="size-3.5" />}>
            {counts.pending} waiting
          </Pill>
        ) : (
          !registrationOpen && (
            <Pill tone="neutral" icon={<Lock className="size-3.5" />}>
              Closed
            </Pill>
          )
        )}
        <Button asChild size="sm" variant={counts.pending > 0 ? "default" : "outline"} className="h-10">
          <Link to={`/manager/scrims/${scrim.id}?date=${date}`}>
            Manage <ArrowRight />
          </Link>
        </Button>
      </div>
    </div>
  );
}

export function SessionCardSkeleton() {
  return (
    <div className="flex items-center gap-4 py-3">
      <Skeleton className="h-9 w-16" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-3 w-32" />
      </div>
      <Skeleton className="h-10 w-24" />
    </div>
  );
}
