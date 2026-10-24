import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarDays,
  CalendarOff,
  ChevronDown,
  Copy,
  Info,
  Lock,
  LockOpen,
  Pencil,
  Repeat,
  Trophy,
  UserMinus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { addDays, ApiError, DATE_RE, occursOn, todayInAppTz, type Registration, type Scrim, type SessionDetail } from "@7xen/shared";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { SlotChip, StatusBadge, TeamAvatar } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Progress } from "@7xen/ui/components/ui/progress";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@7xen/ui/components/ui/tabs";
import { cn } from "@7xen/ui/lib/utils";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { useRejectRegistration, useScrim, useSession } from "@/features/manager/api";
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
import { DatePickerButton } from "@/features/manager/components/DatePickerButton";
import { DateStrip } from "@/features/manager/components/DateStrip";
import { QueryError } from "@/features/manager/components/QueryError";
import { RejectDialog } from "@/features/manager/components/RejectDialog";
import { ScrimPosterCard } from "@/features/manager/components/BrandingCards";
import { ScrimStatusPill } from "@/features/manager/components/ScrimStatusPill";
import { DraftBanner, DraftPill, MatchScheduleList, registrationCloseLabel, ScrimPresetCard } from "@/features/manager/components/MatchSchedule";
import { SlotBoard, slotListText } from "@/features/manager/components/SlotBoard";
import { useNow } from "@/features/manager/components/useNow";
import { Zone, ZoneLabel } from "@/features/manager/components/Zone";
import { SessionMatches } from "@/features/matches/components/SessionMatches";

const TOUR: TourStep[] = [
  { title: "Running a session", description: "Here you decide which teams play on a given day." },
  { element: '[data-tour="detail-dates"]', title: "Pick the day", description: "Only days this scrim runs are shown. Each day has its own list of teams." },
  { element: '[data-tour="detail-tabs"]', title: "Teams or matches", description: "“Teams” shows who joined and their slots. After the scrim starts, “Matches & results” is where you upload screenshots and publish results." },
  { element: '[data-tour="detail-summary"]', title: "How full is it?", description: "Teams in, slots left — and when registration closes. Teams join on their own and get the next free slot." },
  { element: '[data-tour="detail-teams"]', title: "Teams", description: "Every team that joined, by slot. Remove a team to free its slot for someone else." },
  { element: '[data-tour="detail-board"]', title: "Slot board", description: "Who is in which slot. Use “Copy” to paste the list into WhatsApp or Discord." },
  { element: '[data-tour="detail-info"]', title: "Scrim details & poster", description: "Time, slots, maps and the poster teams see. Open it to upload or change the poster." },
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
    // the last few days it ran too, so results of recent sessions are one tap away
    const past = nextOccurrences(scrim, addDays(today, -7), 14).filter((d) => d < today).slice(-3);
    list.unshift(...past);
    if (!list.includes(date)) list.push(date);
    return list.sort();
  }, [scrim, today, date]);

  return (
    <>
      <BackLink />
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-1.5">
            <Repeat className="size-3.5" /> {recurrenceLabel(scrim)} · {scrim.maps.length} match{scrim.maps.length === 1 ? "" : "es"}
          </span>
        }
        title={scrim.title}
        actions={
          <>
            {!scrim.published && <DraftPill />}
            {scrim.status !== "ACTIVE" && <ScrimStatusPill status={scrim.status} />}
            {scrim.recurrence !== "ONCE" && (
              <Button asChild variant="outline">
                <Link to={`/manager/scrims/${scrim.id}/weekly`}>
                  <Trophy /> Weekly Board
                </Link>
              </Button>
            )}
            <Button asChild variant="outline">
              <Link to={`/manager/scrims/${scrim.id}/edit`}>
                <Pencil /> Edit
              </Link>
            </Button>
          </>
        }
      />

      <div className="space-y-6">
      {!scrim.published && scrim.status !== "ARCHIVED" && <DraftBanner scrim={scrim} />}
      {scrim.status !== "ACTIVE" && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          {scrim.status === "PAUSED"
            ? "Paused — teams can't send new requests until you resume it."
            : "Archived — it no longer runs. Past sessions are still here."}
        </div>
      )}

      <div data-tour="detail-dates" className="flex flex-col gap-3 lg:flex-row lg:items-center">
        {scrim.recurrence === "ONCE" ? (
          <div className="flex items-center gap-2 font-display text-xl font-bold">
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
          description="Pick a highlighted day above."
          action={
            <Button onClick={() => setDate(fallback)} disabled={!occursOn(scrim, fallback)}>
              Go to {formatDate(fallback)}
            </Button>
          }
        />
      )}

      <details data-tour="detail-info" className="group rounded-xl border bg-card shadow-sm">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 text-sm font-semibold sm:px-5 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2">
            <Info className="size-4 text-primary" /> Scrim details & poster
          </span>
          <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="grid gap-5 border-t p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
          <dl className="divide-y text-sm">
            <InfoRow label="Matches (IST)">
              <MatchScheduleList scrim={scrim} />
            </InfoRow>
            <InfoRow label="Registration closes">{registrationCloseLabel(scrim)}</InfoRow>
            <InfoRow label="Slots">{slotRangeLabel(scrim.firstSlot, scrim.slotCount)}</InfoRow>
            <InfoRow label="Runs">{dateRangeLabel(scrim)}</InfoRow>
            {scrim.description && (
              <div className="py-2.5">
                <dt className="text-muted-foreground">Description</dt>
                <dd className="mt-1 whitespace-pre-line">{scrim.description}</dd>
              </div>
            )}
          </dl>
          <div className="space-y-5">
            <ScrimPosterCard scrimId={scrim.id} url={scrim.posterUrl} compact tour="detail-poster" className="border-0 bg-transparent p-0 shadow-none sm:p-0" />
            <ScrimPresetCard scrim={scrim} />
          </div>
        </div>
      </details>
      </div>
    </>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 first:pt-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
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
          description="Pick another date above."
        />
      );
    return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  }
  if (!q.data) return <SessionSkeleton />;
  return <SessionTabs s={q.data} />;
}

