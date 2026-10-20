import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, CalendarClock, Crown, Loader2, Lock, Play, Rocket, Shuffle, Swords, TrendingUp, Trophy, Wrench, type LucideIcon } from "lucide-react";
import type { ManagerActionKey, ManagerTournamentDetail } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { cn } from "@7xen/ui/lib/utils";
import { ConfirmDialog } from "@/features/manager/components/ConfirmDialog";
import { useStartStage, useTournamentAction, type TournamentAction } from "../api";

interface Meta {
  icon: LucideIcon;
  hint: (t: ManagerTournamentDetail, stageName: string) => string;
  confirm?: { title: (t: ManagerTournamentDetail, stageName: string) => string; text: (t: ManagerTournamentDetail, stageName: string) => ReactNode; cta: string };
}

const META: Record<ManagerActionKey, Meta> = {
  FIX_FORMAT: { icon: Wrench, hint: () => "The format has a problem that blocks publishing." },
  SET_SCHEDULE: { icon: CalendarClock, hint: (_t, s) => `Pick the days and playing hours for the ${s}.` },
  PUBLISH: {
    icon: Rocket,
    hint: () => "Opens registration — teams can sign up straight away.",
    confirm: {
      title: (t) => `Publish “${t.title}”?`,
      text: (t) => `Teams will see it and can register (first ${t.maxTeams} get a spot, the rest join a waitlist). The format can't be changed after this.`,
      cta: "Publish",
    },
  },
  CLOSE_REGISTRATION: {
    icon: Lock,
    hint: (t) => `${t.confirmedCount}/${t.maxTeams} spots taken. Close when you're ready to draw groups.`,
    confirm: {
      title: () => "Close registration?",
      text: (t) => `No new teams can sign up. ${t.waitlistCount ? `${t.waitlistCount} team${t.waitlistCount === 1 ? "" : "s"} on the waitlist will stay there. ` : ""}You can reopen it until the groups are drawn.`,
      cta: "Close registration",
    },
  },
  DRAW: { icon: Shuffle, hint: (_t, s) => `Put the teams into ${s} groups.` },
  START_STAGE: {
    icon: Play,
    hint: (_t, s) => `Groups are ready. Go live to enter results.`,
    confirm: {
      title: (_t, s) => `Start the ${s}?`,
      text: () => "The stage goes live and registration closes for good. Teams already see their group and times.",
      cta: "Start stage",
    },
  },
  PLAY_MATCHES: { icon: Swords, hint: (_t, s) => `The ${s} is live — publish each match result.` },
  PROMOTE: { icon: TrendingUp, hint: (_t, s) => `All ${s} matches are published. Move the qualifiers on.` },
  COMPLETE: {
    icon: Crown,
    hint: () => "The final is done — crown the champion.",
    confirm: { title: () => "Complete the tournament?", text: () => "The champion is announced to every team and the tournament moves to Finished.", cta: "Crown the champion" },
  },
  DONE: { icon: Trophy, hint: () => "This tournament is finished." },
};

/** The control center's ONE big button, driven by ManagerTournamentDetail.nextAction. */
export function NextAction({ t, className }: { t: ManagerTournamentDetail; className?: string }) {
  const navigate = useNavigate();
  const action = useTournamentAction(t.id);
  const stageId = t.nextAction?.stageId ?? null;
  const start = useStartStage(t.id, stageId ?? "");
  const [confirming, setConfirming] = useState(false);
  const next = t.nextAction;
  if (!next) return null;
  const stage = t.stages.find((s) => s.id === stageId);
  const stageName = stage?.name ?? "stage";
  const meta = META[next.key];
  const Icon = meta.icon;
  const stageUrl = stageId ? `/manager/tournaments/${t.id}/stages/${stageId}` : null;
  const busy = action.isPending || start.isPending;

  const run = () => {
    const post = (a: TournamentAction) => action.mutate(a);
    switch (next.key) {
      case "FIX_FORMAT":
        return navigate(`/manager/tournaments/${t.id}/edit?step=1`);
      case "SET_SCHEDULE":
        return navigate(t.status === "DRAFT" && (!stage || stage.order === 1) ? `/manager/tournaments/${t.id}/edit?step=2` : `${stageUrl}?tab=schedule`);
      case "PUBLISH":
        return post("publish");
      case "CLOSE_REGISTRATION":
        return post("close-registration");
      case "DRAW":
        return stageUrl && navigate(`${stageUrl}?draw=1`);
      case "START_STAGE":
        return start.mutate();
      case "PLAY_MATCHES":
        return stageUrl && navigate(stageUrl);
      case "PROMOTE":
        return stageUrl && navigate(`${stageUrl}?tab=promotion`);
      case "COMPLETE":
        return post("complete");
      case "DONE":
        return;
    }
  };
  const onClick = () => (meta.confirm ? setConfirming(true) : run());

  return (
    <div
      data-tour="t-next-action"
      className={cn(
        "relative overflow-hidden rounded-2xl border p-4 shadow-sm sm:p-5",
        next.key === "DONE" ? "border-warning/40 bg-warning/10" : "border-primary/40 bg-gradient-to-br from-primary/12 via-card to-card",
        className,
      )}
    >
      <div className="relative flex h-full flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Icon className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-[0.2em] text-primary uppercase">{next.key === "DONE" ? "All done" : "Next step"}</p>
            <p className="font-display text-xl leading-tight font-bold">{next.label}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{meta.hint(t, stageName)}</p>
          </div>
        </div>
        {next.key !== "DONE" && (
          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="shrink-0">
            <Button size="lg" onClick={onClick} disabled={busy} className="h-12 w-full px-6 text-base shadow-glow sm:w-auto">
              {busy ? <Loader2 className="animate-spin" /> : <Icon />}
              {next.label}
              <ArrowRight />
            </Button>
          </motion.div>
        )}
      </div>
      {meta.confirm && (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={meta.confirm.title(t, stageName)}
          description={meta.confirm.text(t, stageName)}
          confirmLabel={meta.confirm.cta}
          onConfirm={run}
        />
      )}
    </div>
  );
}
