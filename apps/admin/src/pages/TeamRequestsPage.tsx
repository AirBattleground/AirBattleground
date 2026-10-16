import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Inbox, Mail, Phone, ShieldCheck, ShieldX, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { TEAM_REQUEST_STATUSES, type TeamRequestRow, type TeamRequestStatus } from "@7xen/shared";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { Pill, TeamAvatar } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { Label } from "@7xen/ui/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@7xen/ui/components/ui/tabs";
import { Textarea } from "@7xen/ui/components/ui/textarea";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { ListSkeleton } from "@/components/ListSkeleton";
import { useAdminStats } from "@/features/stats/api";
import { useApproveTeamRequest, useRejectTeamRequest, useTeamRequests } from "@/features/teamRequests/api";
import { errorMessage } from "@/lib/forms";
import { relativeTime } from "@/lib/format";

const TOUR: TourStep[] = [
  { title: "Team approvals", description: "Managers can register teams too. Their teams land here and can't log in until you approve them." },
  { element: '[data-tour="request-tabs"]', title: "Waiting, approved, rejected", description: "New requests are under Waiting. The other tabs keep a history of your decisions." },
  { element: '[data-tour="request-card"]', title: "Check the details", description: "Team name, tag, captain, the login username and which manager asked for it." },
  { element: '[data-tour="request-actions"]', title: "Approve or reject", description: "Approve creates the team login straight away. Reject frees the team name so it can be used again." },
];

const TAB_LABEL: Record<TeamRequestStatus, string> = { PENDING: "Waiting", APPROVED: "Approved", REJECTED: "Rejected" };

export default function TeamRequestsPage() {
  const [params, setParams] = useSearchParams();
  const status = (TEAM_REQUEST_STATUSES as readonly string[]).includes(params.get("tab") ?? "") ? (params.get("tab") as TeamRequestStatus) : "PENDING";
  const { data, isPending, isError, error, refetch } = useTeamRequests(status);
  const stats = useAdminStats();
  const [rejecting, setRejecting] = useState<TeamRequestRow | null>(null);
  usePageTour("admin.teamRequests", TOUR);

  return (
    <>
      <PageHeader
        eyebrow="Approvals"
        title="Team approvals"
        description="Teams registered by managers. Approve to create their login, or reject to free the name."
      />
      <Tabs value={status} onValueChange={(v) => setParams(v === "PENDING" ? {} : { tab: v }, { replace: true })} className="mb-5">
        <TabsList data-tour="request-tabs">
          {TEAM_REQUEST_STATUSES.map((s) => (
            <TabsTrigger key={s} value={s} className="gap-2 px-4">
              {TAB_LABEL[s]}
              {s === "PENDING" && !!stats.data?.teamRequests.pending && (
                <span className="rounded-md bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">{stats.data.teamRequests.pending}</span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {isPending ? (
        <ListSkeleton rows={3} />
      ) : isError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Couldn't load requests. {errorMessage(error)}{" "}
          <button className="font-semibold underline" onClick={() => refetch()}>
            Try again
          </button>
        </div>
      ) : data.length === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title={status === "PENDING" ? "No teams waiting" : `No ${TAB_LABEL[status].toLowerCase()} requests yet`}
          description={status === "PENDING" ? "When a manager registers a team, it shows up here for you to approve." : "Your decisions will be listed here."}
        />
      ) : (
        <div className="grid gap-3">
          <AnimatePresence initial={false}>
            {data.map((r, i) => (
              <RequestCard key={r.id} r={r} first={i === 0} onReject={() => setRejecting(r)} />
            ))}
          </AnimatePresence>
        </div>
      )}
      <RejectDialog request={rejecting} onClose={() => setRejecting(null)} />
    </>
  );
}

function RequestCard({ r, first, onReject }: { r: TeamRequestRow; first: boolean; onReject: () => void }) {
  const approve = useApproveTeamRequest();
  const pending = r.status === "PENDING";
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 40, transition: { duration: 0.2 } }}
      data-tour={first ? "request-card" : undefined}
      className="rounded-xl border bg-card p-4 shadow-sm sm:p-5"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <TeamAvatar name={r.teamName} tag={r.tag} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-display text-xl font-bold">{r.teamName}</span>
              <span className="text-xs font-semibold tracking-wider text-primary">[{r.tag}]</span>
              {r.status === "APPROVED" && <Pill tone="success" icon={<ShieldCheck className="size-3.5" />}>Approved</Pill>}
              {r.status === "REJECTED" && <Pill tone="danger" icon={<ShieldX className="size-3.5" />}>Rejected</Pill>}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="font-mono text-xs leading-5">@{r.username}</span>
              {r.captainName && (
                <span className="inline-flex items-center gap-1">
                  <UserRound className="size-3.5" /> Captain {r.captainName}
                </span>
              )}
              {r.email && (
                <span className="inline-flex items-center gap-1">
                  <Mail className="size-3.5" /> {r.email}
                </span>
              )}
              {r.phone && (
                <span className="inline-flex items-center gap-1">
                  <Phone className="size-3.5" /> {r.phone}
                </span>
              )}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              Requested by <span className="font-semibold text-foreground">{r.manager.displayName}</span> · {relativeTime(r.createdAt)}
              {r.reviewedAt && <> · reviewed {relativeTime(r.reviewedAt)}</>}
            </div>
            {r.rejectionReason && <div className="mt-2 rounded-lg bg-destructive/10 px-3 py-1.5 text-sm text-destructive">Reason: {r.rejectionReason}</div>}
          </div>
        </div>
        {pending ? (
          <div className="flex shrink-0 gap-2 sm:flex-col lg:flex-row" data-tour={first ? "request-actions" : undefined}>
            <Button variant="outline" className="flex-1" onClick={onReject} disabled={approve.isPending}>
              <X /> Reject
            </Button>
            <Button
              className="flex-1 bg-success text-success-foreground hover:bg-success/90"
              disabled={approve.isPending}
              onClick={() =>
                approve.mutate(r.id, {
                  onSuccess: (team) => toast.success(`${team.name} approved`, { description: `They can now sign in as @${team.username}.` }),
                  onError: (e) => toast.error("Couldn't approve", { description: errorMessage(e) }),
                })
              }
            >
              <Check /> Approve
            </Button>
          </div>
        ) : (
          r.status === "APPROVED" && (
            <Button variant="outline" asChild className="shrink-0">
              <Link to={`/teams?q=${encodeURIComponent(r.teamName)}`}>View team</Link>
            </Button>
          )
        )}
      </div>
    </motion.div>
  );
}

function RejectDialog({ request, onClose }: { request: TeamRequestRow | null; onClose: () => void }) {
  const reject = useRejectTeamRequest();
  const [reason, setReason] = useState("");
  const close = () => {
    setReason("");
    onClose();
  };
  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Reject {request?.teamName}?</DialogTitle>
          <DialogDescription>
            No login will be created and the team name becomes free again. {request?.manager.displayName} will see your reason.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="reject-reason">
            Reason <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Textarea id="reject-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="e.g. This team already has an account" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={reject.isPending}
            onClick={() => {
              if (!request) return;
              reject.mutate(
                { id: request.id, reason: reason.trim() || undefined },
                {
                  onSuccess: () => toast.success(`${request.teamName} rejected`),
                  onError: (e) => toast.error("Couldn't reject", { description: errorMessage(e) }),
                },
              );
              close();
            }}
          >
            Reject team
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
