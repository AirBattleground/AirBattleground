import { useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { ArrowRight, Ban, CheckCircle2, Crown, Hash, Hourglass, Link2Off, Loader2, LogIn, ShieldAlert, Users, X } from "lucide-react";
import { toast } from "sonner";
import { ApiError, bgmiIdSchema, normalizeInviteCode, type TeamInvitePreview } from "@7xen/shared";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { FullPageLoader } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Input } from "@7xen/ui/components/ui/input";
import { Textarea } from "@7xen/ui/components/ui/textarea";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { useAuth } from "@/lib/auth";
import { loginWithNext } from "@/lib/guards";
import { useCancelJoinRequest, useCreateJoinRequest, useInvitePreview, usePlayerProfile, useUpdateProfile } from "@/features/player/api";
import { applyApiError, BGMI_HINT, Field } from "@/features/player/forms";
import { PlayerAvatar } from "@/features/player/components/PlayerAvatar";
import { PlayerScene, SceneEyebrow } from "@/features/player/components/PlayerScene";

const STEPS: TourStep[] = [
  { title: "Team invite", description: "Someone invited you to their team. Check it's the right squad, then ask to join." },
  { element: '[data-tour="invite-team"]', title: "The team", description: "Team name, tag, leader and how many players are already in.", side: "bottom" },
  { element: '[data-tour="invite-action"]', title: "Request to join", description: "The team leader gets your request and approves it. You'll see the team as soon as they do.", side: "top" },
];

const schema = z.object({ bgmiId: z.union([bgmiIdSchema, z.literal("")]), message: z.string().trim().max(200) });
type Values = z.infer<typeof schema>;

/** Big centred status block used for every non-happy state. */
function StateCard({ icon, tone = "primary", title, children, action }: { icon: ReactNode; tone?: "primary" | "warning" | "destructive" | "success"; title: string; children?: ReactNode; action?: ReactNode }) {
  const tones = {
    primary: "bg-primary/10 text-primary",
    warning: "bg-warning/15 text-warning",
    destructive: "bg-destructive/10 text-destructive",
    success: "bg-success/15 text-success",
  };
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border bg-card/80 p-5 backdrop-blur" data-tour="invite-action">
      <span className={`flex size-11 items-center justify-center rounded-xl [&_svg]:size-6 ${tones[tone]}`}>{icon}</span>
      <h2 className="mt-3 font-display text-2xl leading-tight font-bold">{title}</h2>
      {children && <div className="mt-1 text-sm text-muted-foreground">{children}</div>}
      {action && <div className="mt-4 flex flex-wrap gap-2">{action}</div>}
    </motion.div>
  );
}

