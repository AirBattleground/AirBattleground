import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Mail, MailPlus, Phone, RefreshCw, SearchX, Users } from "lucide-react";
import { toast } from "sonner";
import type { ManagerRow } from "@7xen/shared";
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
import { useManagers, useResetManagerPassword, useUpdateManager } from "@/features/managers/api";
import { EditManagerDialog } from "@/features/managers/dialogs";
import { InviteManagerDialog, PendingInvites } from "@/features/managers/invites";
import { useCreateParam } from "@/hooks/use-create-param";
import { useDebounced } from "@/hooks/use-debounce";
import { useIsDesktop } from "@/hooks/use-media-query";
import { errorMessage } from "@/lib/forms";
import { relativeTime, shortDate } from "@/lib/format";

const TOUR: TourStep[] = [
  { title: "Managers", description: "Managers run scrims on AirBattleground. You invite them by email — they sign in with Google, no passwords." },
  { element: '[data-tour="create-manager"]', title: "Invite a manager", description: "Enter their name, organisation and Google email. Then send the invite by email or WhatsApp.", side: "bottom" },
  { element: '[data-tour="pending-invites"]', title: "Pending invitations", description: "Invites wait here until the person signs in. Send them again or revoke them.", side: "bottom" },
  { element: '[data-tour="search"]', title: "Find someone fast", description: "Type a name or email to filter the list.", side: "bottom" },
  { element: '[data-tour="managers-list"]', title: "All your managers", description: "See who is active, how many scrims they run and when they last signed in.", side: "top" },
  { element: '[data-tour="row-actions"]', title: "Manage a login", description: "Edit details or disable a login from this menu.", side: "left" },
];

/** How a manager signs in: Google (invited) or their legacy username. */
function SignIn({ m }: { m: ManagerRow }) {
  return m.username ? <span className="font-mono">@{m.username}</span> : <span>Google sign-in</span>;
}

export default function ManagersPage() {
  usePageTour("admin.managers", TOUR);
  const isDesktop = useIsDesktop();
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 300);
  const list = useManagers(q);
  const update = useUpdateManager();
  const reset = useResetManagerPassword();

  const [createOpen, setCreateOpen] = useCreateParam();
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [editing, setEditing] = useState<ManagerRow | null>(null);
  const [resetting, setResetting] = useState<ResetTarget | null>(null);
  const [toggling, setToggling] = useState<ToggleTarget | null>(null);

  const items = list.data?.items ?? [];
  const actionsFor = (m: ManagerRow, i: number) => {
    const username = m.username;
    return (
    <RowActions
      name={m.displayName}
      isActive={m.isActive}
      tour={i === 0 ? "row-actions" : undefined}
      onEdit={() => setEditing(m)}
      onReset={username ? () => setResetting({ id: m.id, name: m.displayName, username }) : undefined}
      onToggle={() => setToggling({ id: m.id, name: m.displayName, isActive: m.isActive })}
    />
    );
  };

  const createBtn = (
    <Button size="lg" onClick={() => setCreateOpen(true)} data-tour="create-manager" className="shadow-glow">
      <MailPlus /> Invite manager
    </Button>
  );

  let body: ReactNode;
  if (list.isPending) body = <ListSkeleton />;
  else if (list.isError)
    body = (
      <EmptyState
        icon={<AlertTriangle />}
        title="Couldn't load managers"
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
      <EmptyState icon={<SearchX />} title="No managers match" description={`Nothing found for "${q}". Check the spelling or clear the search.`} action={<Button variant="outline" onClick={() => setSearch("")}>Clear search</Button>} />
    ) : (
      <EmptyState icon={<Users />} title="No managers yet" description="Invite the first manager so they can start scheduling scrims." action={createBtn} />
    );
  else if (isDesktop)
    body = (
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-4">Manager</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead className="text-right">Scrims</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last login</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-12 pr-4"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((m, i) => (
              <motion.tr
                key={m.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 10) * 0.03 }}
                className="border-b transition-colors last:border-0 hover:bg-muted/50"
              >
                <TableCell className="pl-4">
                  <div className="flex items-center gap-3">
                    <TeamAvatar name={m.displayName} size="sm" className={m.isActive ? "" : "opacity-50 grayscale"} />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{m.displayName}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {m.orgName && <span className="text-foreground/80">{m.orgName} · </span>}
                        <SignIn m={m} />
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <div className="max-w-[14rem] space-y-0.5 text-xs">
                    {m.email && <div className="truncate">{m.email}</div>}
                    {m.phone && <div className="truncate">{m.phone}</div>}
                    {!m.email && !m.phone && <span>—</span>}
                  </div>
                </TableCell>
                <TableCell className="text-right font-display text-lg font-bold">{m.scrimCount}</TableCell>
                <TableCell><ActivePill active={m.isActive} /></TableCell>
                <TableCell className="text-muted-foreground" title={m.lastLoginAt ?? undefined}>{relativeTime(m.lastLoginAt)}</TableCell>
                <TableCell className="text-muted-foreground">{shortDate(m.createdAt)}</TableCell>
                <TableCell className="pr-4 text-right">{actionsFor(m, i)}</TableCell>
              </motion.tr>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  else
    body = (
      <ul className="grid gap-3">
        {items.map((m, i) => (
          <motion.li
            key={m.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i, 10) * 0.03 }}
            className="rounded-xl border bg-card p-4 shadow-sm"
          >
            <div className="flex items-start gap-3">
              <TeamAvatar name={m.displayName} className={m.isActive ? "" : "opacity-50 grayscale"} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{m.displayName}</div>
                {m.orgName && <div className="truncate text-xs text-foreground/80">{m.orgName}</div>}
                <div className="truncate text-xs text-muted-foreground"><SignIn m={m} /></div>
              </div>
              {actionsFor(m, i)}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
              <ActivePill active={m.isActive} />
              <span><strong className="font-display text-sm text-foreground">{m.scrimCount}</strong> scrims</span>
              <span>Last login {relativeTime(m.lastLoginAt).toLowerCase()}</span>
            </div>
            {(m.email || m.phone) && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {m.email && <span className="inline-flex items-center gap-1"><Mail className="size-3" />{m.email}</span>}
                {m.phone && <span className="inline-flex items-center gap-1"><Phone className="size-3" />{m.phone}</span>}
              </div>
            )}
          </motion.li>
        ))}
      </ul>
    );

  return (
    <>
      <PageHeader eyebrow="Accounts" title="Managers" description="Invite the people who run scrims and look after their accounts." actions={createBtn} />
      <PendingInvites className="mb-8" />
      <h2 className="mb-3 font-display text-lg font-semibold">All managers</h2>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput value={search} onChange={setSearch} placeholder="Search managers…" loading={list.isFetching && !list.isPending} data-tour="search" />
        {list.data && <p className="text-sm text-muted-foreground">{items.length} {items.length === 1 ? "manager" : "managers"}{q && " found"}</p>}
      </div>
      <div data-tour="managers-list">{body}</div>

      <InviteManagerDialog open={createOpen} onOpenChange={setCreateOpen} />
      <EditManagerDialog manager={editing} onClose={() => setEditing(null)} />
      <ResetPasswordDialog
        target={resetting}
        onClose={() => setResetting(null)}
        onSubmit={(id, input) => reset.mutateAsync({ id, input })}
        onSuccess={(t, password) => {
          setResetting(null);
          toast.success(`Password reset for ${t.name}`);
          setCreds({ who: t.name, role: "Manager", username: t.username, password, kind: "reset" });
        }}
      />
      <ToggleActiveDialog
        kind="manager"
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