type SessionTab = "teams" | "matches";

/** "Teams" (registrations + slot board) and "Matches & results" (phase 2 match center entry). */
function SessionTabs({ s }: { s: SessionDetail }) {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const started = new Date(s.startsAt).getTime() <= Date.now();
  const tab: SessionTab = raw === "teams" || raw === "matches" ? raw : started ? "matches" : "teams";
  const setTab = (t: string) => {
    const next = new URLSearchParams(params);
    next.set("tab", t);
    setParams(next, { replace: true });
  };
  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-5">
      <TabsList className="h-11 w-full sm:w-auto" data-tour="detail-tabs">
        <TabsTrigger value="teams" className="px-4">
          <Users /> Teams
        </TabsTrigger>
        <TabsTrigger value="matches" className="px-4">
          <Trophy /> Matches & results
        </TabsTrigger>
      </TabsList>
      <TabsContent value="teams">
        <Session s={s} />
      </TabsContent>
      <TabsContent value="matches">
        <SessionMatches scrimId={s.scrim.id} date={s.date} />
      </TabsContent>
    </Tabs>
  );
}

function Session({ s }: { s: SessionDetail }) {
  const reject = useRejectRegistration();
  const now = useNow(15_000);
  const [removing, setRemoving] = useState<Registration | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const approved = s.registrations
    .filter((r) => r.status === "APPROVED")
    .sort((a, b) => (a.slotNumber ?? 99) - (b.slotNumber ?? 99));
  const closed = s.registrations.filter((r) => r.status === "REJECTED" || r.status === "CANCELLED");
  const full = s.counts.slotsLeft === 0;
  const pct = Math.round((s.counts.approved / Math.max(1, s.scrim.slotCount)) * 100);
  const left = countdown(s.startsAt, now);
  const opensIn = s.registrationOpensAt ? countdown(s.registrationOpensAt, now) : null;

  const copyList = async () => {
    const text = slotListText(s.scrim.title, formatDate(s.date), formatTime(s.scrim.startTime), s.slots);
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Slot list copied", { description: "Paste it into WhatsApp or Discord." });
    } catch {
      toast.error("Couldn't copy automatically", { description: "Your browser blocked clipboard access." });
    }
  };

  return (
    <div className="space-y-6">
      {/* key numbers */}
      <div data-tour="detail-summary" className="grid grid-cols-2 gap-4 rounded-xl border bg-card p-4 shadow-sm sm:grid-cols-3 sm:p-5">
        <div>
          <ZoneLabel>Confirmed</ZoneLabel>
          <p className="font-display text-3xl font-bold tabular-nums">
            {s.counts.approved}
            <span className="text-lg text-muted-foreground">/{s.scrim.slotCount}</span>
          </p>
          <Progress value={pct} className={cn("mt-1 h-1.5", full && "[&>[data-slot=progress-indicator]]:bg-success")} />
        </div>
        <SummaryStat label="Slots left" value={full ? "Full" : s.counts.slotsLeft} tone={full ? "text-success" : undefined} />
        <div>
          <ZoneLabel>Registration</ZoneLabel>
          {s.registrationOpen && left ? (
            <>
              <p className="flex items-center gap-1.5 font-display text-2xl font-bold text-success">
                <LockOpen className="size-4" /> Open
              </p>
              <p className="text-xs text-muted-foreground">Closes in {left}</p>
            </>
          ) : (
            <>
              <p className="flex items-center gap-1.5 font-display text-2xl font-bold text-muted-foreground">
                <Lock className="size-4" /> {opensIn && left ? "Not open yet" : "Closed"}
              </p>
              <p className="text-xs text-muted-foreground">{!left ? "Session started" : opensIn ? `Opens in ${opensIn}` : "Not taking teams"}</p>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)] lg:items-start">
        <div className="space-y-4">
          {/* Teams (they join on their own, confirmed on the next free slot) */}
          <Zone data-tour="detail-teams" label={`Teams · ${approved.length}`}>
            {approved.length === 0 ? (
              <p className="text-sm text-muted-foreground">No teams yet — the first team to join gets slot #{s.scrim.firstSlot}.</p>
            ) : (
              <ul className="-my-2 divide-y">
                {approved.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-2">
                    {r.slotNumber != null && <SlotChip slot={r.slotNumber} size="sm" />}
                    <p className="min-w-0 flex-1 truncate font-semibold">
                      {r.team.name} <span className="text-xs font-normal text-muted-foreground">[{r.team.tag}]</span>
                    </p>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-10 text-muted-foreground hover:text-destructive"
                      onClick={() => setRemoving(r)}
                      aria-label={`Remove ${r.team.name}`}
                      title="Remove from this session"
                    >
                      <UserMinus />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {closed.length > 0 && (
              <div className="mt-3 border-t pt-3">
                <button
                  type="button"
                  onClick={() => setShowClosed((v) => !v)}
                  className="flex min-h-8 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
                >
                  <ChevronDown className={cn("size-4 transition-transform", showClosed && "rotate-180")} />
                  Removed & cancelled ({closed.length})
                </button>
                {showClosed && (
                  <ul className="mt-1 divide-y">
                    {closed.map((r) => (
                      <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
                        <TeamAvatar name={r.team.name} tag={r.team.tag} size="sm" className="opacity-70" />
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{r.team.name}</span>
                          {r.rejectionReason && <span className="block truncate text-xs text-muted-foreground">“{r.rejectionReason}”</span>}
                        </span>
                        <StatusBadge status={r.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Zone>
        </div>

        {/* Slot board */}
        <Zone
          data-tour="detail-board"
          label="Slot board"
          className="lg:sticky lg:top-20"
          aside={
            <Button variant="outline" size="sm" onClick={() => void copyList()}>
              <Copy /> Copy
            </Button>
          }
        >
          <SlotBoard slots={s.slots} />
        </Zone>
      </div>

      <RejectDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        teamName={removing?.team.name ?? ""}
        mode="remove"
        onConfirm={(reason) => {
          if (removing) reject.mutate({ id: removing.id, teamName: removing.team.name, reason });
        }}
      />
    </div>
  );
}

function SummaryStat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div>
      <ZoneLabel>{label}</ZoneLabel>
      <p className={cn("font-display text-3xl font-bold tabular-nums", tone)}>{value}</p>
    </div>
  );
}

function SessionSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-28 rounded-xl" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
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
      <Skeleton className="h-20 rounded-xl" />
      <SessionSkeleton />
    </div>
  );
}
