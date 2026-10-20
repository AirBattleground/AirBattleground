import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarClock, History, Search } from "lucide-react";
import { todayInAppTz, type TeamRegistration } from "@7xen/shared";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@7xen/ui/components/ui/tabs";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { usePlayerSession } from "@/lib/auth";
import { NoTeamHint } from "@/features/player/components/NoTeamHint";
import { useMyRegistrations, type RegistrationScope } from "@/features/team/api";
import { QueryError } from "@/features/team/components/QueryError";
import { RegistrationCard, RegistrationCardSkeleton } from "@/features/team/components/RegistrationCard";
import { StaggerItem, StaggerList } from "@/features/team/components/Stagger";
import { useDayFormat } from "@/features/team/format";
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
  const ts = useT(scrimUi);
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
      <EmptyState
        icon={<CalendarClock />}
        title={t("empty_up_title")}
        description={t("empty_up_text")}
        action={
          <Button asChild size="lg">
            <Link to="/team/scrims">
              <Search /> {t("find_scrim")}
            </Link>
          </Button>
        }
      />
    ) : (
      <EmptyState icon={<History />} title={t("empty_past_title")} description={t("empty_past_text")} />
    );

  // mark only the first pending / approved / cancellable card for the tour
  const firstStatus = q.data?.find((r) => !(r.status === "APPROVED" && r.slotNumber != null))?.id;
  const firstSlot = q.data?.find((r) => r.status === "APPROVED" && r.slotNumber != null)?.id;

  return (
    <StaggerList className="space-y-6">
      {groups.map((g) => (
        <StaggerItem key={g.date}>
          <section className="space-y-2.5">
            <h3 className="flex items-baseline gap-2 font-display text-lg font-bold">
              <span className={g.date === today ? "text-primary" : undefined}>{dayLabel(g.date, today)}</span>
              {dayLabel(g.date, today) !== formatDate(g.date) && (
                <span className="text-sm font-medium text-muted-foreground">{formatDate(g.date)}</span>
              )}
              <span className="ml-auto text-xs font-medium text-muted-foreground">
                {ts.plural("scrims", g.items.length)}
              </span>
            </h3>
            <div className="space-y-2.5">
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
    <div className="space-y-5">
      <PageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
        className="mb-0"
        actions={
          <Button asChild variant="outline">
            <Link to="/team/scrims">
              <Search /> {t("find_scrim")}
            </Link>
          </Button>
        }
      />
      <Tabs
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
            {pending > 0 && <span className="ml-1 rounded-full bg-warning/20 px-1.5 text-[11px] font-bold text-warning-foreground dark:text-warning">{t("waiting", { count: pending })}</span>}
          </TabsTrigger>
          <TabsTrigger value="past" className="px-5 text-sm">
            {t("tab_past")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="upcoming" className="mt-5 space-y-6">
          <MyEntriesList scope="upcoming" />
          <RegistrationList scope="upcoming" today={today} />
        </TabsContent>
        <TabsContent value="past" className="mt-5 space-y-6">
          <MyEntriesList scope="past" />
          <RegistrationList scope="past" today={today} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
