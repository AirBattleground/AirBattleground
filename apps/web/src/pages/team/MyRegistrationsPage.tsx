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
import { dayLabel, formatDate } from "@/features/team/format";

const STEPS: TourStep[] = [
  { title: "Your registrations", description: "Every scrim your team asked to join, and what the organiser decided." },
  { element: '[data-tour="reg-tabs"]', title: "Upcoming and past", description: "Upcoming shows what's next. Past keeps your history.", side: "bottom" },
  { element: '[data-tour="reg-status"]', title: "Status in plain words", description: "“Waiting for approval” means the organiser hasn't decided yet. This page refreshes by itself.", side: "left" },
  { element: '[data-tour="reg-slot"]', title: "Your slot number", description: "Approved? This is your slot in the room. Remember it for the match!", side: "left" },
  { element: '[data-tour="reg-cancel"]', title: "Can't make it?", description: "Cancel here so another team can take the spot.", side: "left" },
];

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
  const { hasTeam } = usePlayerSession();
  const q = useMyRegistrations(scope);
  const groups = useMemo(() => groupByDate(q.data ?? [], scope === "past"), [q.data, scope]);

  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} title="Couldn't load registrations" />;
  if (q.isLoading)
    return (
      <div className="space-y-3">
        <RegistrationCardSkeleton />
        <RegistrationCardSkeleton />
        <RegistrationCardSkeleton />
      </div>
    );
  if (groups.length === 0 && !hasTeam)
    return <NoTeamHint icon={scope === "upcoming" ? <CalendarClock /> : <History />}>Your team's registrations show up here.</NoTeamHint>;
  if (groups.length === 0)
    return scope === "upcoming" ? (
      <EmptyState
        icon={<CalendarClock />}
        title="No upcoming scrims"
        description="You haven't registered for anything yet. Find a scrim and send a request — it only takes a tap."
        action={
          <Button asChild size="lg">
            <Link to="/team/scrims">
              <Search /> Find a scrim
            </Link>
          </Button>
        }
      />
    ) : (
      <EmptyState icon={<History />} title="No past scrims yet" description="Scrims you've registered for will show up here after they're played." />
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
                {g.items.length} {g.items.length === 1 ? "scrim" : "scrims"}
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
  usePageTour("team.registrations", STEPS);
  const today = todayInAppTz();
  const [params, setParams] = useSearchParams();
  const tab: RegistrationScope = params.get("tab") === "past" ? "past" : "upcoming";
  const upcoming = useMyRegistrations("upcoming");
  const pending = upcoming.data?.filter((r) => r.status === "PENDING").length ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="My registrations"
        title="Your scrims"
        description="Track every request. Approvals show up here automatically."
        className="mb-0"
        actions={
          <Button asChild variant="outline">
            <Link to="/team/scrims">
              <Search /> Find a scrim
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
            Upcoming
            {pending > 0 && <span className="ml-1 rounded-full bg-warning/20 px-1.5 text-[11px] font-bold text-warning-foreground dark:text-warning">{pending} waiting</span>}
          </TabsTrigger>
          <TabsTrigger value="past" className="px-5 text-sm">
            Past
          </TabsTrigger>
        </TabsList>
        <TabsContent value="upcoming" className="mt-5">
          <RegistrationList scope="upcoming" today={today} />
        </TabsContent>
        <TabsContent value="past" className="mt-5">
          <RegistrationList scope="past" today={today} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
