import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarClock, Clock, History, Search } from "lucide-react";
import { todayInAppTz, type TeamRegistration } from "@7xen/shared";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { SlotChip } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@7xen/ui/components/ui/tabs";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { usePlayerSession } from "@/lib/auth";
import { NoTeamHint } from "@/features/player/components/NoTeamHint";
import { useMyRegistrations, type RegistrationScope } from "@/features/team/api";
import { QueryError } from "@/features/team/components/QueryError";
import { RegistrationCard, RegistrationCardSkeleton } from "@/features/team/components/RegistrationCard";
import { StaggerItem, StaggerList } from "@/features/team/components/Stagger";
import { formatTime, useDayFormat } from "@/features/team/format";
import { useT } from "@/i18n/core";
import { regsMsg, scrimUi } from "@/i18n/scrims";
import { MyEntriesList } from "@/features/tournaments/team/components/MyEntriesList";


function groupByDate(items: TeamRegistration[], desc: boolean) {
  const sorted = [...items].sort((a, b) => (desc ? b.startsAt.localeCompare(a.startsAt) : a.startsAt.localeCompare(b.startsAt)));
  const groups: { date: string; items: TeamRegistration[] }[] = [];
  for (const r of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.date === r.date) last.items.push(r);
    else groups.push({ date: r.date, items: [r] });
  }
  return groups;
}

function RegistrationList({ scope, today }: { scope: RegistrationScope; today: string }) {
  const t = useT(regsMsg);
  const { dayLabel, formatDate } = useDayFormat();
  const { hasTeam } = usePlayerSession();
  const q = useMyRegistrations(scope);
  const groups = useMemo(() => groupByDate(q.data ?? [], scope === "past"), [q.data, scope]);

  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} title={t("load_error")} />;
  if (q.isLoading)
    return (
      <div className="space-y-3">
        <RegistrationCardSkeleton />
        <RegistrationCardSkeleton />
        <RegistrationCardSkeleton />
      </div>
    );
  if (groups.length === 0 && !hasTeam)
    return <NoTeamHint icon={scope === "upcoming" ? <CalendarClock /> : <History />}>{t("no_team")}</NoTeamHint>;
  if (groups.length === 0)
    return scope === "upcoming" ? (
      <EmptyState icon={<CalendarClock />} title={t("empty_up_title")} description={t("empty_up_text")} />
    ) : (
      <EmptyState icon={<History />} title={t("empty_past_title")} description={t("empty_past_text")} />
    );

  // mark only the first pending / approved / cancellable card for the tour
  const firstStatus = q.data?.find((r) => !(r.status === "APPROVED" && r.slotNumber != null))?.id;
  const firstSlot = q.data?.find((r) => r.status === "APPROVED" && r.slotNumber != null)?.id;

  return (
    <StaggerList className="space-y-5">
      {groups.map((g) => (
        <StaggerItem key={g.date}>
          <section className="space-y-2">
            <h3 className="flex items-baseline gap-2 font-display text-lg font-bold">
              <span className={g.date === today ? "text-primary" : undefined}>{dayLabel(g.date, today)}</span>
              {dayLabel(g.date, today) !== formatDate(g.date) && (
                <span className="text-sm font-medium text-muted-foreground">{formatDate(g.date)}</span>
              )}
            </h3>
            <div className="space-y-2">
              {g.items.map((r) => (
                <RegistrationCard key={r.id} reg={r} today={today} cancellable={scope === "upcoming"} tourAnchor={scope === "upcoming" && (r.id === firstStatus || r.id === firstSlot)} />
              ))}
            </div>
          </section>
        </StaggerItem>
      ))}
    </StaggerList>
  );
}

export default function MyRegistrationsPage() {
  const t = useT(regsMsg);
  const steps = useMemo<TourStep[]>(
    () => [
      { title: t("tour_intro_title"), description: t("tour_intro_text") },
      { element: '[data-tour="reg-tabs"]', title: t("tour_tabs_title"), description: t("tour_tabs_text"), side: "bottom" },
      { element: '[data-tour="reg-status"]', title: t("tour_status_title"), description: t("tour_status_text"), side: "left" },
      { element: '[data-tour="reg-slot"]', title: t("tour_slot_title"), description: t("tour_slot_text"), side: "left" },
      { element: '[data-tour="reg-cancel"]', title: t("tour_cancel_title"), description: t("tour_cancel_text"), side: "left" },
    ],
    [t],
  );
  usePageTour("team.registrations", steps);
  const today = todayInAppTz();
  const [params, setParams] = useSearchParams();
  const tab: RegistrationScope = params.get("tab") === "past" ? "past" : "upcoming";
  const upcoming = useMyRegistrations("upcoming");
  const pending = upcoming.data?.filter((r) => r.status === "PENDING").length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} className="mb-0" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        {/* key facts + the one action; first on phones, right column on desktop */}
        <NextMatchPanel regs={upcoming.data} loading={upcoming.isLoading} pending={pending} today={today} />

        {/* main: the list */}
        <Tabs
          className="lg:order-first"
          value={tab}
          onValueChange={(v) => {
            const next = new URLSearchParams(params);
            if (v === "past") next.set("tab", "past");
            else next.delete("tab");
            setParams(next, { replace: true });
          }}
        >
          <TabsList className="h-11 w-full sm:w-auto" data-tour="reg-tabs">
            <TabsTrigger value="upcoming" className="px-5 text-sm">
              {t("tab_upcoming")}
            </TabsTrigger>
            <TabsTrigger value="past" className="px-5 text-sm">
              {t("tab_past")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="upcoming" className="mt-4 space-y-6">
            <MyEntriesList scope="upcoming" />
            <RegistrationList scope="upcoming" today={today} />
          </TabsContent>
          <TabsContent value="past" className="mt-4 space-y-6">
            <MyEntriesList scope="past" />
            <RegistrationList scope="past" today={today} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

/** Side zone: the next approved scrim (big slot number), how many requests are waiting, and "Find a scrim". */
function NextMatchPanel({ regs, loading, pending, today }: { regs: TeamRegistration[] | undefined; loading: boolean; pending: number; today: string }) {
  const t = useT(regsMsg);
  const ts = useT(scrimUi);
  const { dayLabel } = useDayFormat();
  const next = useMemo(
    () => [...(regs ?? [])].filter((r) => r.status === "APPROVED").sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null,
    [regs],
  );
  return (
    <aside className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
      <p className="text-[11px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">{ts("next_match")}</p>
      {loading ? (
        <Skeleton className="h-14 rounded-lg" />
      ) : next ? (
        <div className="flex items-center gap-3">
          {next.slotNumber != null && <SlotChip slot={next.slotNumber} />}
          <div className="min-w-0">
            <p className="truncate font-display text-lg leading-tight font-bold">{next.scrim.title}</p>
            <p className="text-sm text-muted-foreground tabular-nums">
              {dayLabel(next.date, today)} · {formatTime(next.scrim.startTime)} IST
            </p>
          </div>
        </div>
      ) : (
        <p className="font-display text-lg font-bold">{ts("no_match_title")}</p>
      )}
      {pending > 0 && (
        <p className="flex items-center gap-1.5 text-sm font-medium text-warning-foreground dark:text-warning">
          <Clock className="size-4" /> {t("waiting", { count: pending })}
        </p>
      )}
      <Button asChild size="lg" className="w-full">
        <Link to="/team/scrims">
          <Search /> {t("find_scrim")}
        </Link>
      </Button>
    </aside>
  );
}
