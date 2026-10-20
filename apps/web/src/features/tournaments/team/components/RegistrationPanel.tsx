import { useEffect, useMemo, useState } from "react";
import { Info, Loader2, Lock, LogOut, Save, UserPlus, Zap } from "lucide-react";
import type { TeamTournamentDetail } from "@7xen/shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@7xen/ui/components/ui/alert-dialog";
import { Button } from "@7xen/ui/components/ui/button";
import { cn } from "@7xen/ui/lib/utils";
import { Countdown } from "../../shared/Countdown";
import { RegistrationMeter } from "../../shared/RegistrationMeter";
import { useTournamentFormat } from "../../shared/format";
import { useT, type T } from "@/i18n/core";
import { tHub } from "@/i18n/tournamentsHub";

type TH = T<(typeof tHub)["en"]>;
import { usePlayerSession } from "@/lib/auth";
import { AskLeaderButton, LeaderOnlyNote } from "@/features/player/components/AskLeader";
import { NeedTeamDialog } from "@/features/player/components/NeedTeamDialog";
import { useRegisterTournament, useUpdateTournamentPreferences, useWithdrawTournament } from "../api";
import { isDrawn } from "../journey";
import { SlotPicker } from "./SlotPicker";

function closedReason(t: TeamTournamentDetail, th: TH): string {
  if (t.me.registerBlockedReason) return t.me.registerBlockedReason;
  switch (t.status) {
    case "REGISTRATION_CLOSED":
      return th("closed_setting_up");
    case "LIVE":
      return t.currentStage ? th("closed_live_stage", { stage: t.currentStage.name }) : th("closed_live");
    case "COMPLETED":
      return th("over");
    case "CANCELLED":
      return th("cancelled");
    default:
      return th("not_open_yet");
  }
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Register / update time preferences / withdraw. Disabled with a plain reason when registration is closed. */
export function RegistrationPanel({ t, className }: { t: TeamTournamentDetail; className?: string }) {
  const me = t.me;
  const th = useT(tHub);
  const { fmtWhen } = useTournamentFormat();
  const registered = me.state === "CONFIRMED" || me.state === "WAITLISTED";
  const canEdit = registered && t.status === "REGISTRATION_OPEN" && !isDrawn(t);
  const canRegister = me.canRegister && !registered;
  const saved = useMemo(() => me.entry?.timePreferences ?? [], [me.entry?.timePreferences]);
  const [prefs, setPrefs] = useState<string[]>(saved);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [needTeamOpen, setNeedTeamOpen] = useState(false);
  const [confirmRegister, setConfirmRegister] = useState(false);
  useEffect(() => setPrefs(saved), [saved]);

  const { isLeader, hasTeam, team } = usePlayerSession();
  // phase 5c: a player without a team picks preferences too — they'll lead the team they create
  const actsAsLeader = isLeader || !hasTeam;
  const register = useRegisterTournament(t.id);
  const update = useUpdateTournamentPreferences(t.id);
  const withdraw = useWithdrawTournament(t.id);

  const left = Math.max(0, t.maxTeams - t.confirmedCount);
  const full = left === 0;
  const dirty = !sameList(prefs, saved);
  const hasSlots = t.slotOptions.length > 0;

  // Closed / not for us → plain reason, details stay visible elsewhere on the page.
  if (!canRegister && !canEdit) {
    // teams already in the tournament: the journey card explains everything
    if (me.state !== "NOT_REGISTERED" && me.state !== "WITHDRAWN") return null;
    return (
      <section data-tour="register" className={cn("rounded-2xl border bg-card p-5 shadow-sm", className)} aria-labelledby="reg-title">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Lock className="size-5" />
          </span>
          <div>
            <h2 id="reg-title" className="font-display text-xl font-bold">
              {th("reg_closed")}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{closedReason(t, th)}</p>
          </div>
        </div>
        <RegistrationMeter confirmed={t.confirmedCount} max={t.maxTeams} waitlist={t.waitlistCount} hideHint className="mt-4" />
        <Button disabled size="lg" className="mt-4 h-12 w-full text-base">
          <Lock /> {th("reg_closed")}
        </Button>
      </section>
    );
  }

  const busy = register.isPending || update.isPending || withdraw.isPending;

  return (
    <section data-tour="register" className={cn("rounded-2xl border border-primary/30 bg-card p-5 shadow-glow", className)} aria-labelledby="reg-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">{canEdit ? th("your_registration") : th("reg_open")}</p>
          <h2 id="reg-title" className="font-display text-2xl leading-tight font-bold">
            {canEdit ? (me.state === "WAITLISTED" ? th("on_waitlist") : th("spot_confirmed")) : full ? th("join_waitlist") : th("grab_spot")}
          </h2>
        </div>
        {t.registrationClosesAt && (
          <div className="shrink-0 text-right">
            <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{th("closes_in")}</p>
            <Countdown to={t.registrationClosesAt} doneText={th("closing")} className="font-display text-lg font-bold" />
          </div>
        )}
      </div>

      <RegistrationMeter confirmed={t.confirmedCount} max={t.maxTeams} waitlist={t.waitlistCount} className="mt-4" />

      <div className="mt-4 flex gap-2.5 rounded-xl border border-info/30 bg-info/5 p-3 text-sm" data-tour="fcfs">
        <Zap className="mt-0.5 size-4 shrink-0 text-info" />
        <p className="text-foreground/90">
          <span className="font-semibold">{th("fcfs")}</span>{" "}
          {full ? th("fcfs_full", { max: t.maxTeams }) : th.plural("fcfs_left", left)}
        </p>
      </div>

      {hasSlots && (actsAsLeader || canEdit) && (
        <div className="mt-5">
          <h3 className="font-display text-lg font-bold">{th("when_play")}</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            {th("when_play_hint", { stage: t.stages[0]?.name ?? th("first_stage") })}
          </p>
          <div className="-mx-1 max-h-72 overflow-y-auto overscroll-contain px-1 py-0.5 [scrollbar-width:thin] [mask-image:linear-gradient(to_bottom,#000_calc(100%-1.5rem),transparent)] pb-6">
            <SlotPicker options={t.slotOptions} value={prefs} onChange={setPrefs} disabled={busy || !actsAsLeader} />
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-col gap-2">
        {!hasTeam ? (
          <Button size="lg" className="h-12 w-full text-base shadow-glow" onClick={() => setNeedTeamOpen(true)} data-tour="register-btn">
            <UserPlus /> {full ? th("join_waitlist") : th("register_for")}
          </Button>
        ) : !isLeader ? (
          canRegister ? (
            <AskLeaderButton input={{ kind: "TOURNAMENT", tournamentId: t.id }} />
          ) : (
            <LeaderOnlyNote className="justify-center rounded-xl border border-dashed py-2.5">{th("leader_only")}</LeaderOnlyNote>
          )
        ) : canRegister ? (
          <Button size="lg" className="h-12 w-full text-base shadow-glow" disabled={busy} onClick={() => register.mutate({ timePreferences: prefs })} data-tour="register-btn">
            {register.isPending ? <Loader2 className="animate-spin" /> : <UserPlus />}
            {full ? th("join_waitlist") : me.state === "WITHDRAWN" ? th("register_again") : th("register_my_team")}
          </Button>
        ) : (
          <>
            {hasSlots && (
              <Button size="lg" className="h-12 w-full text-base" disabled={!dirty || busy} onClick={() => update.mutate({ timePreferences: prefs })}>
                {update.isPending ? <Loader2 className="animate-spin" /> : <Save />}
                {dirty ? th("update_prefs") : th("prefs_saved")}
              </Button>
            )}
            <Button variant="ghost" className="w-full text-muted-foreground hover:text-destructive" disabled={busy} onClick={() => setConfirmWithdraw(true)}>
              <LogOut /> {th("withdraw_from")}
            </Button>
          </>
        )}
        {t.registrationClosesAt && (
          <p className="flex items-center justify-center gap-1 text-center text-xs text-muted-foreground">
            <Info className="size-3" /> {th("closes_note", { when: fmtWhen(t.registrationClosesAt) })}
          </p>
        )}
      </div>

      <NeedTeamDialog open={needTeamOpen} onOpenChange={setNeedTeamOpen} what={th("need_team_what")} onTeamCreated={() => setConfirmRegister(true)} />
      {/* after creating a team from here: confirm the registration that started it all */}
      <AlertDialog open={confirmRegister} onOpenChange={setConfirmRegister}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl">{th("confirm_reg_title", { team: team?.name ?? th("your_team") })}</AlertDialogTitle>
            <AlertDialogDescription>
              {full ? th("confirm_full", { max: t.maxTeams, title: t.title }) : th.plural("confirm_left", left, { title: t.title })}
              {hasSlots && (prefs.length > 0 ? th.plural("confirm_prefs", prefs.length) : th("confirm_prefs_later"))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{th("not_now")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => register.mutate({ timePreferences: prefs })}>{full ? th("join_waitlist") : th("yes_register")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmWithdraw} onOpenChange={setConfirmWithdraw}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl">{th("withdraw_title", { title: t.title })}</AlertDialogTitle>
            <AlertDialogDescription>
              {me.state === "WAITLISTED" ? th("withdraw_wait") : th("withdraw_body")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{th("keep_spot")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => withdraw.mutate()}>
              {th("withdraw")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
