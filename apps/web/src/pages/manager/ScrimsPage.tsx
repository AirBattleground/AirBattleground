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
import { QueryError } from "@/features/manager/components/QueryError";
import { ScrimStatusPill } from "@/features/manager/components/ScrimStatusPill";
import { SessionCard, SessionCardSkeleton } from "@/features/manager/components/SessionCard";
import { Zone } from "@/features/manager/components/Zone";

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

      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : !items ? (
        <Zone label={date === today ? "Today" : formatDate(date)}>
          <div className="-my-3 divide-y">
            <SessionCardSkeleton />
            <SessionCardSkeleton />
          </div>
        </Zone>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<CalendarDays />}
          title={`No scrims on ${formatDate(date)}`}
          description="Pick another day, or create a scrim for it."
          action={
            <Button asChild>
              <Link to="/manager/scrims/new">
                <Plus /> New scrim
              </Link>
            </Button>
          }
        />
      ) : (
        <Zone
          label={`${date === today ? "Today" : formatDate(date)} · ${items.length} session${items.length === 1 ? "" : "s"}`}
          className={cn("transition-opacity", q.isPlaceholderData && "opacity-60")}
        >
          <div className="-my-3 divide-y">
            {items.map((s) => (
              <SessionCard key={s.scrim.id} session={s} />
            ))}
          </div>
        </Zone>
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
      <div className="space-y-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-14 rounded-xl" />
        ))}
      </div>
    );
  if (q.data.length === 0)
    return (
      <EmptyState
        icon={<CalendarPlus />}
        title="Create your first scrim"
        description="Teams can register as soon as it's live."
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
    <Zone
      label={`${visible.length} scrim${visible.length === 1 ? "" : "s"}`}
      aside={
        archivedCount > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setShowArchived((v) => !v)}>
            <Archive /> {showArchived ? "Hide" : "Show"} archived ({archivedCount})
          </Button>
        )
      }
    >
      <ul className="-my-3 divide-y">
        {visible.map((s) => (
          <ScrimRow key={s.id} scrim={s} />
        ))}
      </ul>
    </Zone>
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
    <li className={cn("flex items-center gap-3 py-3", archived && "opacity-70")}>
      <div className="min-w-0 flex-1">
        <Link to={`/manager/scrims/${scrim.id}`} className="block truncate font-display text-lg font-bold hover:text-primary">
          {scrim.title}
        </Link>
        <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          <Repeat className="size-3.5 shrink-0 text-primary" />
          <span className="truncate">
            {recurrenceLabel(scrim)} · {slotRangeLabel(scrim.firstSlot, scrim.slotCount)}
            <span className="hidden sm:inline"> · {scrim.maps.length} match{scrim.maps.length === 1 ? "" : "es"} · {dateRangeLabel(scrim)}</span>
          </span>
        </p>
      </div>
      {scrim.status !== "ACTIVE" && <ScrimStatusPill status={scrim.status} />}
      <Button asChild size="sm" variant="outline" className="hidden h-10 sm:inline-flex">
        <Link to={`/manager/scrims/${scrim.id}`}>Open</Link>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-10" aria-label="More actions" disabled={upd.isPending}>
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
      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={`Archive “${scrim.title}”?`}
        description="It will stop running and teams won't see it any more. Existing registrations are kept. You can restore it later from the archived list."
        confirmLabel="Archive scrim"
        destructive
        onConfirm={() => setStatus("ARCHIVED", `Archived “${scrim.title}”`)}
      />
    </li>
  );
}
