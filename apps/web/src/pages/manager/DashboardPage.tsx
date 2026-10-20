import { lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, CalendarPlus, Inbox, Plus, Swords, Users } from "lucide-react";
import { APP_TIMEZONE } from "@7xen/shared";
import { EmptyState, PageHeader, StatCard } from "@7xen/ui/components/brand/page";
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


/** Lux Battle only: the "control room" banner replaces the PageHeader (lazy, so Teal never loads it). */
const LuxManagerHero = lazy(() => import("@/skins/lux/pages/LuxManagerHero"));
const TOUR: TourStep[] = [
  { title: "Welcome to your control room", description: "This is where you run your scrims. Let's take a 20-second look around." },
  { element: '[data-tour="stat-pending"]', title: "Teams waiting for you", description: "When teams ask to join a scrim, they show up here. Click it to approve or reject them." },
  { element: '[data-tour="stats"]', title: "Your numbers at a glance", description: "Active scrims, teams already confirmed, and how many sessions run today." },
  { element: '[data-tour="today"]', title: "Today's sessions", description: "Every scrim running today, how full it is, and a Manage button to handle its teams." },
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
          description={
            d
              ? d.pendingCount > 0
                ? `${d.pendingCount} team${d.pendingCount === 1 ? " is" : "s are"} waiting for your approval.`
                : "No teams waiting right now. Here's what's happening today."
              : "Here's what's happening with your scrims today."
          }
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
        <>
          <div data-tour="stats" className="grid grid-cols-2 gap-3 lg:grid-cols-4 sm:gap-4">
            {d ? (
              <>
                <Link to="/manager/requests" data-tour="stat-pending" className="rounded-xl focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
                  <StatCard
                    label="Waiting approval"
                    value={d.pendingCount}
                    tone="warning"
                    icon={<Inbox />}
                    hint={d.pendingCount > 0 ? "Tap to review →" : "All caught up"}
                    className={d.pendingCount > 0 ? "border-warning/50" : undefined}
                  />
                </Link>
                <StatCard label="Active scrims" value={d.activeScrims} tone="brand" icon={<Swords />} hint="Open for registrations" />
                <StatCard label="Teams confirmed" value={d.upcomingApproved} tone="success" icon={<Users />} hint="Approved, upcoming" />
                <StatCard label="Today's sessions" value={d.todaySessions.length} tone="info" icon={<CalendarClock />} hint={formatDate(d.today)} />
              </>
            ) : (
              Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[124px] rounded-xl" />)
            )}
          </div>

          <div className="mt-6 empty:hidden">
            <GetAppCard />
          </div>

          <section data-tour="today" className="mt-8">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl font-bold">Today</h2>
                <p className="text-sm text-muted-foreground">Sessions running today, in start-time order.</p>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link to="/manager/scrims">See full schedule →</Link>
              </Button>
            </div>

            {!d ? (
              <div className="space-y-3">
                <SessionCardSkeleton />
                <SessionCardSkeleton />
              </div>
            ) : d.todaySessions.length === 0 ? (
              d.activeScrims === 0 ? (
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
              ) : (
                <EmptyState
                  icon={<CalendarClock />}
                  title="Nothing running today"
                  description="None of your scrims run today. Check the schedule for upcoming days, or set up a new one."
                  action={
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button asChild variant="outline">
                        <Link to="/manager/scrims">Open schedule</Link>
                      </Button>
                      <Button asChild>
                        <Link to="/manager/scrims/new">
                          <Plus /> New scrim
                        </Link>
                      </Button>
                    </div>
                  }
                />
              )
            ) : (
              <ol className="relative space-y-3 border-l-2 border-dashed border-border pl-5 sm:pl-6">
                {[...d.todaySessions]
                  .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
                  .map((s) => (
                    <li key={s.scrim.id} className="relative animate-rise">
                      <span className="absolute top-7 -left-[29px] size-3 rounded-full border-2 border-background bg-primary shadow-glow sm:-left-[33px]" />
                      <SessionCard session={s} />
                    </li>
                  ))}
              </ol>
            )}
          </section>

          <div className="mt-8 max-w-2xl">
            <OrgLogoCard tour="org-logo" />
          </div>
        </>
      )}
    </>
  );
}
