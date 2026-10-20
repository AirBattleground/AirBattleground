import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
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
import { useDateFormat, useT } from "@/i18n/core";
import { myTeamMsg } from "@/i18n/team";

const name = (p: { ign: string | null; displayName: string }) => p.ign ?? p.displayName;

interface ConfirmState {
  title: string;
  description: ReactNode;
  action: string;
  destructive?: boolean;
  run: () => void;
}

function Confirm({ state, onClose }: { state: ConfirmState | null; onClose: () => void }) {
  const t = useT(myTeamMsg);
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
              <AlertDialogCancel>{t("not_now")}</AlertDialogCancel>
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
  const t = useT(myTeamMsg);
  const fmt = useDateFormat();
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
            {r.player.bgmiId ? <span className="font-mono">BGMI {r.player.bgmiId}</span> : t("no_bgmi_yet")} · {t("asked_at", { when: fmt(r.createdAt, "d MMM, h:mm a") })}
          </p>
          {r.message && <p className="mt-1 rounded-lg bg-muted/60 px-2 py-1 text-sm">“{r.message}”</p>}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button className="flex-1 sm:flex-none" disabled={busy} onClick={() => approve.mutate({ id: r.id, name: n })}>
          <UserCheck /> {t("approve")}
        </Button>
        <Button variant="outline" className="flex-1 text-muted-foreground hover:text-destructive sm:flex-none" disabled={busy} onClick={() => reject.mutate({ id: r.id, name: n })}>
          <X /> {t("reject")}
        </Button>
      </div>
    </motion.li>
  );
}

