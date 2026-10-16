import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { CalendarDays, Crosshair, Search, User } from "lucide-react";
import type { TeamRegistration } from "@7xen/shared";
import { SlotChip } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { whenLabel } from "../format";
import { CountdownBlocks } from "./Countdown";
import { MapChips } from "./MapChips";

/** Hero card for the team's next approved match (or an inviting empty state). */
export function NextMatchCard({ match, today }: { match: TeamRegistration | null; today: string }) {
  if (!match) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-dashed bg-card p-6 sm:p-8" data-tour="next-match">
        <div className="pointer-events-none absolute inset-0 bg-grid opacity-60" />
        <div className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-primary/15 blur-3xl" />
        <div className="relative flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-primary/10 p-3.5 text-primary">
              <Crosshair className="size-7" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Next match</p>
              <h2 className="mt-1 font-display text-2xl font-bold sm:text-3xl">No match booked yet</h2>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">Pick a day, register for a scrim, and your slot will show up right here once the organiser approves.</p>
            </div>
          </div>
          <Button asChild size="lg" className="h-12 px-6 text-base shadow-glow">
            <Link to="/team/scrims">
              <Search /> Find a scrim
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-card shadow-glow" data-tour="next-match">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-70" />
      <div className="pointer-events-none absolute -top-28 -left-20 size-80 rounded-full bg-primary/20 blur-3xl animate-aurora" />
      <div className="relative grid gap-6 p-5 sm:p-7 md:grid-cols-[auto_1fr_auto] md:items-center">
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 15 }}
          className="justify-self-start"
          data-tour="next-slot"
        >
          {match.slotNumber != null ? (
            <SlotChip slot={match.slotNumber} size="lg" className="h-24 min-w-32 text-5xl" />
          ) : (
            <span className="inline-flex h-24 min-w-32 items-center justify-center rounded-xl border border-primary/40 bg-primary/10 font-display text-xl font-bold text-primary">
              Approved
            </span>
          )}
        </motion.div>

        <div className="min-w-0 space-y-2.5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Next match</p>
          <h2 className="font-display text-3xl leading-tight font-bold sm:text-4xl">{match.scrim.title}</h2>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="flex items-center gap-1.5 font-semibold">
              <CalendarDays className="size-4 text-primary" /> {whenLabel(match.date, match.scrim.startTime, today)}
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <User className="size-4" /> {match.scrim.manager.displayName}
            </span>
          </div>
          <MapChips maps={match.scrim.maps} />
        </div>

        <div className="flex flex-col gap-1.5 md:items-end">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Starts in</span>
          <CountdownBlocks to={match.startsAt} />
        </div>
      </div>
    </div>
  );
}

export function NextMatchSkeleton() {
  return (
    <div className="grid gap-6 rounded-2xl border bg-card p-7 md:grid-cols-[auto_1fr_auto] md:items-center">
      <div className="h-24 w-32 animate-pulse rounded-xl bg-muted" />
      <div className="space-y-3">
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
        <div className="h-9 w-2/3 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
      </div>
      <div className="h-16 w-52 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}