function TeamPreview({ invite }: { invite: TeamInvitePreview }) {
  const { team, leader, memberCount, maxMembers } = invite;
  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-card/80 p-5 shadow-glow backdrop-blur" data-tour="invite-team">
      <div aria-hidden className="pointer-events-none absolute -top-16 -right-16 size-48 rounded-full bg-primary/20 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-grid opacity-40 [mask-image:linear-gradient(to_bottom,#000,transparent)]" />
      <div className="relative flex items-center gap-4">
        <TeamAvatar name={team.name} tag={team.tag} size="lg" className="size-16 rounded-2xl text-lg ring-2 ring-primary/50" />
        <div className="min-w-0">
          <p className="font-mono text-xs font-semibold tracking-[0.3em] text-primary">[{team.tag}]</p>
          <h2 className="truncate font-display text-3xl leading-tight font-extrabold uppercase">{team.name}</h2>
        </div>
      </div>
      <div className="relative mt-4 grid grid-cols-2 gap-2 text-sm">
        <div className="flex min-w-0 items-center gap-2 rounded-xl border bg-background/60 p-2.5">
          <PlayerAvatar name={leader.ign ?? leader.displayName} url={leader.avatarUrl} size="sm" />
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
              <Crown className="size-3 text-warning" /> Leader
            </p>
            <p className="truncate font-semibold">{leader.ign ?? leader.displayName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-xl border bg-background/60 p-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Users className="size-4" />
          </span>
          <div>
            <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Players</p>
            <p className="font-display text-lg leading-none font-bold tabular-nums">
              {memberCount}
              <span className="text-sm text-muted-foreground">/{maxMembers}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function JoinPage() {
  usePageTour("player.join", STEPS);
  const { code: raw = "" } = useParams();
  const code = normalizeInviteCode(raw);
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const player = user?.role === "PLAYER" ? user.player : null;
  const ready = !!player && !player.needsOnboarding;

  const invite = useInvitePreview(code, ready);
  const profile = usePlayerProfile({ enabled: ready, poll: true });
  const join = useCreateJoinRequest();
  const cancel = useCancelJoinRequest();
  const update = useUpdateProfile();
  const [sent, setSent] = useState(false);

  const needsBgmi = !profile.data?.bgmiId && !player?.bgmiId;
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { bgmiId: "", message: "" } });
  const { register, handleSubmit, setError, formState } = form;
  const here = `/join/${code}`;

  if (isLoading) return <FullPageLoader />;
  if (user && user.role === "PLAYER" && player?.needsOnboarding) return <Navigate to={`/welcome?next=${encodeURIComponent(here)}`} replace />;

  const onSubmit = handleSubmit(async (v) => {
    try {
      if (needsBgmi) {
        if (!v.bgmiId) {
          setError("bgmiId", { message: "Add your BGMI ID first — teams need it for results." });
          return;
        }
        await update.mutateAsync({ bgmiId: v.bgmiId });
      }
      await join.mutateAsync({ code, message: v.message || undefined });
      setSent(true);
      toast.success("Request sent!", { description: "The team leader will approve it soon." });
    } catch (e) {
      const left = applyApiError(e, setError, ["bgmiId", "message"]);
      if (left) {
        if (e instanceof ApiError && ["ALREADY_IN_TEAM", "JOIN_REQUEST_PENDING", "TEAM_FULL", "INVITE_INVALID"].includes(e.code)) {
          void invite.refetch();
          void profile.refetch();
        }
        toast.error("Couldn't send your request", { description: left });
      }
    }
  });

  let body: ReactNode;
  if (!code) {
    body = <StateCard icon={<Link2Off />} tone="destructive" title="This link is incomplete" action={<Button asChild><Link to="/">Go home</Link></Button>}>Ask the team leader to send the invite link again.</StateCard>;
  } else if (!user) {
    body = (
      <StateCard
        icon={<LogIn />}
        title="Sign in to join the team"
        action={
          <Button size="lg" className="h-12 w-full rounded-xl text-base shadow-glow" onClick={() => navigate(loginWithNext(here))}>
            <LogIn /> Sign in to continue
          </Button>
        }
      >
        You've been invited with code <span className="font-mono font-semibold text-foreground">{code}</span>. Sign in with Google — we'll bring you right back here.
      </StateCard>
    );
  } else if (user.role !== "PLAYER") {
    body = (
      <StateCard icon={<ShieldAlert />} tone="warning" title="This link is for players" action={<Button asChild variant="outline"><Link to="/">Back to my dashboard</Link></Button>}>
        You're signed in as an organiser. Sign out and continue with Google as a player to join a team.
      </StateCard>
    );
  } else if (invite.isLoading || profile.isLoading) {
    body = (
      <div className="space-y-3">
        <div className="h-44 animate-pulse rounded-2xl bg-muted" />
        <div className="h-28 animate-pulse rounded-2xl bg-muted" />
      </div>
    );
  } else if (invite.isError) {
    const invalid = invite.error instanceof ApiError && (invite.error.code === "INVITE_INVALID" || invite.error.status === 404);
    body = (
      <StateCard
        icon={<Link2Off />}
        tone="destructive"
        title={invalid ? "This invite doesn't work any more" : "Couldn't open this invite"}
        action={
          <>
            {!invalid && <Button variant="outline" onClick={() => void invite.refetch()}>Try again</Button>}
            <Button asChild>
              <Link to="/team">Go to my home</Link>
            </Button>
          </>
        }
      >
        {invalid ? "The code may be mistyped, or the leader made a new one. Ask them for the latest link." : invite.error instanceof Error ? invite.error.message : null}
      </StateCard>
    );
  } else if (invite.data) {
    const t = invite.data;
    const myTeam = profile.data?.team ?? player?.team ?? null;
    const pending = profile.data?.pendingJoinRequest ?? null;
    let action: ReactNode;
    if (myTeam && myTeam.id === t.team.id) {
      action = (
        <StateCard icon={<CheckCircle2 />} tone="success" title={`You're in ${t.team.name}`} action={<Button asChild><Link to="/team/my-team">Open my team <ArrowRight /></Link></Button>}>
          Nothing to do here — you're already on this team.
        </StateCard>
      );
    } else if (myTeam) {
      action = (
        <StateCard icon={<Ban />} tone="warning" title={`You're already in ${myTeam.name}`} action={<Button asChild variant="outline"><Link to="/team/my-team">Go to my team</Link></Button>}>
          A player can be in one team at a time. Leave {myTeam.name} first if you want to join {t.team.name}.
        </StateCard>
      );
    } else if (sent || (pending && pending.team.id === t.team.id)) {
      action = (
        <StateCard
          icon={<Hourglass />}
          tone="warning"
          title="Request sent · waiting for the leader"
          action={
            <>
              <Button asChild>
                <Link to="/team">Go to my home</Link>
              </Button>
              {pending && (
                <Button
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate(pending.id, { onSuccess: () => setSent(false) })}
                >
                  <X /> Cancel request
                </Button>
              )}
            </>
          }
        >
          {t.leader.ign ?? t.leader.displayName} will see your request. Once they approve, the team shows up on your home screen — then tap “Ask my leader” on any scrim or tournament and your leader registers the team.
        </StateCard>
      );
    } else if (pending) {
      action = (
        <StateCard
          icon={<Hourglass />}
          tone="warning"
          title={`You already asked to join ${pending.team.name}`}
          action={
            <Button variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate(pending.id)}>
              {cancel.isPending ? <Loader2 className="animate-spin" /> : <X />} Cancel that request
            </Button>
          }
        >
          You can only have one request at a time. Cancel it to ask {t.team.name} instead.
        </StateCard>
      );
    } else if (t.full) {
      action = (
        <StateCard icon={<Users />} tone="warning" title="This team is full" action={<Button asChild variant="outline"><Link to="/team">Go to my home</Link></Button>}>
          {t.team.name} already has {t.maxMembers} players. Ask the leader to make room, or create your own team.
        </StateCard>
      );
    } else {
      action = (
        <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-2xl border bg-card/80 p-5 backdrop-blur" data-tour="invite-action">
          {needsBgmi && (
            <Field id="bgmiId" label="Your BGMI ID" error={formState.errors.bgmiId?.message} hint={`Teams need it for results. ${BGMI_HINT}`}>
              <div className="relative">
                <Hash aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="bgmiId" inputMode="numeric" autoFocus placeholder="5123456789" className="h-12 rounded-xl bg-background/60 pl-10 font-mono tracking-wider" aria-invalid={!!formState.errors.bgmiId} {...register("bgmiId")} />
              </div>
            </Field>
          )}
          <Field id="message" label={<>Message to the leader <span className="font-normal text-muted-foreground">(optional)</span></>} error={formState.errors.message?.message}>
            <Textarea id="message" rows={2} maxLength={200} placeholder="Hi! I play IGL / assaulter…" className="rounded-xl bg-background/60" {...register("message")} />
          </Field>
          <Button type="submit" size="lg" disabled={formState.isSubmitting} className="group h-12 w-full justify-between rounded-xl px-5 text-base font-semibold shadow-glow">
            {formState.isSubmitting ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" /> Sending…
              </span>
            ) : (
              <>
                Request to join <ArrowRight className="size-5 transition-transform group-hover:translate-x-1" />
              </>
            )}
          </Button>
          <p className="text-center text-xs text-muted-foreground">The leader approves every new player.</p>
        </form>
      );
    }
    body = (
      <div className="space-y-4">
        <TeamPreview invite={t} />
        {action}
      </div>
    );
  }

  return (
    <PlayerScene>
      <SceneEyebrow>Team invite</SceneEyebrow>
      <h1 className="font-display text-4xl leading-none font-bold tracking-tight sm:text-5xl">You're invited.</h1>
      <p className="mt-3 mb-7 text-sm text-muted-foreground">Join a squad on AirBattleground and play scrims and tournaments together.</p>
      {body}
    </PlayerScene>
  );
}
