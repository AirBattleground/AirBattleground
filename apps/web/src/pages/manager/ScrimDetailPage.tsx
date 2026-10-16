import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarDays,
  CalendarOff,
  CheckCheck,
  ChevronDown,
  Clock,
  Copy,
  Inbox,
  Lock,
  LockOpen,
  Pencil,
  Repeat,
  UserMinus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError, DATE_RE, occursOn, todayInAppTz, type Registration, type Scrim, type SessionDetail } from "@7xen/shared";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { SlotChip, StatusBadge, TeamAvatar } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Progress } from "@7xen/ui/components/ui/progress";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { cn } from "@7xen/ui/lib/utils";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { useApproveRegistration, useBulkApprove, useRejectRegistration, useScrim, useSession } from "@/features/manager/api";
import {
  countdown,
  dateRangeLabel,
  defaultOccurrence,
  formatDate,
  formatTime,
  nextOccurrences,
  recurrenceLabel,
  slotRangeLabel,
} from "@/features/manager/format";
import { ConfirmDialog } from "@/features/manager/components/ConfirmDialog";
import { DatePickerButton } from "@/features/manager/components/DatePickerButton";
import { DateStrip } from "@/features/manager/components/DateStrip";
import { MapChips } from "@/features/manager/components/maps";
import { QueryError } from "@/features/manager/components/QueryError";
import { RejectDialog } from "@/features/manager/components/RejectDialog";
import { RequestCard } from "@/features/manager/components/RequestCard";
import { ScrimStatusPill } from "@/features/manager/components/ScrimStatusPill";
import { SlotBoard, slotListText } from "@/features/manager/components/SlotBoard";
import { useNow } from "@/features/manager/components/useNow";

const TOUR: TourStep[] = [
  { title: "Running a session", description: "Here you decide which teams play on a given day." },
  { element: '[data-tour="detail-dates"]', title: "Pick the day", description: "Only days this scrim runs are shown. Each day has its own list of teams." },
  { element: '[data-tour="detail-summary"]', title: "How full is it?", description: "Confirmed teams, requests waiting, slots left — and when registration closes." },
  { element: '[data-tour="detail-requests"]', title: "Approve or reject", description: "Approving gives the team the lowest free slot automatically. You can remove a team later to free their slot." },
  { element: '[data-tour="detail-board"]', title: "Slot board", description: "Who is in which slot. Use “Copy slot list” to paste it into WhatsApp or Discord." },
];

export default function ScrimDetailPage() {
  usePageTour("manager.scrimDetail", TOUR);
  const { scrimId } = useParams();
  const q = useScrim(scrimId);

  if (q.isError)
    return (
      <>
        <BackLink />
        <QueryError error={q.error} onRetry={() => void q.refetch()} title="We couldn't load this scrim" />
      </>
    );
  if (!q.data) return <DetailSkeleton />;
  return <Detail scrim={q.data} />;
}

function BackLink() {
  return (
    <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
      <Link to="/manager/scrims">
        <ArrowLeft /> All scrims
      </Link>
    </Button>
  );
}

function Detail({ scrim }: { scrim: Scrim }) {
  const [params, setParams] = useSearchParams();
  const today = todayInAppTz();
  const raw = params.get("date");
  const fallback = useMemo(() => defaultOccurrence(scrim), [scrim]);
  const date = raw === "today" ? today : raw && DATE_RE.test(raw) ? raw : fallback;
  const runs = occursOn(scrim, date);

  // Keep ?date in the URL so the page can be shared / refreshed.
  useEffect(() => {
    if (raw !== date) {
      const next = new URLSearchParams(params);
      next.set("date", date);
      setParams(next, { replace: true });
    }
  }, [raw, date, params, setParams]);

  const setDate = (d: string) => {
    const next = new URLSearchParams(params);
    next.set("date", d);
    setParams(next, { replace: true });
  };

  const stripDates = useMemo(() => {
    const list = nextOccurrences(scrim, today, scrim.recurrence === "WEEKENDS" ? 8 : 14);
    if (!list.includes(date)) list.push(date);
    return list.sort();
  }, [scrim, today, date]);

  return (
    <>
      <BackLink />
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-1.5">
            <Repeat className="size-3.5" /> {recurrenceLabel(scrim)}
          </span>
        }
        title={scrim.title}
        description={scrim.description ?? undefined}
        actions={
          <>
            <ScrimStatusPill status={scrim.status} />
            <Button asChild variant="outline">
              <Link to={`/manager/scrims/${scrim.id}/edit`}>
                <Pencil /> Edit
              </Link>
            </Button>
          </>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border bg-card p-4 text-sm shadow-sm">
        <span className="flex items-center gap-2">
          <Clock className="size-4 text-primary" />
          <span className="font-display text-lg font-bold">{formatTime(scrim.startTime)}</span> IST
        </span>
        <span className="flex items-center gap-2 text-muted-foreground">
          <Users className="size-4 text-primary" /> {slotRangeLabel(scrim.firstSlot, scrim.slotCount)}
        </span>
        <span className="text-muted-foreground">{dateRangeLabel(scrim)}</span>
        <MapChips maps={scrim.maps} numbered className="w-full sm:w-auto" />
      </div>

      {scrim.status !== "ACTIVE" && (
        <div className="mb-4 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          {scrim.status === "PAUSED"
            ? "This scrim is paused — teams can't send new requests until you resume it from the Scrims page."
            : "This scrim is archived — it no longer runs. You can still view past sessions."}
        </div>
      )}

      <div data-tour="detail-dates" className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center">
        {scrim.recurrence === "ONCE" ? (
          <div className="flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2 font-display text-xl font-bold">
            <CalendarDays className="size-5 text-primary" />
            One-time · {formatDate(scrim.startDate)}
          </div>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <DateStrip dates={stripDates} value={date} onChange={setDate} />
            </div>
            <DatePickerButton
              value={date}
              onChange={setDate}
              label="Other date"
              isDisabled={(d) => !occursOn(scrim, d)}
              className="self-start lg:self-center"
              align="end"
            />
          </>
        )}
      </div>

      {runs ? (
        <SessionView scrim={scrim} date={date} />
      ) : (
        <EmptyState
          icon={<CalendarOff />}
          title={`${scrim.title} doesn't run on ${formatDate(date)}`}
          description="Pick one of the highlighted days above to see its teams."
          action={
            <Button onClick={() => setDate(fallback)} disabled={!occursOn(scrim, fallback)}>
              Go to {formatDate(fallback)}
            </Button>
          }
        />
      )}
    </>
  );
}

