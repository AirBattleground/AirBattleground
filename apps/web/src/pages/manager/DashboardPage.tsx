import { lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, CalendarPlus, Inbox, Plus } from "lucide-react";
import { APP_TIMEZONE } from "@7xen/shared";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { cn } from "@7xen/ui/lib/utils";
import { Button } from "@7xen/ui/components/ui/button";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { useAuth } from "@/lib/auth";
import { useSkin } from "@/lib/skin";
import { useDashboard } from "@/features/manager/api";
import { formatDate } from "@/features/manager/format";
import { QueryError } from "@/features/manager/components/QueryError";
import { SessionCard, SessionCardSkeleton } from "@/features/manager/components/SessionCard";
import { GetAppCard } from "@/features/live/components/GetAppCard";
import { OrgLogoCard } from "@/features/manager/components/BrandingCards";
import { Zone } from "@/features/manager/components/Zone";


/** Lux Battle only: the "control room" banner replaces the PageHeader (lazy, so Teal never loads it). */
const LuxManagerHero = lazy(() => import("@/skins/lux/pages/LuxManagerHero"));
const TOUR: TourStep[] = [
  { title: "Welcome to your control room", description: "This is where you run your scrims. Let's take a 20-second look around." },
  { element: '[data-tour="today"]', title: "Today's sessions", description: "Every scrim running today, how full it is, and a Manage button to handle its teams." },
  { element: '[data-tour="stat-pending"]', title: "Teams waiting for you", description: "When teams ask to join a scrim, they show up here. Tap Review to approve or reject them." },
  { element: '[data-tour="stats"]', title: "Your numbers at a glance", description: "Active scrims, teams already confirmed, and how many sessions run today." },
  { element: '[data-tour="get-app"]', title: "The Manager app", description: "Run match day from your Android phone — it records games, helps create the room and uploads screenshots for you." },
  { element: '[data-tour="org-logo"]', title: "Your organisation logo", description: "Upload your logo once — teams see it on every scrim and tournament you run." },
  { element: '[data-tour="new-scrim"]', title: "Create a scrim", description: "Set it up once — one-time, daily or weekends — and teams can start registering." },
];

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: APP_TIMEZONE }).format(new Date()));
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function DashboardPage() {
  usePageTour("manager.dashboard", TOUR);
  const { user } = useAuth();
  const { isLux } = useSkin();
  const q = useDashboard();
  const d = q.data;
  const firstName = user?.displayName.split(" ")[0] ?? "there";

  return (
    <>
      {isLux ? (
        <Suspense fallback={null}>
          <LuxManagerHero name={firstName} greeting={greeting()} data={d} />
        </Suspense>
      ) : (
        <PageHeader
          eyebrow={d ? formatDate(d.today) : "Dashboard"}
          title={`${greeting()}, ${firstName}`}
          actions={
            <Button asChild size="lg" data-tour="new-scrim">
              <Link to="/manager/scrims/new">
                <Plus /> New scrim
              </Link>
            </Button>
          }
        />
      )}

      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <Zone
            label="Today"
            data-tour="today"
            aside={
              <Button asChild variant="ghost" size="sm">
                <Link to="/manager/scrims">Full schedule →</Link>
              </Button>
            }
          >
            {!d ? (
              <div className="divide-y">
                <SessionCardSkeleton />
                <SessionCardSkeleton />
              </div>
            ) : d.todaySessions.length === 0 ? (
              d.activeScrims === 0 ? (
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
              ) : (
                <EmptyState
                  icon={<CalendarClock />}
                  title="Nothing running today"
                  description="Check the schedule for upcoming days."
                  action={
                    <Button asChild variant="outline">
                      <Link to="/manager/scrims">Open schedule</Link>
                    </Button>
                  }
                />
              )
            ) : (
              <div className="-my-3 divide-y">
                {[...d.todaySessions]
                  .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
                  .map((s) => (
                    <SessionCard key={s.scrim.id} session={s} />
                  ))}
              </div>
            )}
          </Zone>

          <div className="space-y-4">
            <Zone label="Needs you" data-tour="stat-pending" className={d && d.pendingCount > 0 ? "border-warning/50" : undefined}>
              {d ? (
                <div className="flex items-center gap-4">
                  <p className={cn("font-display text-5xl font-bold leading-none tabular-nums", d.pendingCount > 0 ? "text-warning-foreground dark:text-warning" : "text-muted-foreground")}>
                    {d.pendingCount}
                  </p>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{d.pendingCount === 1 ? "team waiting" : "teams waiting"}</p>
                    <p className="text-xs text-muted-foreground">{d.pendingCount > 0 ? "Approve or reject them" : "All caught up"}</p>
                  </div>
                  <Button asChild variant={d.pendingCount > 0 ? "default" : "outline"} className="h-10">
                    <Link to="/manager/requests">
                      <Inbox /> Review
                    </Link>
                  </Button>
                </div>
              ) : (
                <Skeleton className="h-12" />
              )}
            </Zone>

            <Zone label="At a glance" data-tour="stats">
              {d ? (
                <dl className="divide-y text-sm">
                  <Fact label="Active scrims" value={d.activeScrims} />
                  <Fact label="Teams confirmed (upcoming)" value={d.upcomingApproved} />
                  <Fact label="Sessions today" value={d.todaySessions.length} />
                </dl>
              ) : (
                <Skeleton className="h-24" />
              )}
            </Zone>

            <div className="empty:hidden">
              <GetAppCard />
            </div>
            <OrgLogoCard tour="org-logo" />
          </div>
        </div>
      )}
    </>
  );
}

function Fact({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-display text-xl font-bold tabular-nums">{value}</dd>
    </div>
  );
}
