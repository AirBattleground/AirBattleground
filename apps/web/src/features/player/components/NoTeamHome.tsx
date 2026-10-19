import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowRight, Crown, Hourglass, KeyRound, Loader2, Megaphone, Shield, Ticket, UserPlus, Users, X } from "lucide-react";
import { toast } from "sonner";
import { INVITE_CODE_LENGTH, normalizeInviteCode, type MyJoinRequest } from "@7xen/shared";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Input } from "@7xen/ui/components/ui/input";
import { cn } from "@7xen/ui/lib/utils";
import { usePlayerSession } from "@/lib/auth";
import markUrl from "@/assets/brand/airbattleground-mark.webp";
import { refreshMembership, useCancelJoinRequest, usePlayerProfile } from "../api";
import { CreateTeamDialog } from "./CreateTeamDialog";
import { MyInvitesPanel } from "./MyInvitesPanel";

/** Type a code (or paste a whole invite link) → /join/:code. */
export function JoinCodeForm({ className, autoFocus }: { className?: string; autoFocus?: boolean }) {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const go = () => {
    const fromLink = value.match(/\/join\/([^/?#\s]+)/i)?.[1];
    const code = normalizeInviteCode(fromLink ?? value);
    if (code.length !== INVITE_CODE_LENGTH) {
      setError(`Invite codes are ${INVITE_CODE_LENGTH} letters/numbers — or paste the whole link.`);
      return;
    }
    navigate(`/join/${code}`);
  };
  return (
    <form
      className={cn("space-y-1.5", className)}
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
    >
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <KeyRound aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Invite code or link"
            autoFocus={autoFocus}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            placeholder="Invite code"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="h-12 rounded-xl bg-background/60 pl-9 font-mono tracking-wider"
            aria-invalid={!!error}
          />
        </div>
        <Button type="submit" size="lg" variant="outline" className="h-12 rounded-xl px-4">
          Join <ArrowRight />
        </Button>
      </div>
      {error && <p className="text-xs font-medium text-destructive">{error}</p>}
    </form>
  );
}

/** "You asked to join X · waiting" with a cancel button. */
export function PendingJoinCard({ request, className }: { request: MyJoinRequest; className?: string }) {
  const cancel = useCancelJoinRequest();
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex flex-col gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4 sm:flex-row sm:items-center", className)}
      data-tour="pending-join"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <TeamAvatar name={request.team.name} tag={request.team.tag} size="md" />
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.2em] text-warning uppercase">
            <Hourglass className="size-3.5" /> Waiting for the leader
          </p>
          <p className="truncate font-display text-lg leading-tight font-bold">You asked to join {request.team.name}</p>
          <p className="text-xs text-muted-foreground">We'll switch you over to your team as soon as they approve.</p>
        </div>
      </div>
      <Button variant="ghost" size="sm" className="self-start text-muted-foreground hover:text-destructive sm:self-center" disabled={cancel.isPending} onClick={() => cancel.mutate(request.id)}>
        {cancel.isPending ? <Loader2 className="animate-spin" /> : <X />} Cancel request
      </Button>
    </motion.div>
  );
}

/** Polls the profile while the player has no team and flips the session over when the leader approves. */
export function useWatchForApproval() {
  const qc = useQueryClient();
  const { hasTeam } = usePlayerSession();
  const profile = usePlayerProfile({ poll: !hasTeam });
  const announced = useRef(false);
  const team = profile.data?.team;
  useEffect(() => {
    if (!team || hasTeam || announced.current) return;
    announced.current = true;
    toast.success(`You're in ${team.name}!`, { description: "Your leader approved your request. Welcome to the squad.", duration: 8000 });
    void refreshMembership(qc);
  }, [team, hasTeam, qc]);
  return profile;
}

const HOW = [
  { icon: Crown, title: "Leader registers", text: "The team leader signs the team up for scrims and tournaments." },
  { icon: Megaphone, title: "Members ask", text: "Spotted a scrim? Tap “Ask my leader” and they get it on their home screen." },
  { icon: Ticket, title: "Everyone sees the slot", text: "Slot numbers, room IDs and results show up for the whole squad." },
];

/**
 * The full create / join UI for a player with no team. Lives on My team only (phase 5c) — everywhere else the
 * player browses freely and is asked for a team when they register.
 */
export function CreateOrJoinTeam() {
  const profile = useWatchForApproval();
  const [createOpen, setCreateOpen] = useState(false);
  const pending = profile.data?.pendingJoinRequest ?? null;

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <MyInvitesPanel />
      <section className="relative isolate overflow-hidden rounded-3xl border border-primary/20 bg-card shadow-sm animate-rise" data-tour="start-hero">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_0%_0%,color-mix(in_oklch,var(--primary)_22%,transparent),transparent_60%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(80%_70%_at_100%_100%,color-mix(in_oklch,var(--brand-400)_18%,transparent),transparent_65%)]" />
          <img src={markUrl} alt="" className="brand-ink absolute -right-16 -bottom-24 w-[26rem] max-w-none rotate-[-12deg] opacity-[0.1] sm:w-[34rem]" />
          <div className="absolute inset-0 bg-grid opacity-50 [mask-image:linear-gradient(to_bottom,#000,transparent_85%)]" />
          <div className="absolute inset-x-10 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent" />
        </div>

        <div className="p-5 sm:p-8">
          {pending && <PendingJoinCard request={pending} className="mb-5" />}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="group relative overflow-hidden rounded-2xl border border-primary/40 bg-background/60 p-5 shadow-glow backdrop-blur" data-tour="create-team">
              <div aria-hidden className="pointer-events-none absolute -top-16 -right-16 size-48 rounded-full bg-primary/25 blur-3xl transition-opacity group-hover:opacity-80" />
              <span className="relative flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-glow">
                <Shield className="size-6" />
              </span>
              <h2 className="relative mt-3 font-display text-2xl font-bold">Create your team</h2>
              <p className="relative mt-1 text-sm text-muted-foreground">Pick a name and tag. You'll be the leader and get an invite link for your squad.</p>
              <Button size="lg" className="relative mt-4 h-12 w-full text-base shadow-glow" onClick={() => setCreateOpen(true)}>
                <UserPlus /> Create a team
              </Button>
            </div>
            <div className="relative overflow-hidden rounded-2xl border bg-background/60 p-5 backdrop-blur" data-tour="join-code">
              <span className="flex size-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Users className="size-6" />
              </span>
              <h2 className="mt-3 font-display text-2xl font-bold">Join with a code</h2>
              <p className="mt-1 text-sm text-muted-foreground">Got an invite from your team leader? Open their link, or type the 8-character code here.</p>
              <JoinCodeForm className="mt-4" />
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3" data-tour="how-teams-work">
        {HOW.map((h, i) => {
          const Icon = h.icon;
          return (
            <motion.div
              key={h.title}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.08 }}
              className="flex items-start gap-3 rounded-2xl border bg-card/70 p-4"
            >
              <span className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="size-5" />
                <span className="absolute -top-1.5 -left-1.5 flex size-5 items-center justify-center rounded-full bg-primary font-display text-xs font-bold text-primary-foreground">{i + 1}</span>
              </span>
              <span className="min-w-0">
                <span className="block font-display text-lg leading-tight font-bold">{h.title}</span>
                <span className="block text-sm text-muted-foreground">{h.text}</span>
              </span>
            </motion.div>
          );
        })}
      </section>

      <CreateTeamDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
