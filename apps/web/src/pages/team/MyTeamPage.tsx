import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { format, parseISO } from "date-fns";
import {
  Check,
  Copy,
  Crown,
  Hash,
  Link2,
  LogOut,
  MoreVertical,
  Pencil,
  RefreshCw,
  Share2,
  ShieldX,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { inviteLinkPath, type PlayerTeam, type TeamJoinRequestRow, type TeamMemberRow } from "@7xen/shared";
import { PageHeader } from "@7xen/ui/components/brand/page";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
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
import { NoTeamGate } from "@/features/player/components/NoTeamGate";
import { PlayerAvatar } from "@/features/player/components/PlayerAvatar";
import { QueryError } from "@/features/team/components/QueryError";

const STEPS: TourStep[] = [
  { title: "My team", description: "Everything about your squad: who's in, how to invite players and who leads." },
  { element: '[data-tour="team-invite"]', title: "Invite your squad", description: "Share this link or code on WhatsApp. Players who open it can ask to join.", side: "bottom" },
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
// Invite
// ---------------------------------------------------------------------------
function InviteCard({ team, onRotate }: { team: PlayerTeam; onRotate: () => void }) {
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const code = team.inviteCode ?? "";
  const link = `${window.location.origin}${inviteLinkPath(code)}`;
  const text = `Join ${team.name} [${team.tag}] on AirBattleground: ${link}`;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const copy = async (what: "link" | "code") => {
    try {
      await navigator.clipboard.writeText(what === "link" ? link : code);
      setCopied(what);
      toast.success(what === "link" ? "Invite link copied" : "Invite code copied");
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      toast.error("Couldn't copy", { description: "Select the text and copy it by hand." });
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: `Join ${team.name}`, text, url: link });
    } catch {
      /* cancelled */
    }
  };
  const full = team.members.length >= team.maxMembers;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-primary/30 bg-card p-4 shadow-glow sm:p-5" data-tour="team-invite">
      <div aria-hidden className="pointer-events-none absolute -top-20 -right-16 size-56 rounded-full bg-primary/20 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-grid opacity-40 [mask-image:linear-gradient(to_bottom,#000,transparent)]" />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.25em] text-primary uppercase">
            <UserPlus className="size-3.5" /> Invite players
          </p>
          <h2 className="mt-0.5 font-display text-2xl leading-tight font-bold">Share your invite</h2>
          <p className="text-sm text-muted-foreground">{full ? "Your team is full — remove someone to make room." : "Anyone with the link can ask to join. You approve each one."}</p>
        </div>
      </div>

      <div className="relative mt-4 flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <button
          type="button"
          onClick={() => void copy("code")}
          className="group flex flex-col items-center justify-center rounded-xl border border-dashed border-primary/50 bg-background/70 px-5 py-3 outline-none transition-colors hover:bg-primary/10 focus-visible:ring-[3px] focus-visible:ring-ring/50"
          aria-label={`Invite code ${code}. Tap to copy.`}
        >
          <span className="text-[10px] font-semibold tracking-[0.25em] text-muted-foreground uppercase">Code</span>
          <span className="font-mono text-2xl font-bold tracking-[0.25em] text-primary sm:text-3xl">{code}</span>
          <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
            {copied === "code" ? <Check className="size-3 text-success" /> : <Copy className="size-3" />} {copied === "code" ? "Copied" : "Tap to copy"}
          </span>
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex min-w-0 items-center gap-2 rounded-xl border bg-background/70 px-3 py-2.5 text-sm">
            <Link2 className="size-4 shrink-0 text-primary" />
            <span className="truncate font-mono text-xs text-muted-foreground sm:text-sm">{link}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Button onClick={() => void copy("link")} className="shadow-glow">
              {copied === "link" ? <Check /> : <Copy />} Copy link
            </Button>
            <Button asChild variant="outline" className="border-success/40 text-success hover:bg-success/10 hover:text-success">
              <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
                <WhatsAppIcon /> WhatsApp
              </a>
            </Button>
            {canShare && (
              <Button variant="outline" onClick={() => void share()} className="col-span-2 sm:col-span-1">
                <Share2 /> Share…
              </Button>
            )}
          </div>
        </div>
      </div>
      <button type="button" onClick={onRotate} className="relative mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
        <RefreshCw className="size-3.5" /> Make a new code (old links stop working)
      </button>
    </section>
  );
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4 fill-current">
      <path d="M17.5 14.4c-.3-.1-1.8-.9-2-1s-.5-.1-.7.1-.8 1-.9 1.2-.3.2-.6.1a8.2 8.2 0 0 1-4-3.5c-.3-.5.3-.5.9-1.6.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6a1.2 1.2 0 0 0-.8.4 3.5 3.5 0 0 0-1.1 2.6 6 6 0 0 0 1.3 3.2 13.9 13.9 0 0 0 5.3 4.7c2 .8 2.7.9 3.7.7.6-.1 1.8-.7 2-1.4s.3-1.3.2-1.4-.3-.2-.6-.3zM12 21.8a9.8 9.8 0 0 1-5-1.4l-.4-.2-3.7 1 1-3.6-.2-.4A9.8 9.8 0 1 1 12 21.8zm0-21.6A11.8 11.8 0 0 0 1.9 17.9L.2 24l6.3-1.6A11.8 11.8 0 1 0 12 .2z" />
    </svg>
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

export default function MyTeamPage() {
  usePageTour("team.my-team", STEPS);
  const { user, hasTeam } = usePlayerSession();
  const q = usePlayerTeam({ enabled: hasTeam });
  const navigate = useNavigate();
  const rotate = useRotateInvite();
  const disband = useDisbandTeam();
  const leave = useLeaveTeam();
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  if (!hasTeam || q.data === null) return <NoTeamGate what="your team" />;
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
            <TeamAvatar name={t.name} tag={t.tag} size="lg" className="shadow-glow" />
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

      {leaderView && t.inviteCode && <InviteCard team={t} onRotate={askRotate} />}

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
