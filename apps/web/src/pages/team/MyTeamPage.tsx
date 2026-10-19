import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { format, parseISO } from "date-fns";
import {
  Crown,
  Hash,
  LogOut,
  MoreVertical,
  Pencil,
  ShieldX,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { type PlayerTeam, type TeamJoinRequestRow, type TeamMemberRow } from "@7xen/shared";
import { PageHeader } from "@7xen/ui/components/brand/page";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@7xen/ui/components/ui/dropdown-menu";
import { cn } from "@7xen/ui/lib/utils";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { usePlayerSession } from "@/lib/auth";
import {
  useApproveJoin,
  useDisbandTeam,
  useLeaveTeam,
  usePlayerTeam,
  useRejectJoin,
  useRemoveMember,
  useRotateInvite,
  useTransferLeader,
} from "@/features/player/api";
import { EditTeamDialog } from "@/features/player/components/CreateTeamDialog";
import { CreateOrJoinTeam } from "@/features/player/components/NoTeamHome";
import { InvitePlayersCard } from "@/features/player/components/InviteByBgmiCard";
import { PlayerAvatar } from "@/features/player/components/PlayerAvatar";
import { TeamLogo } from "@/features/player/components/TeamLogo";
import { TeamLogoEditor } from "@/features/player/components/TeamLogoEditor";
import { QueryError } from "@/features/team/components/QueryError";

const STEPS: TourStep[] = [
  { title: "My team", description: "Everything about your squad: who's in, how to invite players and who leads." },
  { element: '[data-tour="team-logo"]', title: "Team logo", description: "Leaders can tap the logo to upload one. It shows next to your team name.", side: "bottom" },
  { element: '[data-tour="team-invite"]', title: "Invite players", description: "Type a player's BGMI ID to invite them, or share the link on WhatsApp so they can ask to join.", side: "bottom" },
  { element: '[data-tour="join-requests"]', title: "Join requests", description: "Approve the players you know. Reject anyone you don't.", side: "top" },
  { element: '[data-tour="team-members"]', title: "Members", description: "Your squad with their in-game names and BGMI IDs. The crown marks the leader.", side: "top" },
  { element: '[data-tour="team-danger"]', title: "Leave or disband", description: "Members can leave any time. The leader can hand over leadership or disband the team.", side: "top" },
];

const name = (p: { ign: string | null; displayName: string }) => p.ign ?? p.displayName;

interface ConfirmState {
  title: string;
  description: ReactNode;
  action: string;
  destructive?: boolean;
  run: () => void;
}

function Confirm({ state, onClose }: { state: ConfirmState | null; onClose: () => void }) {
  return (
    <AlertDialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        {state && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle className="font-display text-2xl">{state.title}</AlertDialogTitle>
              <AlertDialogDescription>{state.description}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Not now</AlertDialogCancel>
              <AlertDialogAction variant={state.destructive ? "destructive" : "default"} onClick={state.run}>
                {state.action}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Section({ title, icon, count, children, className, tour, action }: { title: string; icon: ReactNode; count?: number; children: ReactNode; className?: string; tour?: string; action?: ReactNode }) {
  return (
    <section className={cn("rounded-2xl border bg-card shadow-sm", className)} data-tour={tour}>
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
        <h2 className="flex items-center gap-2 font-display text-xl font-bold [&_svg]:size-5 [&_svg]:text-primary">
          {icon} {title}
          {count != null && <span className="rounded-full bg-muted px-2 py-0.5 font-sans text-xs font-semibold text-muted-foreground tabular-nums">{count}</span>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Requests & members
// ---------------------------------------------------------------------------
function RequestRow({ r }: { r: TeamJoinRequestRow }) {
  const approve = useApproveJoin();
  const reject = useRejectJoin();
  const n = name(r.player);
  const busy = approve.isPending || reject.isPending;
  return (
    <motion.li layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <PlayerAvatar name={n} url={r.player.avatarUrl} size="md" />
        <div className="min-w-0">
          <p className="truncate font-semibold">{n}</p>
          <p className="truncate text-xs text-muted-foreground">
            {r.player.bgmiId ? <span className="font-mono">BGMI {r.player.bgmiId}</span> : "No BGMI ID yet"} · asked {format(parseISO(r.createdAt), "d MMM, h:mm a")}
          </p>
          {r.message && <p className="mt-1 rounded-lg bg-muted/60 px-2 py-1 text-sm">“{r.message}”</p>}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button className="flex-1 sm:flex-none" disabled={busy} onClick={() => approve.mutate({ id: r.id, name: n })}>
          <UserCheck /> Approve
        </Button>
        <Button variant="outline" className="flex-1 text-muted-foreground hover:text-destructive sm:flex-none" disabled={busy} onClick={() => reject.mutate({ id: r.id, name: n })}>
          <X /> Reject
        </Button>
      </div>
    </motion.li>
  );
}

function MemberRow({ m, me, leaderView, onAsk }: { m: TeamMemberRow; me: boolean; leaderView: boolean; onAsk: (c: ConfirmState) => void }) {
  const remove = useRemoveMember();
  const transfer = useTransferLeader();
  const n = name(m);
  const leader = m.role === "LEADER";
  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <div className="relative">
        <PlayerAvatar name={n} url={m.avatarUrl} size="md" className={cn(leader && "ring-2 ring-warning/70")} />
        {leader && (
          <span className="absolute -top-2 -right-2 flex size-5 items-center justify-center rounded-full bg-warning text-warning-foreground shadow" title="Team leader">
            <Crown className="size-3" />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate font-semibold">
          <span className="truncate">{n}</span>
          {me && <span className="rounded-md bg-primary/15 px-1.5 py-px text-[10px] font-bold tracking-wider text-primary uppercase">You</span>}
          {leader && <span className="rounded-md bg-warning/15 px-1.5 py-px text-[10px] font-bold tracking-wider text-warning uppercase">Leader</span>}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {m.bgmiId ? (
            <span className="inline-flex items-center gap-0.5 font-mono">
              <Hash className="size-3" />
              {m.bgmiId}
            </span>
          ) : (
            "No BGMI ID"
          )}{" "}
          · joined {format(parseISO(m.joinedAt), "d MMM yyyy")}
        </p>
      </div>
      {leaderView && !me && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Actions for ${n}`} disabled={remove.isPending || transfer.isPending}>
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() =>
                onAsk({
                  title: `Make ${n} the leader?`,
                  description: "They'll register for scrims and approve new players. You stay in the team as a member.",
                  action: "Yes, make leader",
                  run: () => transfer.mutate({ userId: m.id, name: n }),
                })
              }
            >
              <Crown /> Make leader
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() =>
                onAsk({
                  title: `Remove ${n}?`,
                  description: "They leave the team straight away. They can ask to join again with your invite link.",
                  action: "Remove from team",
                  destructive: true,
                  run: () => remove.mutate({ userId: m.id, name: n }),
                })
              }
            >
              <UserMinus /> Remove from team
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

function MyTeamSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-24 animate-pulse rounded-2xl bg-muted" />
      <div className="h-44 animate-pulse rounded-2xl bg-muted" />
      <div className="h-64 animate-pulse rounded-2xl bg-muted" />
    </div>
  );
}

const START_STEPS: TourStep[] = [
  { title: "Get your squad together", description: "Scrims and tournaments are played as a team. This is where you make one or join one." },
  { element: '[data-tour="create-team"]', title: "Create your team", description: "Start your own squad. You become the leader and get an invite link to share.", side: "bottom" },
  { element: '[data-tour="join-code"]', title: "Join with a code", description: "Got an invite from a friend? Type their code or paste the link here.", side: "top" },
  { element: '[data-tour="how-teams-work"]', title: "How teams work", description: "The leader registers; members tap “Ask my leader”. Everyone sees the slots and results.", side: "top" },
];

/** Phase 5c: the one place with the full create / join UI for a player without a team. */
function NoTeamView() {
  usePageTour("team.my-team-start", START_STEPS);
  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader eyebrow="My team" title="You're not in a team yet" description="Create your own squad, or join your friends with their invite code. You can browse scrims and tournaments either way." className="mb-2" />
      <CreateOrJoinTeam />
    </div>
  );
}

export default function MyTeamPage() {
  const { hasTeam } = usePlayerSession();
  const q = usePlayerTeam({ enabled: hasTeam });
  if (!hasTeam || q.data === null) return <NoTeamView />;
  return <MyTeamView />;
}

function MyTeamView() {
  usePageTour("team.my-team", STEPS);
  const { user, hasTeam } = usePlayerSession();
  const q = usePlayerTeam({ enabled: hasTeam });
  const navigate = useNavigate();
  const rotate = useRotateInvite();
  const disband = useDisbandTeam();
  const leave = useLeaveTeam();
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  if (q.isLoading) return <MyTeamSkeleton />;
  if (q.isError || !q.data) return <QueryError error={q.error} onRetry={() => void q.refetch()} title="Couldn't load your team" />;

  const t = q.data;
  const leaderView = t.myRole === "LEADER";
  const members = [...t.members].sort((a, b) => (a.role === b.role ? a.joinedAt.localeCompare(b.joinedAt) : a.role === "LEADER" ? -1 : 1));
  const others = t.members.length - 1;

  const askRotate = () =>
    setConfirm({
      title: "Make a new invite code?",
      description: "The old link and code stop working. Anyone you already sent it to will need the new one.",
      action: "Make a new code",
      run: () => rotate.mutate(),
    });

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="My team"
        title={
          <span className="flex items-center gap-3">
            {leaderView ? <TeamLogoEditor name={t.name} tag={t.tag} logoUrl={t.logoUrl} /> : <TeamLogo name={t.name} tag={t.tag} logoUrl={t.logoUrl} size="lg" className="shadow-glow" />}
            <span className="min-w-0">
              <span className="block truncate uppercase">{t.name}</span>
              <span className="block font-mono text-xs font-semibold tracking-[0.3em] text-primary">[{t.tag}]</span>
            </span>
          </span>
        }
        description={
          <>
            {t.members.length}/{t.maxMembers} players · you're the <span className="font-semibold text-foreground">{leaderView ? "leader" : "member"}</span>
            {!leaderView && " — your leader registers for scrims; tap “Ask my leader” on any scrim."}
          </>
        }
        actions={
          leaderView ? (
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil /> Edit team
            </Button>
          ) : undefined
        }
        className="mb-2"
      />

      {leaderView && t.inviteCode && <InvitePlayersCard team={t} onRotate={askRotate} />}

      {leaderView && (
        <Section title="Join requests" icon={<UserPlus />} count={t.joinRequests.length} tour="join-requests">
          {t.joinRequests.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground sm:px-5">No one's waiting. Share your invite link and new requests show up here.</p>
          ) : (
            <ul className="divide-y">
              {t.joinRequests.map((r) => (
                <RequestRow key={r.id} r={r} />
              ))}
            </ul>
          )}
        </Section>
      )}

      <Section title="Members" icon={<Users />} count={t.members.length} tour="team-members">
        <ul className="divide-y">
          {members.map((m) => (
            <MemberRow key={m.id} m={m} me={m.id === user?.id} leaderView={leaderView} onAsk={setConfirm} />
          ))}
        </ul>
        {t.members.length < 4 && (
          <p className="border-t px-4 py-3 text-xs text-muted-foreground sm:px-5">A squad is 4 players (up to {t.maxMembers} with subs). {leaderView ? "Invite more with the link above." : "Ask your leader to invite more."}</p>
        )}
      </Section>

      <section className="flex flex-col gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:p-5" data-tour="team-danger">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-bold">{leaderView ? "Disband team" : "Leave team"}</h2>
          <p className="text-sm text-muted-foreground">
            {leaderView
              ? others > 0
                ? "Want to leave instead? Make someone else the leader first (⋮ next to their name). Disbanding removes the team for everyone."
                : "Removes the team. You can't disband while the team has upcoming scrims or an active tournament."
              : "You'll leave right away. You can join another team after."}
          </p>
        </div>
        {leaderView ? (
          <Button
            variant="destructive"
            disabled={disband.isPending}
            onClick={() =>
              setConfirm({
                title: `Disband ${t.name}?`,
                description: "Everyone leaves the team and the invite link stops working. This can't be undone.",
                action: "Yes, disband",
                destructive: true,
                run: () => disband.mutate(undefined, { onSuccess: () => navigate("/team", { replace: true }) }),
              })
            }
          >
            <ShieldX /> Disband team
          </Button>
        ) : (
          <Button
            variant="destructive"
            disabled={leave.isPending}
            onClick={() =>
              setConfirm({
                title: `Leave ${t.name}?`,
                description: "You won't see the team's slots or results any more. You can ask to join again with an invite link.",
                action: "Yes, leave",
                destructive: true,
                run: () => leave.mutate(undefined, { onSuccess: () => navigate("/team", { replace: true }) }),
              })
            }
          >
            <LogOut /> Leave team
          </Button>
        )}
      </section>

      <Confirm state={confirm} onClose={() => setConfirm(null)} />
      <EditTeamDialog open={editOpen} onOpenChange={setEditOpen} team={{ name: t.name, tag: t.tag }} />
    </div>
  );
}
