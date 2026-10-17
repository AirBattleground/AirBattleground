import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertTriangle, Crown, Mail, Phone, RefreshCw, SearchX, Shield, ShieldCheck, ShieldPlus, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import type { TeamRow } from "@7xen/shared";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@7xen/ui/components/ui/table";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { CredentialsDialog, type Credentials } from "@/components/CredentialsDialog";
import { ListSkeleton } from "@/components/ListSkeleton";
import { ResetPasswordDialog, type ResetTarget } from "@/components/ResetPasswordDialog";
import { RowActions } from "@/components/RowActions";
import { SearchInput } from "@/components/SearchInput";
import { ActivePill } from "@/components/StatusPill";
import { ToggleActiveDialog, type ToggleTarget } from "@/components/ToggleActiveDialog";
import { useAdminStats } from "@/features/stats/api";
import { useResetTeamPassword, useTeams, useUpdateTeam } from "@/features/teams/api";
import { CreateTeamDialog, EditTeamDialog } from "@/features/teams/dialogs";
import { useCreateParam } from "@/hooks/use-create-param";
import { useDebounced } from "@/hooks/use-debounce";
import { useIsDesktop } from "@/hooks/use-media-query";
import { errorMessage } from "@/lib/forms";
import { relativeTime } from "@/lib/format";

const TOUR: TourStep[] = [
  { title: "Teams", description: "Teams can't sign up on their own yet, so you create their logins here." },
  { element: '[data-tour="create-team"]', title: "Add a team", description: "Enter the team name, a short tag and a password. You'll get a message to send to the captain.", side: "bottom" },
  { element: '[data-tour="search"]', title: "Search", description: "Find a team by name, tag, captain or username.", side: "bottom" },
  { element: '[data-tour="teams-list"]', title: "Every team on 7xen", description: "Check who is active, how many scrims they've registered for and when they last signed in.", side: "top" },
  { element: '[data-tour="row-actions"]', title: "Help a team", description: "Captain forgot the password? Reset it here. You can also edit details or disable a team.", side: "left" },
];

