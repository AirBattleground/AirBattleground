import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertTriangle, CalendarClock, Clock, Target } from "lucide-react";
import type { TeamTournamentDetail } from "@7xen/shared";
import { SlotChip, type Tone } from "@7xen/ui/components/brand/status";
import { cn } from "@7xen/ui/lib/utils";
import { MapChip } from "@/features/team/components/MapChips";
import { readStorage, writeStorage } from "@/lib/storage";
import { Countdown } from "../../shared/Countdown";
import { useTournamentFormat } from "../../shared/format";
import { useT } from "@/i18n/core";
import { tJourney } from "@/i18n/tournaments";
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
  const tj = useT(tJourney);
  const { fmtWhen } = useTournamentFormat();
  const c = journeyCopy(t, tj);
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
      className={cn("relative overflow-hidden rounded-2xl border bg-card p-4 shadow-sm sm:p-5", BORDER_TONE[c.tone], className)}
    >
      {burst && <Confetti />}
      <p className="text-[11px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">{c.eyebrow}</p>
      <div className="mt-2 flex items-start gap-3">
        <motion.span
          initial={{ scale: 0.5, rotate: -12, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 320, damping: 16 }}
          className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", ICON_TONE[c.tone])}
        >
          <Icon className="size-6" />
        </motion.span>
        <div className="min-w-0 flex-1">
          <h2 id="journey-title" className="font-display text-2xl leading-tight font-bold">
            {c.title}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{c.body}</p>
        </div>
        {me.slotNumber != null && (me.state === "PLAYING" || me.state === "CONFIRMED") && <SlotChip slot={me.slotNumber} className="shrink-0" />}
      </div>

      {goal && (
        <p className="mt-4 flex items-start gap-2 text-sm" data-tour="next-goal">
          <Target className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>
            <span className="font-semibold text-primary">{tj("next_goal")}:</span> <span className="font-medium">{goal}</span>
          </span>
        </p>
      )}

      {(nm || assigned) && (
        <div className="mt-4 divide-y border-t">
          {nm && (
            <div className="space-y-3 py-4" data-tour="next-tmatch">
              <div>
                <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{tj("next_match")}</p>
                <p className="font-display text-lg leading-snug font-bold">{tj("match_group", { n: nm.number, group: nm.groupName })}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <MapChip map={nm.map} className="px-1.5 py-0.5 text-[11px]" />
                  <span className="inline-flex items-center gap-1">
                    <Clock className="size-3.5" /> {fmtWhen(nm.scheduledAt)}
                  </span>
                </p>
              </div>
              {nm.scheduledAt && <Countdown to={nm.scheduledAt} variant="blocks" doneText={tj("match_time")} label={tj("time_until_next")} />}
              <MatchRoom matchId={nm.matchId} className="sm:grid-cols-1" />
              {stage && (
                <Link to={`/team/tournaments/${t.id}/stages/${stage.id}`} className="inline-flex min-h-10 items-center text-sm font-semibold text-primary underline-offset-4 hover:underline">
                  {tj("see_your_group")}
                </Link>
              )}
            </div>
          )}
          {assigned && (
            <div className="flex items-start gap-3 py-4 last:pb-0">
              <CalendarClock className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{tj("your_time_slot")}</p>
                <p className="font-display text-lg leading-snug font-bold">{assigned}</p>
                <p className="text-xs text-muted-foreground">{me.entry?.timePreferences.length ? tj("placed_by_draw_prefs") : tj("placed_by_draw")}</p>
              </div>
            </div>
          )}
        </div>
      )}
      {me.rosterWarning && <RosterWarning text={me.rosterWarning} className="mt-4" />}
    </section>
  );
}

/** Roster problem that blocks playing, with a link to fix it. */
export function RosterWarning({ text, className }: { text: string; className?: string }) {
  const tj = useT(tJourney);
  return (
    <div className={cn("flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm", className)}>
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-foreground dark:text-warning" />
      <p>
        {text}{" "}
        <Link to="/team/profile" className="font-semibold text-primary underline-offset-4 hover:underline">
          {tj("update_roster")}
        </Link>
      </p>
    </div>
  );
}
