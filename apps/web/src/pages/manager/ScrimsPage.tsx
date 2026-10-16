import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Archive,
  CalendarDays,
  CalendarPlus,
  ExternalLink,
  List,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { addDays, DATE_RE, todayInAppTz, type Scrim, type ScrimStatus } from "@7xen/shared";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@7xen/ui/components/ui/dropdown-menu";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@7xen/ui/components/ui/tabs";
import { cn } from "@7xen/ui/lib/utils";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { errorMessage, useSchedule, useScrims, useUpdateScrim } from "@/features/manager/api";
import { dateRangeLabel, formatDate, recurrenceLabel, slotRangeLabel } from "@/features/manager/format";
import { ConfirmDialog } from "@/features/manager/components/ConfirmDialog";
import { DatePickerButton } from "@/features/manager/components/DatePickerButton";
import { DateStrip } from "@/features/manager/components/DateStrip";
import { MapChips } from "@/features/manager/components/maps";
import { QueryError } from "@/features/manager/components/QueryError";
import { ScrimStatusPill } from "@/features/manager/components/ScrimStatusPill";
import { SessionCard, SessionCardSkeleton } from "@/features/manager/components/SessionCard";

const TOUR: TourStep[] = [
  { title: "Your scrims", description: "Everything you've set up lives here — by day, or as a full list." },
  { element: '[data-tour="view-tabs"]', title: "Two ways to look", description: "“By date” shows what runs on a given day. “All scrims” lists every scrim you've created." },
  { element: '[data-tour="date-strip"]', title: "Pick a day", description: "Tap a day to see its sessions. Weekends are highlighted. Use the calendar for dates further out." },
  { element: '[data-tour="new-scrim"]', title: "Create a new scrim", description: "Set up maps, time and slots in under a minute." },
];

const STRIP_DAYS = 14;
type View = "date" | "all";

export default function ScrimsPage() {
  usePageTour("manager.scrims", TOUR);
  const [params, setParams] = useSearchParams();
  const today = todayInAppTz();
  const view: View = params.get("view") === "all" ? "all" : "date";
  const rawDate = params.get("date");
  const date = rawDate && DATE_RE.test(rawDate) ? rawDate : today;

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v == null ? next.delete(k) : next.set(k, v));
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Scrims"
        description="See what's running each day, and manage the scrims you've set up."
        actions={
          <Button asChild size="lg" data-tour="new-scrim">
            <Link to="/manager/scrims/new">
              <Plus /> New scrim
            </Link>
          </Button>
        }
      />
      <Tabs value={view} onValueChange={(v) => update({ view: v === "all" ? "all" : null })}>
        <TabsList data-tour="view-tabs" className="h-10">
          <TabsTrigger value="date" className="px-4">
            <CalendarDays /> By date
          </TabsTrigger>
          <TabsTrigger value="all" className="px-4">
            <List /> All scrims
          </TabsTrigger>
        </TabsList>
        <TabsContent value="date" className="mt-4">
          <ByDate date={date} today={today} onDate={(d) => update({ date: d === today ? null : d })} />
        </TabsContent>
        <TabsContent value="all" className="mt-4">
          <AllScrims />
        </TabsContent>
      </Tabs>
    </>
  );
}

function ByDate({ date, today, onDate }: { date: string; today: string; onDate: (d: string) => void }) {
  const dates = useMemo(() => {
    const list = Array.from({ length: STRIP_DAYS }, (_, i) => addDays(today, i));
    if (!list.includes(date)) list.push(date);
    return list.sort();
  }, [today, date]);
  const q = useSchedule(date);
  const items = q.data ? [...q.data].sort((a, b) => a.startsAt.localeCompare(b.startsAt)) : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div data-tour="date-strip" className="min-w-0 flex-1">
          <DateStrip dates={dates} value={date} onChange={onDate} />
        </div>
        <DatePickerButton value={date} onChange={onDate} label="Other date" className="self-start lg:self-center" />
      </div>

      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-2xl font-bold">{date === today ? "Today" : formatDate(date)}</h2>
        {items && <span className="text-sm text-muted-foreground">{items.length} session{items.length === 1 ? "" : "s"}</span>}
      </div>

      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : !items ? (
        <div className="space-y-3">
          <SessionCardSkeleton />
          <SessionCardSkeleton />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<CalendarDays />}
          title={`No scrims on ${formatDate(date)}`}
          description="None of your active scrims run on this day. Pick another day, or create a scrim for it."
          action={
            <Button asChild>
              <Link to="/manager/scrims/new">
                <Plus /> New scrim
              </Link>
            </Button>
          }
        />
      ) : (
        <div className={cn("space-y-3 transition-opacity", q.isPlaceholderData && "opacity-60")}>
          {items.map((s) => (
            <SessionCard key={s.scrim.id} session={s} />
          ))}
        </div>
      )}
    </div>
  );
}

