import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowDownUp, CalendarX2, Search, X } from "lucide-react";
import { addDays, DATE_RE, todayInAppTz, type TeamScrimOnDate } from "@7xen/shared";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Input } from "@7xen/ui/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@7xen/ui/components/ui/select";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { useMyRegistrations, useTeamScrims } from "@/features/team/api";
import { DateStrip } from "@/features/team/components/DateStrip";
import { QueryError } from "@/features/team/components/QueryError";
import { ScrimCard, ScrimCardSkeleton } from "@/features/team/components/ScrimCard";
import { StaggerItem, StaggerList } from "@/features/team/components/Stagger";
import { dayLabel, formatDate } from "@/features/team/format";

const STEPS: TourStep[] = [
  { title: "Find your next scrim", description: "Pick a day, see every scrim running that day, and register your team in one tap." },
  { element: '[data-tour="date-strip"]', title: "1. Pick a day", description: "Tap a day to see its scrims. Swipe sideways for more days, or use the calendar for dates further away.", side: "bottom" },
  { element: '[data-tour="scrim-card"]', title: "2. Check the details", description: "Start time, organiser, maps for each match, and how many slots are still free.", side: "top" },
  { element: '[data-tour="scrim-action"]', title: "3. Register your team", description: "Tap the button to send a request. The organiser approves it and you get your slot number here.", side: "left" },
  { element: '[data-tour="scrim-search"]', title: "Looking for one scrim?", description: "Search by scrim name or organiser.", side: "bottom" },
];

type Sort = "time-asc" | "time-desc" | "slots";

export default function BrowseScrimsPage() {
  usePageTour("team.scrims", STEPS);
  const today = todayInAppTz();
  const [params, setParams] = useSearchParams();
  const raw = params.get("date");
  const date = raw && DATE_RE.test(raw) && raw >= today ? raw : today;
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("time-asc");

  const setDate = (d: string) => {
    const next = new URLSearchParams(params);
    if (d === today) next.delete("date");
    else next.set("date", d);
    setParams(next, { replace: true });
  };

  const q = useTeamScrims(date);
  const regs = useMyRegistrations("upcoming");
  const reasons = useMemo(() => new Map((regs.data ?? []).map((r) => [r.id, r.rejectionReason])), [regs.data]);

  const items = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = (q.data ?? []).filter(
      (s) => !term || s.scrim.title.toLowerCase().includes(term) || s.scrim.manager.displayName.toLowerCase().includes(term),
    );
    const byTime = (a: TeamScrimOnDate, b: TeamScrimOnDate) => a.startsAt.localeCompare(b.startsAt);
    return [...list].sort((a, b) =>
      sort === "time-desc" ? byTime(b, a) : sort === "slots" ? b.counts.slotsLeft - a.counts.slotsLeft || byTime(a, b) : byTime(a, b),
    );
  }, [q.data, search, sort]);

  const total = q.data?.length ?? 0;
  const mine = (q.data ?? []).filter((s) => s.myRegistration && s.myRegistration.status !== "CANCELLED").length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Browse scrims"
        title="Pick a day, join a scrim"
        description="Register your team — the organiser approves and you get a slot number."
        className="mb-0"
      />

      <DateStrip value={date} today={today} onChange={setDate} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold">
            {dayLabel(date, today)}
            {(date === today || date === addDays(today, 1)) && <span className="ml-2 text-base font-semibold text-muted-foreground">{formatDate(date)}</span>}
          </h2>
          <p className="text-sm text-muted-foreground">
            {q.isLoading ? "Loading scrims…" : `${total} ${total === 1 ? "scrim" : "scrims"}${mine ? ` · you're in ${mine}` : ""}`}
          </p>
        </div>
        {total > 0 && (
          <div className="flex gap-2">
            <div className="relative flex-1 sm:w-64 sm:flex-none" data-tour="scrim-search">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search scrim or organiser" className="h-10 pr-8 pl-9" aria-label="Search scrims" />
              {search && (
                <button type="button" onClick={() => setSearch("")} className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Clear search">
                  <X className="size-4" />
                </button>
              )}
            </div>
            <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
              <SelectTrigger className="h-10 w-auto gap-2" aria-label="Sort">
                <ArrowDownUp className="size-4 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="time-asc">Earliest first</SelectItem>
                <SelectItem value="time-desc">Latest first</SelectItem>
                <SelectItem value="slots">Most slots left</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} title="Couldn't load scrims" />
      ) : q.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <ScrimCardSkeleton />
          <ScrimCardSkeleton />
          <ScrimCardSkeleton />
          <ScrimCardSkeleton />
        </div>
      ) : total === 0 ? (
        <EmptyState
          icon={<CalendarX2 />}
          title="No scrims on this day"
          description="Try another date — organisers add new scrims all the time."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {[1, 2, 3].map((n) => {
                const d = addDays(date, n);
                return (
                  <Button key={d} variant={n === 1 ? "default" : "outline"} onClick={() => setDate(d)}>
                    {dayLabel(d, today)}
                  </Button>
                );
              })}
            </div>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Search />}
          title="No matches for your search"
          description={`Nothing on ${dayLabel(date, today)} matches “${search}”.`}
          action={
            <Button variant="outline" onClick={() => setSearch("")}>
              Clear search
            </Button>
          }
        />
      ) : (
        <StaggerList key={date} className="grid gap-4 lg:grid-cols-2">
          {items.map((s, i) => (
            <StaggerItem key={s.scrim.id} className="h-full">
              <ScrimCard item={s} tourAnchor={i === 0} rejectionReason={s.myRegistration ? reasons.get(s.myRegistration.id) : null} />
            </StaggerItem>
          ))}
        </StaggerList>
      )}
    </div>
  );
}
