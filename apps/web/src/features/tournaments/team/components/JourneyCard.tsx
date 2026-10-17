import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertTriangle, CalendarClock, Clock, Flag, Target } from "lucide-react";
import type { TeamTournamentDetail } from "@7xen/shared";
import { SlotChip, type Tone } from "@7xen/ui/components/brand/status";
import { cn } from "@7xen/ui/lib/utils";
import { MapChip } from "@/features/team/components/MapChips";
import { readStorage, writeStorage } from "@/lib/storage";
import { Countdown } from "../../shared/Countdown";
import { fmtWhen } from "../../shared/format";
import { journeyCopy, slotLabel, stageByOrder } from "../journey";
import { Confetti } from "./Confetti";
import { MatchRoom } from "@/features/live/components/TeamRoom";

const ICON_TONE: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  brand: "bg-primary/15 text-primary",
  success: "bg-success/15 text-success",
  warning: "bg-warning/20 text-warning-foreground dark:text-warning",
  danger: "bg-destructive/10 text-destructive",
  info: "bg-info/10 text-info",
};
const BORDER_TONE: Record<Tone, string> = {
  neutral: "border-border",
  brand: "border-primary/40 shadow-glow",
  success: "border-success/40",
  warning: "border-warning/50 shadow-[0_0_28px_-10px_var(--warning)]",
  danger: "border-destructive/40",
  info: "border-info/40",
};

/** "Your journey": where your team is, the next goal, next match with countdown, assigned time slot. */
export function JourneyCard({ t, className }: { t: TeamTournamentDetail; className?: string }) {
  const me = t.me;
  const c = journeyCopy(t);
  const Icon = c.icon;
  const nm = me.nextMatch;
  const stage = stageByOrder(t, me.stageOrder);
  // the stage-1 time slot only matters until the team has played stage 1
  const assigned = (me.state === "CONFIRMED" || me.state === "PLAYING") && (me.stageOrder ?? 1) === 1 ? slotLabel(t, me.assignedSlot) : null;
  // "Register your team to take part" just repeats the card title for teams that aren't in
  const goal = me.state === "NOT_REGISTERED" || me.state === "WITHDRAWN" ? null : me.nextGoal;
  // celebrate once per browser per tournament+state
  const celebrateKey = `7xen.tournament.celebrated.${t.id}.${me.state}.${me.stageOrder ?? 0}`;
  const [burst] = useState(() => !!c.celebrate && !readStorage(celebrateKey));
  useEffect(() => {
    if (burst) writeStorage(celebrateKey, "1");
  }, [burst, celebrateKey]);

  return (
    <section
      data-tour="journey"
      aria-labelledby="journey-title"
      className={cn("relative overflow-hidden rounded-2xl border bg-card p-5 shadow-sm sm:p-6", BORDER_TONE[c.tone], className)}
    >
      {burst && <Confetti />}
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-40" />
      <div className="relative flex items-start gap-4">
        <motion.span
          initial={{ scale: 0.5, rotate: -12, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 320, damping: 16 }}
          className={cn("flex size-14 shrink-0 items-center justify-center rounded-2xl", ICON_TONE[c.tone])}
        >
          <Icon className="size-7" />
        </motion.span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">{c.eyebrow}</p>
          <h2 id="journey-title" className="mt-0.5 font-display text-2xl leading-tight font-bold sm:text-3xl">
            {c.title}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{c.body}</p>
        </div>
        {me.slotNumber != null && (me.state === "PLAYING" || me.state === "CONFIRMED") && (
          <SlotChip slot={me.slotNumber} className="hidden shrink-0 sm:inline-flex" />
        )}
      </div>

      {(goal || nm || assigned) && (
        <div className="relative mt-5 grid gap-3 sm:grid-cols-2">
          {goal && (
            <div className="flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/5 p-3.5 sm:col-span-2" data-tour="next-goal">
              <Target className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <p className="text-[11px] font-semibold tracking-wider text-primary uppercase">Next goal</p>
                <p className="font-display text-lg leading-snug font-bold">{goal}</p>
              </div>
            </div>
          )}
          {nm && (
            <div className="flex flex-col gap-3 rounded-xl border bg-background/60 p-3.5" data-tour="next-tmatch">
              <div className="flex items-start gap-3">
                <Flag className="mt-0.5 size-5 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Next match</p>
                  <p className="font-display text-lg leading-snug font-bold">
                    Match {nm.number} · Group {nm.groupName}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <MapChip map={nm.map} className="px-1.5 py-0.5 text-[11px]" />
                    <span className="inline-flex items-center gap-1">
                      <Clock className="size-3.5" /> {fmtWhen(nm.scheduledAt)}
                    </span>
                  </p>
                </div>
              </div>
              {nm.scheduledAt && <Countdown to={nm.scheduledAt} variant="blocks" doneText="Match time!" label="Time until your next match" />}
              <MatchRoom matchId={nm.matchId} className="sm:grid-cols-1" />
              {stage && (
                <Link to={`/team/tournaments/${t.id}/stages/${stage.id}`} className="text-xs font-semibold text-primary underline-offset-4 hover:underline">
                  See your group →
                </Link>
              )}
            </div>
          )}
          {assigned && (
            <div className="flex items-start gap-3 rounded-xl border bg-background/60 p-3.5">
              <CalendarClock className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Your time slot</p>
                <p className="font-display text-lg leading-snug font-bold">{assigned}</p>
                <p className="text-xs text-muted-foreground">Placed by the draw{me.entry?.timePreferences.length ? " using your preferences" : ""}.</p>
              </div>
            </div>
          )}
        </div>
      )}
      {me.rosterWarning && (
        <div className="relative mt-4 flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-foreground dark:text-warning" />
          <p>
            {me.rosterWarning}{" "}
            <Link to="/team/profile" className="font-semibold text-primary underline-offset-4 hover:underline">
              Update roster
            </Link>
          </p>
        </div>
      )}
    </section>
  );
}