const STATUS_ORDER: Record<ScrimStatus, number> = { ACTIVE: 0, PAUSED: 1, ARCHIVED: 2 };

function AllScrims() {
  const q = useScrims();
  const [showArchived, setShowArchived] = useState(false);
  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data)
    return (
      <div className="grid gap-3 md:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-44 rounded-xl" />
        ))}
      </div>
    );
  if (q.data.length === 0)
    return (
      <EmptyState
        icon={<CalendarPlus />}
        title="Create your first scrim"
        description="Pick the maps, the time and how many slots. Teams can register as soon as it's live."
        action={
          <Button asChild size="lg">
            <Link to="/manager/scrims/new">
              <Plus /> Create your first scrim
            </Link>
          </Button>
        }
      />
    );
  const sorted = [...q.data].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.title.localeCompare(b.title));
  const archivedCount = sorted.filter((s) => s.status === "ARCHIVED").length;
  const visible = showArchived ? sorted : sorted.filter((s) => s.status !== "ARCHIVED");
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        {visible.map((s) => (
          <ScrimRow key={s.id} scrim={s} />
        ))}
      </div>
      {archivedCount > 0 && (
        <Button variant="ghost" size="sm" onClick={() => setShowArchived((v) => !v)}>
          <Archive /> {showArchived ? "Hide" : "Show"} archived ({archivedCount})
        </Button>
      )}
    </div>
  );
}

function ScrimRow({ scrim }: { scrim: Scrim }) {
  const upd = useUpdateScrim();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const setStatus = (status: ScrimStatus, msg: string) =>
    upd.mutate(
      { id: scrim.id, input: { status } },
      {
        onSuccess: () => toast.success(msg),
        onError: (e) => toast.error("Couldn't update the scrim", { description: errorMessage(e) }),
      },
    );
  const archived = scrim.status === "ARCHIVED";
  return (
    <div className={cn("flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm transition-all hover:border-primary/40 sm:p-5", archived && "opacity-70")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/manager/scrims/${scrim.id}`} className="block truncate font-display text-xl font-bold hover:text-primary">
            {scrim.title}
          </Link>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm font-medium">
            <Repeat className="size-3.5 text-primary" /> {recurrenceLabel(scrim)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ScrimStatusPill status={scrim.status} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More actions" disabled={upd.isPending}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to={`/manager/scrims/${scrim.id}`}>
                  <ExternalLink /> Open
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to={`/manager/scrims/${scrim.id}/edit`}>
                  <Pencil /> Edit
                </Link>
              </DropdownMenuItem>
              {scrim.status === "ACTIVE" && (
                <DropdownMenuItem onSelect={() => setStatus("PAUSED", `Paused “${scrim.title}” — teams can't register until you resume it`)}>
                  <Pause /> Pause
                </DropdownMenuItem>
              )}
              {scrim.status !== "ACTIVE" && (
                <DropdownMenuItem onSelect={() => setStatus("ACTIVE", `“${scrim.title}” is live again`)}>
                  <Play /> {archived ? "Restore" : "Resume"}
                </DropdownMenuItem>
              )}
              {!archived && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => setConfirmArchive(true)}>
                    <Archive /> Archive
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{dateRangeLabel(scrim)}</p>
      <MapChips maps={scrim.maps} numbered />
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Users className="size-4" /> {slotRangeLabel(scrim.firstSlot, scrim.slotCount)}
        </span>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to={`/manager/scrims/${scrim.id}/edit`}>
              <Pencil /> Edit
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link to={`/manager/scrims/${scrim.id}`}>Open</Link>
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={`Archive “${scrim.title}”?`}
        description="It will stop running and teams won't see it any more. Existing registrations are kept. You can restore it later from the archived list."
        confirmLabel="Archive scrim"
        destructive
        onConfirm={() => setStatus("ARCHIVED", `Archived “${scrim.title}”`)}
      />
    </div>
  );
}