function MemberRow({ m, me, leaderView, onAsk }: { m: TeamMemberRow; me: boolean; leaderView: boolean; onAsk: (c: ConfirmState) => void }) {
  const t = useT(myTeamMsg);
  const fmt = useDateFormat();
  const remove = useRemoveMember();
  const transfer = useTransferLeader();
  const n = name(m);
  const leader = m.role === "LEADER";
  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <div className="relative">
        <PlayerAvatar name={n} url={m.avatarUrl} size="md" className={cn(leader && "ring-2 ring-warning/70")} />
        {leader && (
          <span className="absolute -top-2 -right-2 flex size-5 items-center justify-center rounded-full bg-warning text-warning-foreground shadow" title={t("team_leader")}>
            <Crown className="size-3" />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate font-semibold">
          <span className="truncate">{n}</span>
          {me && <span className="rounded-md bg-primary/15 px-1.5 py-px text-[10px] font-bold tracking-wider text-primary uppercase">{t("you")}</span>}
          {leader && <span className="rounded-md bg-warning/15 px-1.5 py-px text-[10px] font-bold tracking-wider text-warning uppercase">{t("leader")}</span>}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {m.bgmiId ? (
            <span className="inline-flex items-center gap-0.5 font-mono">
              <Hash className="size-3" />
              {m.bgmiId}
            </span>
          ) : (
            t("no_bgmi")
          )}{" "}
          · {t("joined", { when: fmt(m.joinedAt, "d MMM yyyy") })}
        </p>
      </div>
      {leaderView && !me && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t("actions_for", { name: n })} disabled={remove.isPending || transfer.isPending}>
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() =>
                onAsk({
                  title: t("make_leader_q", { name: n }),
                  description: t("make_leader_desc"),
                  action: t("make_leader_yes"),
                  run: () => transfer.mutate({ userId: m.id, name: n }),
                })
              }
            >
              <Crown /> {t("make_leader")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() =>
                onAsk({
                  title: t("remove_q", { name: n }),
                  description: t("remove_desc"),
                  action: t("remove_from_team"),
                  destructive: true,
                  run: () => remove.mutate({ userId: m.id, name: n }),
                })
              }
            >
              <UserMinus /> {t("remove_from_team")}
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

/** Phase 5c: the one place with the full create / join UI for a player without a team. */
function NoTeamView() {
  const t = useT(myTeamMsg);
  const steps = useMemo<TourStep[]>(
    () => [
      { title: t("start_tour_title"), description: t("start_tour_desc") },
      { element: '[data-tour="create-team"]', title: t("start_create_title"), description: t("start_create_desc"), side: "bottom" },
      { element: '[data-tour="join-code"]', title: t("start_join_title"), description: t("start_join_desc"), side: "top" },
      { element: '[data-tour="how-teams-work"]', title: t("start_how_title"), description: t("start_how_desc"), side: "top" },
    ],
    [t],
  );
  usePageTour("team.my-team-start", steps);
  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader eyebrow={t("eyebrow")} title={t("no_team_title")} description={t("no_team_desc")} className="mb-2" />
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
  const tr = useT(myTeamMsg);
  const steps = useMemo<TourStep[]>(
    () => [
      { title: tr("tour_title"), description: tr("tour_desc") },
      { element: '[data-tour="team-logo"]', title: tr("tour_logo_title"), description: tr("tour_logo_desc"), side: "bottom" },
      { element: '[data-tour="team-invite"]', title: tr("tour_invite_title"), description: tr("tour_invite_desc"), side: "bottom" },
      { element: '[data-tour="join-requests"]', title: tr("tour_requests_title"), description: tr("tour_requests_desc"), side: "top" },
      { element: '[data-tour="team-members"]', title: tr("tour_members_title"), description: tr("tour_members_desc"), side: "top" },
      { element: '[data-tour="team-danger"]', title: tr("tour_danger_title"), description: tr("tour_danger_desc"), side: "top" },
    ],
    [tr],
  );
  usePageTour("team.my-team", steps);
  const { user, hasTeam } = usePlayerSession();
  const q = usePlayerTeam({ enabled: hasTeam });
  const navigate = useNavigate();
  const rotate = useRotateInvite();
  const disband = useDisbandTeam();
  const leave = useLeaveTeam();
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  if (q.isLoading) return <MyTeamSkeleton />;
  if (q.isError || !q.data) return <QueryError error={q.error} onRetry={() => void q.refetch()} title={tr("load_fail")} />;

  const t = q.data;
  const leaderView = t.myRole === "LEADER";
  const members = [...t.members].sort((a, b) => (a.role === b.role ? a.joinedAt.localeCompare(b.joinedAt) : a.role === "LEADER" ? -1 : 1));
  const others = t.members.length - 1;

  const askRotate = () =>
    setConfirm({
      title: tr("rotate_q"),
      description: tr("rotate_desc"),
      action: tr("rotate_yes"),
      run: () => rotate.mutate(),
    });

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow={tr("eyebrow")}
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
            {tr.rich(
              "players_role",
              { b: (c) => <span className="font-semibold text-foreground">{c}</span> },
              { count: t.members.length, max: t.maxMembers, role: leaderView ? tr("role_leader") : tr("role_member") },
            )}
            {!leaderView && tr("member_hint")}
          </>
        }
        actions={
          leaderView ? (
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil /> {tr("edit_team")}
            </Button>
          ) : undefined
        }
        className="mb-2"
      />

      {leaderView && t.inviteCode && <InvitePlayersCard team={t} onRotate={askRotate} />}

      {leaderView && (
        <Section title={tr("join_requests")} icon={<UserPlus />} count={t.joinRequests.length} tour="join-requests">
          {t.joinRequests.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground sm:px-5">{tr("no_requests")}</p>
          ) : (
            <ul className="divide-y">
              {t.joinRequests.map((r) => (
                <RequestRow key={r.id} r={r} />
              ))}
            </ul>
          )}
        </Section>
      )}

      <Section title={tr("members")} icon={<Users />} count={t.members.length} tour="team-members">
        <ul className="divide-y">
          {members.map((m) => (
            <MemberRow key={m.id} m={m} me={m.id === user?.id} leaderView={leaderView} onAsk={setConfirm} />
          ))}
        </ul>
        {t.members.length < 4 && (
          <p className="border-t px-4 py-3 text-xs text-muted-foreground sm:px-5">
            {tr("squad_hint", { max: t.maxMembers })} {leaderView ? tr("invite_more_leader") : tr("invite_more_member")}
          </p>
        )}
      </Section>

      <section className="flex flex-col gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:p-5" data-tour="team-danger">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-bold">{leaderView ? tr("disband_team") : tr("leave_team")}</h2>
          <p className="text-sm text-muted-foreground">
            {leaderView
              ? others > 0
                ? tr("disband_hint_others")
                : tr("disband_hint_alone")
              : tr("leave_hint")}
          </p>
        </div>
        {leaderView ? (
          <Button
            variant="destructive"
            disabled={disband.isPending}
            onClick={() =>
              setConfirm({
                title: tr("disband_q", { team: t.name }),
                description: tr("disband_desc"),
                action: tr("disband_yes"),
                destructive: true,
                run: () => disband.mutate(undefined, { onSuccess: () => navigate("/team", { replace: true }) }),
              })
            }
          >
            <ShieldX /> {tr("disband_team")}
          </Button>
        ) : (
          <Button
            variant="destructive"
            disabled={leave.isPending}
            onClick={() =>
              setConfirm({
                title: tr("leave_q", { team: t.name }),
                description: tr("leave_desc"),
                action: tr("leave_yes"),
                destructive: true,
                run: () => leave.mutate(undefined, { onSuccess: () => navigate("/team", { replace: true }) }),
              })
            }
          >
            <LogOut /> {tr("leave_team")}
          </Button>
        )}
      </section>

      <Confirm state={confirm} onClose={() => setConfirm(null)} />
      <EditTeamDialog open={editOpen} onOpenChange={setEditOpen} team={{ name: t.name, tag: t.tag }} />
    </div>
  );
}
