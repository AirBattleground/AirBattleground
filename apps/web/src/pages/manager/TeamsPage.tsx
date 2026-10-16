import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Clock, ShieldCheck, ShieldPlus, ShieldX, Trash2, Users } from "lucide-react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { toast } from "sonner";
import { TEAM_REQUEST_STATUS_LABELS, type TeamRequestRow, type TeamRequestStatus } from "@7xen/shared";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { Pill, TeamAvatar, type Tone } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@7xen/ui/components/ui/tabs";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { ConfirmDialog } from "@/features/manager/components/ConfirmDialog";
import { QueryError } from "@/features/manager/components/QueryError";
import { RegisterTeamDialog, RequestSentDialog } from "@/features/manager/components/RegisterTeamDialog";
import { useMyTeamRequests, useWithdrawTeamRequest } from "@/features/manager/teamRequests";

const TOUR: TourStep[] = [
  { title: "Your teams", description: "Register teams for your scrims here. The 7XEN admin approves each new team before it can log in." },
  { element: '[data-tour="register-team"]', title: "Register a team", description: "Enter the team name, tag and a login. We check the name is free while you type." },
  { element: '[data-tour="team-tabs"]', title: "Track approval", description: "Waiting → the admin hasn't decided yet. Approved → the team can log in. Rejected → see the admin's reason." },
];

const TONE: Record<TeamRequestStatus, Tone> = { PENDING: "warning", APPROVED: "success", REJECTED: "danger" };
const ICON: Record<TeamRequestStatus, typeof Clock> = { PENDING: Clock, APPROVED: ShieldCheck, REJECTED: ShieldX };
type Filter = "ALL" | TeamRequestStatus;

export default function TeamsPage() {
  const list = useMyTeamRequests();
  const withdraw = useWithdrawTeamRequest();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<{ row: TeamRequestRow; password: string } | null>(null);
  const [withdrawing, setWithdrawing] = useState<TeamRequestRow | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  usePageTour("manager.teams", TOUR);

  const counts = useMemo(() => {
    const c = { ALL: 0, PENDING: 0, APPROVED: 0, REJECTED: 0 };
    for (const r of list.data ?? []) {
      c.ALL++;
      c[r.status]++;
    }
    return c;
  }, [list.data]);
  const rows = (list.data ?? []).filter((r) => filter === "ALL" || r.status === filter);

  return (
    <>
      <PageHeader
        eyebrow="Teams"
        title="Register teams"
        description="Add teams that play your scrims. Team names are unique, and the admin approves every new team."
        actions={
          <Button size="lg" onClick={() => setOpen(true)} data-tour="register-team" className="shadow-glow">
            <ShieldPlus /> Register a team
          </Button>
        }
      />

      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)} className="mb-5">
        <TabsList data-tour="team-tabs">
          {(["ALL", "PENDING", "APPROVED", "REJECTED"] as const).map((f) => (
            <TabsTrigger key={f} value={f} className="gap-2 px-3">
              {f === "ALL" ? "All" : f === "PENDING" ? "Waiting" : TEAM_REQUEST_STATUS_LABELS[f]}
              <span className="rounded-md bg-muted px-1.5 text-[11px] text-muted-foreground">{counts[f]}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {list.isPending ? (
        <div className="grid gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : list.isError ? (
        <QueryError error={list.error} onRetry={() => list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={counts.ALL === 0 ? "No teams registered yet" : "Nothing here"}
          description={counts.ALL === 0 ? "Register the teams that play your scrims. Once the admin approves them, they can log in and join." : "No teams with this status."}
          action={
            counts.ALL === 0 && (
              <Button onClick={() => setOpen(true)}>
                <ShieldPlus /> Register your first team
              </Button>
            )
          }
        />
      ) : (
        <div className="grid gap-3">
          <AnimatePresence initial={false}>
            {rows.map((r) => {
              const Icon = ICON[r.status];
              return (
                <motion.div
                  key={r.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 40, transition: { duration: 0.2 } }}
                  className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <TeamAvatar name={r.teamName} tag={r.tag} size="lg" className={r.status === "REJECTED" ? "opacity-50 grayscale" : ""} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-display text-lg font-bold">{r.teamName}</span>
                        <span className="text-xs font-semibold tracking-wider text-primary">[{r.tag}]</span>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        <span className="font-mono text-xs">@{r.username}</span>
                        {r.captainName && <> · Captain {r.captainName}</>} · sent {formatDistanceToNow(parseISO(r.createdAt), { addSuffix: true })}
                      </div>
                      {r.status === "REJECTED" && (
                        <div className="mt-1 text-sm text-destructive">{r.rejectionReason ? `Admin's reason: ${r.rejectionReason}` : "The admin didn't approve this team."}</div>
                      )}
                      {r.status === "APPROVED" && <div className="mt-1 text-sm text-success">Approved — the team can log in now.</div>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Pill tone={TONE[r.status]} icon={<Icon className="size-3.5" />}>
                      {r.status === "PENDING" ? "Waiting for admin" : TEAM_REQUEST_STATUS_LABELS[r.status]}
                    </Pill>
                    {r.status === "PENDING" && (
                      <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setWithdrawing(r)}>
                        <Trash2 /> Withdraw
                      </Button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      <RegisterTeamDialog
        open={open}
        onOpenChange={setOpen}
        onCreated={(row, password) => {
          toast.success(`${row.teamName} sent for approval`);
          setSent({ row, password });
        }}
      />
      <RequestSentDialog sent={sent} onClose={() => setSent(null)} />
      <ConfirmDialog
        open={!!withdrawing}
        onOpenChange={(o) => !o && setWithdrawing(null)}
        title={`Withdraw ${withdrawing?.teamName}?`}
        description="The request is removed and the team name becomes free again."
        confirmLabel="Withdraw"
        destructive
        onConfirm={() => {
          if (!withdrawing) return;
          const r = withdrawing;
          withdraw.mutate(r.id, {
            onSuccess: () => toast.success(`${r.teamName} withdrawn`),
            onError: (e) => toast.error("Couldn't withdraw", { description: e instanceof Error ? e.message : undefined }),
          });
          setWithdrawing(null);
        }}
      />
    </>
  );
}
