import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowDownUp, CalendarX2, Search, SlidersHorizontal, X } from "lucide-react";
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
import { useDayFormat } from "@/features/team/format";
import { useT } from "@/i18n/core";
import { browseMsg, scrimUi } from "@/i18n/scrims";

/** As many columns as fit with each card ≥ 21rem (its content is ~340px; wider cards were mostly empty space). auto-fill keeps a lone card from stretching. */
/** "Upcoming" shows this many days (today first). */
const UPCOMING_DAYS = 7;
const SCRIM_GRID = "grid gap-4 grid-cols-[repeat(auto-fill,minmax(min(100%,21rem),1fr))]";


type Sort = "time-asc" | "time-desc" | "slots";

export default function BrowseScrimsPage() {
  const t = useT(browseMsg);
  const ts = useT(scrimUi);
  const { dayLabel, formatDate } = useDayFormat();
  const steps = useMemo<TourStep[]>(
    () => [
      { title: t("tour_intro_title"), description: t("tour_intro_text") },
      { element: '[data-tour="date-strip"]', title: t("tour_strip_title"), description: t("tour_strip_text"), side: "bottom" },
      { element: '[data-tour="scrim-card"]', title: t("tour_card_title"), description: t("tour_card_text"), side: "top" },
      { element: '[data-tour="scrim-action"]', title: t("tour_action_title"), description: t("tour_action_text"), side: "left" },
      { element: '[data-tour="scrim-search"]', title: t("tour_search_title"), description: t("tour_search_text"), side: "bottom" },
    ],
    [t],
  );
  usePageTour("team.scrims", steps);
  const today = todayInAppTz();
  const [params, setParams] = useSearchParams();
  const raw = params.get("date");
  // no ?date= → "Upcoming": the next 7 days at once; a picked day → just that day
  const date = raw && DATE_RE.test(raw) && raw >= today ? raw : null;
  const week = useMemo(() => Array.from({ length: UPCOMING_DAYS }, (_, i) => addDays(today, i)), [today]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("time-asc");
  const [toolsOpen, setToolsOpen] = useState(false);
  // keep the search row visible while a search is active, even if the toggle was closed
  const tools = toolsOpen || !!search;

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
    <div className="space-y-6">
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} className="mb-0" />

      {/* zone 1: pick a day + what's on it; search & sort tucked behind one button */}
      <section className="space-y-3 rounded-2xl border bg-card p-4 sm:p-5">
        <p className="text-[11px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">{ts("pick_day")}</p>
        <DateStrip value={date ?? ""} today={today} onChange={setDate} counts={counts} onUpcoming={() => setDate(null)} />
        <div className="flex items-center justify-between gap-3 border-t pt-3">
          <div className="min-w-0">
            <h2 className="truncate font-display text-xl font-bold sm:text-2xl">
              {date ? dayLabel(date, today) : t("next7")}
              {date && (date === today || date === addDays(today, 1)) && <span className="ml-2 text-sm font-semibold text-muted-foreground">{formatDate(date)}</span>}
            </h2>
            <p className="text-sm text-muted-foreground tabular-nums">
              {q.isLoading ? t("loading") : `${ts.plural("scrims", total)}${mine ? t("youre_in", { count: mine }) : ""}`}
            </p>
          </div>
          {total > 0 && (
            <Button
              variant={tools ? "secondary" : "outline"}
              size="icon"
              className="size-10 shrink-0"
              onClick={() => {
                if (tools) {
                  setToolsOpen(false);
                  setSearch("");
                } else setToolsOpen(true);
              }}
              aria-expanded={tools}
              aria-label={t("search_label")}
              title={t("search_label")}
              data-tour="scrim-search"
            >
              {search || sort !== "time-asc" ? <SlidersHorizontal className="text-primary" /> : <Search />}
            </Button>
          )}
        </div>
        {total > 0 && tools && (
          <div className="flex gap-2">
            <div className="relative flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("search_placeholder")} className="h-10 pr-8 pl-9" aria-label={t("search_label")} />
              {search && (
                <button type="button" onClick={() => setSearch("")} className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground" aria-label={t("clear_search")}>
                  <X className="size-4" />
                </button>
              )}
            </div>
            <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
              <SelectTrigger className="h-10 w-auto gap-2" aria-label={t("sort")}>
                <ArrowDownUp className="size-4 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="time-asc">{t("sort_asc")}</SelectItem>
                <SelectItem value="time-desc">{t("sort_desc")}</SelectItem>
                <SelectItem value="slots">{t("sort_slots")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </section>

      {/* zone 2: the scrims */}
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} title={t("load_error")} />
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
            title={t("empty_day_title")}
            description={t("empty_day_text")}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => setDate(null)}>{t("see_upcoming")}</Button>
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
            title={t("empty_week_title")}
            description={t("empty_week_text")}
          />
        )
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Search />}
          title={t("no_results_title")}
          description={date ? t("no_results_day", { day: dayLabel(date, today), q: search }) : t("no_results_week", { q: search })}
          action={
            <Button variant="outline" onClick={() => setSearch("")}>
              {t("clear_search")}
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
        <div className="space-y-6">
          {groups.map((g, gi) => (
            <section key={g.date} className="space-y-3">
              <h3 className="flex items-baseline gap-2 border-b pb-2 font-display text-xl font-bold">
                <span className={g.date === today ? "text-primary" : undefined}>{dayLabel(g.date, today)}</span>
                {dayLabel(g.date, today) !== formatDate(g.date) && <span className="text-sm font-medium text-muted-foreground">{formatDate(g.date)}</span>}
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
