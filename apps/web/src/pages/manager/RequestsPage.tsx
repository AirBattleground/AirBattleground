import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCheck, CheckCircle2, RefreshCw } from "lucide-react";
import { todayInAppTz, type PendingRequest, type Registration } from "@7xen/shared";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Checkbox } from "@7xen/ui/components/ui/checkbox";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { cn } from "@7xen/ui/lib/utils";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { useApproveRegistration, useBulkApprove, useRejectRegistration, useRequests } from "@/features/manager/api";
import { formatDate, formatTime } from "@/features/manager/format";
import { ConfirmDialog } from "@/features/manager/components/ConfirmDialog";
import { QueryError } from "@/features/manager/components/QueryError";
import { RejectDialog } from "@/features/manager/components/RejectDialog";
import { RequestCard } from "@/features/manager/components/RequestCard";

const TOUR: TourStep[] = [
  { title: "Your approvals inbox", description: "Every team waiting for a decision, across all your scrims, soonest session first." },
  { element: '[data-tour="req-group"]', title: "Grouped by session", description: "Each panel is one scrim on one day. The number on the right is how many slots are still free." },
  { element: '[data-tour="req-actions"]', title: "Approve or reject", description: "Approve gives the team the lowest free slot automatically. Reject lets you add a reason." },
  { element: '[data-tour="req-bulk"]', title: "Handle many at once", description: "Tick several teams and approve them together. This page refreshes on its own." },
];

interface Group {
  key: string;
  scrim: PendingRequest["scrim"];
  date: string;
  startsAt: string;
  counts: PendingRequest["counts"];
  items: Registration[];
}

function groupRequests(list: PendingRequest[]): Group[] {
  const map = new Map<string, Group>();
  for (const r of list) {
    const key = `${r.scrim.id}|${r.date}`;
    const g = map.get(key);
    if (g) g.items.push(r.registration);
    else map.set(key, { key, scrim: r.scrim, date: r.date, startsAt: r.startsAt, counts: r.counts, items: [r.registration] });
  }
  return [...map.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export default function RequestsPage() {
  usePageTour("manager.requests", TOUR);
  const q = useRequests({ refetchInterval: 20_000 });
  const approve = useApproveRegistration();
  const reject = useRejectRegistration();
  const bulk = useBulkApprove();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState<Registration | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  const today = todayInAppTz();

  const groups = useMemo(() => (q.data ? groupRequests(q.data) : undefined), [q.data]);
  const allIds = useMemo(() => q.data?.map((r) => r.registration.id) ?? [], [q.data]);
  // drop selections that are no longer pending
  const sel = useMemo(() => new Set([...selected].filter((id) => allIds.includes(id))), [selected, allIds]);
  const allSelected = allIds.length > 0 && sel.size === allIds.length;

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const approveSelected = async () => {
    if (!q.data) return;
    setBulkRunning(true);
    const items = q.data
      .filter((r) => sel.has(r.registration.id))
      .map((r) => ({ id: r.registration.id, teamName: r.registration.team.name, group: `${r.scrim.id}|${r.date}` }));
    await bulk.run(items);
    setSelected(new Set());
    setBulkRunning(false);
  };

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Approving gives the team the lowest free slot."
        actions={
          <Button variant="ghost" size="sm" onClick={() => void q.refetch()} disabled={q.isFetching} aria-label="Refresh">
            <RefreshCw className={cn(q.isFetching && "animate-spin")} /> <span className="hidden sm:inline">Refresh</span>
          </Button>
        }
      />

      {q.isError && !q.data ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : !groups ? (
        <div className="space-y-4">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="space-y-2 rounded-xl border bg-card p-5">
              <Skeleton className="h-6 w-60" />
              <Skeleton className="h-16 rounded-xl" />
              <Skeleton className="h-16 rounded-xl" />
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 />}
          title="You're all caught up"
          description="New requests show up here automatically."
          action={
            <Button asChild variant="outline">
              <Link to="/manager/scrims">View schedule</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-5">
          <div
            data-tour="req-bulk"
            className="sticky top-16 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card/95 p-3 shadow-sm backdrop-blur"
          >
            <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium">
              <Checkbox
                checked={allSelected ? true : sel.size > 0 ? "indeterminate" : false}
                onCheckedChange={(v) => setSelected(v === true ? new Set(allIds) : new Set())}
                aria-label="Select all"
              />
              {sel.size > 0 ? `${sel.size} selected` : `${allIds.length} waiting · select all`}
            </label>
            <Button
              disabled={sel.size === 0 || bulkRunning}
              onClick={() => setConfirmBulk(true)}
              className="bg-success text-success-foreground hover:bg-success/90"
            >
              <CheckCheck /> {bulkRunning ? "Approving…" : `Approve${sel.size ? ` ${sel.size}` : " selected"}`}
            </Button>
          </div>

          {groups.map((g, gi) => {
            const full = g.counts.slotsLeft === 0;
            return (
              <section key={g.key} data-tour={gi === 0 ? "req-group" : undefined} className="animate-rise rounded-xl border bg-card p-4 shadow-sm sm:p-5">
                <header className="flex items-start justify-between gap-3 border-b pb-3">
                  <Link to={`/manager/scrims/${g.scrim.id}?date=${g.date}`} className="group min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      {g.date === today ? "Today" : formatDate(g.date)} · {formatTime(g.scrim.startTime)}
                    </p>
                    <h2 className="flex items-center gap-1 truncate font-display text-lg font-bold group-hover:text-primary">
                      {g.scrim.title} <ArrowRight className="size-4 shrink-0 opacity-60" />
                    </h2>
                  </Link>
                  <div className="shrink-0 text-right">
                    <p className={cn("font-display text-2xl font-bold leading-none tabular-nums", full ? "text-destructive" : "text-success")}>
                      {full ? "Full" : g.counts.slotsLeft}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{full ? `${g.scrim.slotCount} slots` : `of ${g.scrim.slotCount} slots left`}</p>
                  </div>
                </header>
                <div className="divide-y" data-tour={gi === 0 ? "req-actions" : undefined}>
                  {g.items.map((r) => (
                    <RequestCard
                      key={r.id}
                      reg={r}
                      full={full}
                      busy={bulkRunning}
                      className={cn(sel.has(r.id) && "-mx-2 rounded-lg bg-primary/5 px-2")}
                      leading={
                        <Checkbox
                          checked={sel.has(r.id)}
                          onCheckedChange={(v) => toggle(r.id, v === true)}
                          aria-label={`Select ${r.team.name}`}
                          className="size-5"
                        />
                      }
                      onApprove={() => approve.mutate({ id: r.id, teamName: r.team.name })}
                      onReject={() => setRejecting(r)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <RejectDialog
        open={!!rejecting}
        onOpenChange={(o) => !o && setRejecting(null)}
        teamName={rejecting?.team.name ?? ""}
        onConfirm={(reason) => {
          if (rejecting) reject.mutate({ id: rejecting.id, teamName: rejecting.team.name, reason });
        }}
      />
      <ConfirmDialog
        open={confirmBulk}
        onOpenChange={setConfirmBulk}
        title={`Approve ${sel.size} team${sel.size === 1 ? "" : "s"}?`}
        description="Each team gets the lowest free slot in its session. If a session fills up, the rest of its teams stay waiting."
        confirmLabel="Approve"
        onConfirm={() => void approveSelected()}
      />
    </>
  );
}