export default function TeamsPage() {
  usePageTour("admin.teams", TOUR);
  const isDesktop = useIsDesktop();
  const stats = useAdminStats();
  const approvals = stats.data?.teamRequests.pending ?? 0;
  // ?q= prefills the search (e.g. "View team" from Team approvals)
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("q") ?? "");
  const q = useDebounced(search.trim(), 300);
  const list = useTeams(q);
  const update = useUpdateTeam();
  const reset = useResetTeamPassword();

  const [createOpen, setCreateOpen] = useCreateParam();
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [editing, setEditing] = useState<TeamRow | null>(null);
  const [resetting, setResetting] = useState<ResetTarget | null>(null);
  const [toggling, setToggling] = useState<ToggleTarget | null>(null);

  const items = list.data?.items ?? [];
  const actionsFor = (t: TeamRow, i: number) => (
    <RowActions
      name={t.name}
      isActive={t.isActive}
      tour={i === 0 ? "row-actions" : undefined}
      onEdit={() => setEditing(t)}
      onReset={() => setResetting({ id: t.id, name: t.name, username: t.username })}
      onToggle={() => setToggling({ id: t.id, name: t.name, isActive: t.isActive })}
    />
  );

  const createBtn = (
    <Button size="lg" onClick={() => setCreateOpen(true)} data-tour="create-team" className="shadow-glow">
      <ShieldPlus /> Create team login
    </Button>
  );

  let body: ReactNode;
  if (list.isPending) body = <ListSkeleton />;
  else if (list.isError)
    body = (
      <EmptyState
        icon={<AlertTriangle />}
        title="Couldn't load teams"
        description={errorMessage(list.error)}
        action={
          <Button variant="outline" onClick={() => list.refetch()}>
            <RefreshCw /> Try again
          </Button>
        }
      />
    );
  else if (!items.length)
    body = q ? (
      <EmptyState icon={<SearchX />} title="No teams match" description={`Nothing found for "${q}". Check the spelling or clear the search.`} action={<Button variant="outline" onClick={() => setSearch("")}>Clear search</Button>} />
    ) : (
      <EmptyState icon={<Shield />} title="No teams yet" description="Create a login for the first team so they can register for scrims." action={createBtn} />
    );
  else if (isDesktop)
    body = (
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-4">Team</TableHead>
              <TableHead>Captain</TableHead>
              <TableHead>Username</TableHead>
              <TableHead className="text-right">Registrations</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last login</TableHead>
              <TableHead className="w-12 pr-4"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((t, i) => (
              <motion.tr
                key={t.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 10) * 0.03 }}
                className="border-b transition-colors last:border-0 hover:bg-muted/50"
              >
                <TableCell className="pl-4">
                  <div className="flex items-center gap-3">
                    <TeamAvatar name={t.name} tag={t.tag} className={t.isActive ? "" : "opacity-50 grayscale"} />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{t.name}</div>
                      <div className="text-xs font-semibold tracking-wider text-primary">
                        [{t.tag}]
                        {t.requestedBy && <span className="ml-2 font-normal tracking-normal text-muted-foreground">via {t.requestedBy.displayName}</span>}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{t.captainName ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">@{t.username}</TableCell>
                <TableCell className="text-right font-display text-lg font-bold">{t.registrationCount}</TableCell>
                <TableCell><ActivePill active={t.isActive} /></TableCell>
                <TableCell className="text-muted-foreground" title={t.lastLoginAt ?? undefined}>{relativeTime(t.lastLoginAt)}</TableCell>
                <TableCell className="pr-4 text-right">{actionsFor(t, i)}</TableCell>
              </motion.tr>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  else
    body = (
      <ul className="grid gap-3">
        {items.map((t, i) => (
          <motion.li
            key={t.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i, 10) * 0.03 }}
            className="rounded-xl border bg-card p-4 shadow-sm"
          >
            <div className="flex items-start gap-3">
              <TeamAvatar name={t.name} tag={t.tag} className={t.isActive ? "" : "opacity-50 grayscale"} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {t.name} <span className="text-xs font-semibold tracking-wider text-primary">[{t.tag}]</span>
                </div>
                <div className="truncate font-mono text-xs text-muted-foreground">
                  @{t.username}
                  {t.requestedBy && <span className="ml-2 font-sans">via {t.requestedBy.displayName}</span>}
                </div>
              </div>
              {actionsFor(t, i)}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
              <ActivePill active={t.isActive} />
              <span><strong className="font-display text-sm text-foreground">{t.registrationCount}</strong> registrations</span>
              <span>Last login {relativeTime(t.lastLoginAt).toLowerCase()}</span>
            </div>
            {(t.captainName || t.email || t.phone) && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {t.captainName && <span className="inline-flex items-center gap-1"><Crown className="size-3" />{t.captainName}</span>}
                {t.email && <span className="inline-flex items-center gap-1"><Mail className="size-3" />{t.email}</span>}
                {t.phone && <span className="inline-flex items-center gap-1"><Phone className="size-3" />{t.phone}</span>}
              </div>
            )}
          </motion.li>
        ))}
      </ul>
    );

  return (
    <>
      <PageHeader eyebrow="Logins" title="Teams" description="Create team logins and help teams who get locked out." actions={createBtn} />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput value={search} onChange={setSearch} placeholder="Search teams…" loading={list.isFetching && !list.isPending} data-tour="search" />
        {list.data && <p className="text-sm text-muted-foreground">{items.length} {items.length === 1 ? "team" : "teams"}{q && " found"}</p>}
      </div>
      {/* Phones have no "Team approvals" tab (folded into Teams), so link to it from here. */}
      {!isDesktop && (
        <Link
          to="/team-requests"
          className="mb-4 flex items-center gap-3 rounded-xl border bg-card p-3 text-sm shadow-sm transition-colors hover:border-primary/50"
        >
          <ShieldCheck className="size-5 text-primary" />
          <span className="min-w-0 flex-1 font-medium">Team approvals</span>
          {approvals > 0 ? (
            <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">{approvals} waiting</span>
          ) : (
            <span className="text-xs text-muted-foreground">None waiting</span>
          )}
          <ChevronRight className="size-4 text-muted-foreground" />
        </Link>
      )}
      <div data-tour="teams-list">{body}</div>

      <CreateTeamDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={setCreds} />
      <EditTeamDialog team={editing} onClose={() => setEditing(null)} />
      <ResetPasswordDialog
        target={resetting}
        onClose={() => setResetting(null)}
        onSubmit={(id, input) => reset.mutateAsync({ id, input })}
        onSuccess={(t, password) => {
          setResetting(null);
          toast.success(`Password reset for ${t.name}`);
          setCreds({ who: t.name, role: "Team", username: t.username, password, kind: "reset" });
        }}
      />
      <ToggleActiveDialog
        kind="team"
        target={toggling}
        onClose={() => setToggling(null)}
        onConfirm={async (t) => {
          try {
            await update.mutateAsync({ id: t.id, input: { isActive: !t.isActive } });
            toast.success(t.isActive ? `${t.name} is disabled` : `${t.name} is enabled again`);
          } catch (e) {
            toast.error(errorMessage(e));
            throw e;
          }
        }}
      />
      <CredentialsDialog credentials={creds} onClose={() => setCreds(null)} />
    </>
  );
}