function SessionView({ scrim, date }: { scrim: Scrim; date: string }) {
  const q = useSession(scrim.id, date);
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.status === 404)
      return (
        <EmptyState
          icon={<CalendarOff />}
          title={`No session on ${formatDate(date)}`}
          description="This scrim doesn't run on this day. Pick another date above."
        />
      );
    return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  }
  if (!q.data) return <SessionSkeleton />;
  return <Session s={q.data} />;
}

function Session({ s }: { s: SessionDetail }) {
  const approve = useApproveRegistration();
  const reject = useRejectRegistration();
  const bulk = useBulkApprove();
  const now = useNow(15_000);
  const [rejecting, setRejecting] = useState<{ reg: Registration; mode: "reject" | "remove" } | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = (id: string) => {
    setHighlight(id);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setHighlight(null), 2500);
  };

  const byCreated = (a: Registration, b: Registration) => a.createdAt.localeCompare(b.createdAt);
  const pending = s.registrations.filter((r) => r.status === "PENDING").sort(byCreated);
  const approved = s.registrations
    .filter((r) => r.status === "APPROVED")
    .sort((a, b) => (a.slotNumber ?? 99) - (b.slotNumber ?? 99));
  const closed = s.registrations.filter((r) => r.status === "REJECTED" || r.status === "CANCELLED");
  const full = s.counts.slotsLeft === 0;
  const pct = Math.round((s.counts.approved / Math.max(1, s.scrim.slotCount)) * 100);
  const left = countdown(s.startsAt, now);

  const copyList = async () => {
    const text = slotListText(s.scrim.title, formatDate(s.date), formatTime(s.scrim.startTime), s.slots);
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Slot list copied", { description: "Paste it into WhatsApp or Discord." });
    } catch {
      toast.error("Couldn't copy automatically", { description: "Your browser blocked clipboard access." });
    }
  };

  const approveAll = async () => {
    setBulkRunning(true);
    await bulk.run(pending.map((r) => ({ id: r.id, teamName: r.team.name })));
    setBulkRunning(false);
  };

  return (
    <div className="space-y-6">
      {/* summary bar */}
      <div data-tour="detail-summary" className="grid gap-3 rounded-xl border bg-card p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4 sm:p-5">
        <div className="sm:col-span-2 lg:col-span-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Teams confirmed</p>
          <p className="font-display text-3xl font-bold">
            {s.counts.approved}
            <span className="text-lg text-muted-foreground">/{s.scrim.slotCount}</span>
          </p>
          <Progress value={pct} className={cn("mt-1 h-2", full && "[&>[data-slot=progress-indicator]]:bg-success")} />
        </div>
        <SummaryStat label="Waiting" value={s.counts.pending} tone={s.counts.pending > 0 ? "text-warning" : undefined} />
        <SummaryStat label="Slots left" value={full ? "Full" : s.counts.slotsLeft} tone={full ? "text-success" : undefined} />
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Registration</p>
          {s.registrationOpen && left ? (
            <>
              <p className="flex items-center gap-1.5 font-display text-xl font-bold text-success">
                <LockOpen className="size-4" /> Open
              </p>
              <p className="text-xs text-muted-foreground">Closes in {left} (at {formatTime(s.scrim.startTime)})</p>
            </>
          ) : (
            <>
              <p className="flex items-center gap-1.5 font-display text-xl font-bold text-muted-foreground">
                <Lock className="size-4" /> Closed
              </p>
              <p className="text-xs text-muted-foreground">{left ? "Teams can't register right now" : "The session has started"}</p>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        {/* Requests pane */}
        <section data-tour="detail-requests" className="space-y-6">
          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-display text-2xl font-bold">
                Requests
                {pending.length > 0 && (
                  <span className="grid min-w-7 place-items-center rounded-full bg-warning/20 px-2 text-base text-warning-foreground dark:text-warning">
                    {pending.length}
                  </span>
                )}
              </h2>
              {pending.length > 1 && (
                <Button variant="outline" onClick={() => setConfirmAll(true)} disabled={full || bulkRunning}>
                  <CheckCheck /> {bulkRunning ? "Approving…" : "Approve all"}
                </Button>
              )}
            </div>
            {pending.length === 0 ? (
              <div className="flex items-center gap-3 rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
                <Inbox className="size-5 text-primary" />
                No teams waiting. New requests show up here automatically.
              </div>
            ) : (
              <div className="space-y-2">
                {full && (
                  <p className="rounded-lg bg-warning/10 p-3 text-sm">
                    All slots are taken. Remove an approved team to make room, or reject the remaining requests.
                  </p>
                )}
                {pending.map((r) => (
                  <RequestCard
                    key={r.id}
                    reg={r}
                    full={full}
                    busy={bulkRunning}
                    onApprove={() =>
                      approve.mutate(
                        { id: r.id, teamName: r.team.name },
                        { onSuccess: (reg) => flash(reg.id) },
                      )
                    }
                    onReject={() => setRejecting({ reg: r, mode: "reject" })}
                  />
                ))}
              </div>
            )}
          </div>

          <div>
            <h3 className="mb-3 font-display text-xl font-bold">
              Approved <span className="text-muted-foreground">({approved.length})</span>
            </h3>
            {approved.length === 0 ? (
              <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
                No teams approved yet. Approve a request and they'll get slot #{s.scrim.firstSlot}.
              </p>
            ) : (
              <ul className="divide-y rounded-xl border bg-card">
                {approved.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 p-3">
                    {r.slotNumber != null && <SlotChip slot={r.slotNumber} size="sm" />}
                    <TeamAvatar name={r.team.name} tag={r.team.tag} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">
                        {r.team.name} <span className="text-xs text-muted-foreground">({r.team.tag})</span>
                      </p>
                      {r.team.captainName && <p className="truncate text-xs text-muted-foreground">Captain: {r.team.captainName}</p>}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setRejecting({ reg: r, mode: "remove" })}
                    >
                      <UserMinus /> <span className="hidden sm:inline">Remove</span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {closed.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowClosed((v) => !v)}
                className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                <ChevronDown className={cn("size-4 transition-transform", showClosed && "rotate-180")} />
                Rejected & cancelled ({closed.length})
              </button>
              {showClosed && (
                <ul className="mt-2 divide-y rounded-xl border bg-card/60">
                  {closed.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                      <TeamAvatar name={r.team.name} tag={r.team.tag} size="sm" className="opacity-70" />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{r.team.name}</span>
                        {r.rejectionReason && <span className="block text-xs text-muted-foreground">“{r.rejectionReason}”</span>}
                      </span>
                      <StatusBadge status={r.status} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        {/* Slot board */}
        <section data-tour="detail-board" className="lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-2xl font-bold">Slot board</h2>
                <p className="text-xs text-muted-foreground">
                  {formatDate(s.date)} · {formatTime(s.scrim.startTime)} IST
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => void copyList()}>
                <Copy /> Copy slot list
              </Button>
            </div>
            <SlotBoard slots={s.slots} highlight={highlight} />
          </div>
        </section>
      </div>

      <RejectDialog
        open={!!rejecting}
        onOpenChange={(o) => !o && setRejecting(null)}
        teamName={rejecting?.reg.team.name ?? ""}
        mode={rejecting?.mode}
        onConfirm={(reason) => {
          if (rejecting) reject.mutate({ id: rejecting.reg.id, teamName: rejecting.reg.team.name, reason });
        }}
      />
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title={`Approve ${Math.min(pending.length, s.counts.slotsLeft)} team${Math.min(pending.length, s.counts.slotsLeft) === 1 ? "" : "s"}?`}
        description={
          pending.length > s.counts.slotsLeft
            ? `Only ${s.counts.slotsLeft} slot${s.counts.slotsLeft === 1 ? " is" : "s are"} left. Teams are approved in the order they asked, until slots run out; the rest stay waiting.`
            : "Teams are approved in the order they asked. Each gets the lowest free slot."
        }
        confirmLabel="Approve all"
        onConfirm={() => void approveAll()}
      />
    </div>
  );
}

function SummaryStat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("font-display text-3xl font-bold", tone)}>{value}</p>
    </div>
  );
}

function SessionSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-28 rounded-xl" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-6 w-28" />
      <Skeleton className="h-12 w-80" />
      <Skeleton className="h-16 rounded-xl" />
      <Skeleton className="h-20 rounded-xl" />
      <SessionSkeleton />
    </div>
  );
}
