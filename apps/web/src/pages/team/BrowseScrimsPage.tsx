import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowDownUp, CalendarX2, Search, X } from "lucide-react";
import { addDays, DATE_RE, todayInAppTz, type TeamScrimOnDate } from "@7xen/shared";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Input } from "@7xen/ui/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@7xen/ui/components/ui/select";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { useMyRegistrations, useTeamScrimsForDays } from "@/features/team/api";
import { DateStrip } from "@/features/team/components/DateStrip";
import { QueryError } from "@/features/team/components/QueryError";
import { ScrimCard, ScrimCardSkeleton } from "@/features/team/components/ScrimCard";
import { StaggerItem, StaggerList } from "@/features/team/components/Stagger";
import { dayLabel, formatDate } from "@/features/team/format";

/** As many columns as fit with each card ≥ 21rem (its content is ~340px; wider cards were mostly empty space). auto-fill keeps a lone card from stretching. */
/** "Upcoming" shows this many days (today first). */
const UPCOMING_DAYS = 7;
const SCRIM_GRID = "grid gap-4 grid-cols-[repeat(auto-fill,minmax(min(100%,21rem),1fr))]";

const STEPS: TourStep[] = [
  { title: "Find your next scrim", description: "Every scrim in the next 7 days, in one list. Register your team in one tap." },
  { element: '[data-tour="date-strip"]', title: "1. Upcoming or one day", description: "Upcoming shows the whole week; the number on each day is how many scrims it has. Tap a day to see only that day, or More for later dates.", side: "bottom" },
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
  // no ?date= → "Upcoming": the next 7 days at once; a picked day → just that day
  const date = raw && DATE_RE.test(raw) && raw >= today ? raw : null;
  const week = useMemo(() => Array.from({ length: UPCOMING_DAYS }, (_, i) => addDays(today, i)), [today]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("time-asc");

  const setDate = (d: string | null) => {
    const next = new URLSearchParams(params);
    if (d) next.set("date", d);
    else next.delete("date");
    setParams(next, { replace: true });
  };

  const days = useTeamScrimsForDays(date && !week.includes(date) ? [...week, date] : week);
  const counts = useMemo(() => new Map(week.map((d) => [d, days.byDate.get(d)?.length])), [days.byDate, week]);
  // Upcoming leaves out scrims that already started (unless your team is in them) — only joinable ones matter there
  const all = useMemo(() => {
    if (date) return days.byDate.get(date) ?? null;
    if (week.every((d) => days.byDate.get(d) === undefined)) return null;
    const now = Date.now();
    return week.flatMap((d) => days.byDate.get(d) ?? []).filter((s) => new Date(s.startsAt).getTime() > now || (s.myRegistration && s.myRegistration.status !== "CANCELLED"));
  }, [date, days.byDate, week]);
  const q = { data: all, isLoading: all === null && days.isLoading, isError: days.isError && all === null, error: days.error, refetch: days.refetch };
  const regs = useMyRegistrations("upcoming");
  const reasons = useMemo(() => new Map((regs.data ?? []).map((r) => [r.id, r.rejectionReason])), [regs.data]);

  const items = useMemo((): TeamScrimOnDate[] => {
    const term = search.trim().toLowerCase();
    const list = (q.data ?? []).filter(
      (s) => !term || s.scrim.title.toLowerCase().includes(term) || s.scrim.manager.displayName.toLowerCase().includes(term),
    );
    const byTime = (a: TeamScrimOnDate, b: TeamScrimOnDate) => a.startsAt.localeCompare(b.startsAt);
    return [...list].sort((a, b) =>
      sort === "time-desc" ? byTime(b, a) : sort === "slots" ? b.counts.slotsLeft - a.counts.slotsLeft || byTime(a, b) : byTime(a, b),
    );
  }, [q.data, search, sort]);
  // Upcoming: group by day, in date order (each day keeps the chosen sort)
  const groups = useMemo(() => {
    const out: { date: string; items: TeamScrimOnDate[] }[] = [];
    for (const d of [...new Set(items.map((s) => s.date))].sort()) out.push({ date: d, items: items.filter((s) => s.date === d) });
    return out;
  }, [items]);

  const total = q.data?.length ?? 0;
  const mine = (q.data ?? []).filter((s) => s.myRegistration && s.myRegistration.status !== "CANCELLED").length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Browse scrims"
        title="Find a scrim, join in one tap"
        description="Register your team — the organiser approves and you get a slot number."
        className="mb-0"
      />

      <DateStrip value={date ?? ""} today={today} onChange={setDate} counts={counts} onUpcoming={() => setDate(null)} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold">
            {date ? dayLabel(date, today) : "Next 7 days"}
            {date && (date === today || date === addDays(today, 1)) && <span className="ml-2 text-base font-semibold text-muted-foreground">{formatDate(date)}</span>}
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
        <div className={SCRIM_GRID}>
          <ScrimCardSkeleton />
          <ScrimCardSkeleton />
          <ScrimCardSkeleton />
          <ScrimCardSkeleton />
        </div>
      ) : total === 0 ? (
        date ? (
          <EmptyState
            icon={<CalendarX2 />}
            title="No scrims on this day"
            description="Try another date — organisers add new scrims all the time."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => setDate(null)}>See all upcoming</Button>
                {[1, 2].map((n) => {
                  const d = addDays(date, n);
                  return (
                    <Button key={d} variant="outline" onClick={() => setDate(d)}>
                      {dayLabel(d, today)}
                    </Button>
                  );
                })}
              </div>
            }
          />
        ) : (
          <EmptyState
            icon={<CalendarX2 />}
            title="No scrims in the next 7 days"
            description="Organisers add new scrims all the time — check back soon, or pick a later date with More."
          />
        )
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Search />}
          title="No matches for your search"
          description={`Nothing ${date ? `on ${dayLabel(date, today)}` : "in the next 7 days"} matches “${search}”.`}
          action={
            <Button variant="outline" onClick={() => setSearch("")}>
              Clear search
            </Button>
          }
        />
      ) : date ? (
        <StaggerList key={date} className={SCRIM_GRID}>
          {items.map((s, i) => (
            <StaggerItem key={s.scrim.id} className="h-full">
              <ScrimCard item={s} tourAnchor={i === 0} rejectionReason={s.myRegistration ? reasons.get(s.myRegistration.id) : null} />
            </StaggerItem>
          ))}
        </StaggerList>
      ) : (
        <div className="space-y-8">
          {groups.map((g, gi) => (
            <section key={g.date} className="space-y-3">
              <h3 className="flex items-baseline gap-2 border-b pb-2 font-display text-xl font-bold">
                <span className={g.date === today ? "text-primary" : undefined}>{dayLabel(g.date, today)}</span>
                {dayLabel(g.date, today) !== formatDate(g.date) && <span className="text-sm font-medium text-muted-foreground">{formatDate(g.date)}</span>}
                <span className="ml-auto text-xs font-medium text-muted-foreground">
                  {g.items.length} {g.items.length === 1 ? "scrim" : "scrims"}
                </span>
              </h3>
              <StaggerList className={SCRIM_GRID}>
                {g.items.map((s, i) => (
                  <StaggerItem key={`${s.scrim.id}-${s.date}`} className="h-full">
                    <ScrimCard item={s} tourAnchor={gi === 0 && i === 0} rejectionReason={s.myRegistration ? reasons.get(s.myRegistration.id) : null} />
                  </StaggerItem>
                ))}
              </StaggerList>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
