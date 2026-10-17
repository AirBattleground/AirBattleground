import { Link } from "react-router-dom";
import { ArrowRight, CalendarCheck, Hourglass, Search, Trophy } from "lucide-react";
import { todayInAppTz, type TeamRegistration } from "@7xen/shared";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { EmptyState, PageHeader, StatCard } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { useAuth } from "@/lib/auth";
import { useTeamDashboard } from "@/features/team/api";
import { NextMatchCard, NextMatchSkeleton } from "@/features/team/components/NextMatchCard";
import { QueryError } from "@/features/team/components/QueryError";
import { RegistrationCard, RegistrationCardSkeleton } from "@/features/team/components/RegistrationCard";
import { StaggerItem, StaggerList } from "@/features/team/components/Stagger";
import { LastResultCard } from "@/features/results/components/LastResultCard";
import { TournamentsHomeCard } from "@/features/tournaments/team/components/TournamentsHomeCard";
import { NextRoomCard } from "@/features/live/components/TeamRoom";

const STEPS: TourStep[] = [
  { title: "Welcome to 7xen!", description: "This is your team's home. Here's a quick look around — it takes 20 seconds." },
  { element: '[data-tour="next-match"]', title: "Your next match", description: "Once an organiser approves you, your slot number, time and maps show up here with a live countdown.", side: "bottom" },
  { element: '[data-tour="next-room"]', title: "Room ID & password", description: "Before each match the room ID and password appear here, with copy buttons. Until then it shows when they'll appear.", side: "bottom" },
  { element: '[data-tour="home-tournaments"]', title: "Tournaments", description: "Your next tournament match, or an open tournament you can join. Tap it for the full details.", side: "bottom" },
  { element: '[data-tour="last-result"]', title: "Your last result", description: "Your rank and points from the latest published scrim. Tap it for the full points table.", side: "bottom" },
  { element: '[data-tour="stats"]', title: "Your numbers", description: "Approved matches, requests still waiting for approval, and matches you've played.", side: "top" },
  { element: '[data-tour="upcoming"]', title: "Everything coming up", description: "All your upcoming scrims with their status — waiting or approved with a slot.", side: "top" },
  { element: '[data-tour="find-scrim"]', title: "Find a scrim", description: "Tap here to browse scrims by day and register your team.", side: "bottom" },
];

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(new Date()));
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function DashboardPage() {
  usePageTour("team.dashboard", STEPS);
  const { user } = useAuth();
  const q = useTeamDashboard();
  const d = q.data;
  const team = d?.team ?? user?.team ?? null;
  const today = d?.today ?? todayInAppTz();
  const upcoming: TeamRegistration[] = d ? d.upcoming.filter((r) => r.id !== d.nextMatch?.id) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={greeting()}
        title={
          <span className="flex items-center gap-3">
            {team && <TeamAvatar name={team.name} tag={team.tag} size="lg" />}
            <span className="min-w-0">
              <span className="block truncate">{team?.name ?? user?.displayName ?? "Your team"}</span>
              {team && <span className="block text-sm font-semibold tracking-[0.25em] text-muted-foreground">[{team.tag}]</span>}
            </span>
          </span>
        }
        actions={
          <Button asChild size="lg" className="h-11" data-tour="find-scrim">
            <Link to="/team/scrims">
              <Search /> Find a scrim
            </Link>
          </Button>
        }
        className="mb-0"
      />

      {q.isError && !d ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} title="Couldn't load your dashboard" />
      ) : (
        <>
          {q.isLoading || !d ? <NextMatchSkeleton /> : <NextMatchCard match={d.nextMatch} today={today} />}

          <NextRoomCard />

          <TournamentsHomeCard />

          <LastResultCard results={d?.results ?? null} loading={q.isLoading || !d} />

          <div className="grid gap-4 sm:grid-cols-3" data-tour="stats">
            <StatCard
              label="Approved upcoming"
              value={d ? d.counts.approvedUpcoming : <span className="inline-block h-9 w-10 animate-pulse rounded bg-muted" />}
              icon={<CalendarCheck />}
              tone="success"
              hint="Matches you have a slot in"
            />
            <StatCard
              label="Waiting for approval"
              value={d ? d.counts.pending : <span className="inline-block h-9 w-10 animate-pulse rounded bg-muted" />}
              icon={<Hourglass />}
              tone="warning"
              hint="Organiser hasn't decided yet"
            />
            <StatCard
              label="Matches played"
              value={d ? d.counts.totalPlayed : <span className="inline-block h-9 w-10 animate-pulse rounded bg-muted" />}
              icon={<Trophy />}
              tone="brand"
              hint="All time on 7xen"
            />
          </div>

          <section className="space-y-3" data-tour="upcoming">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-2xl font-bold">Upcoming</h2>
              <Button asChild variant="ghost" size="sm">
                <Link to="/team/registrations">
                  See all <ArrowRight />
                </Link>
              </Button>
            </div>
            {q.isLoading || !d ? (
              <div className="space-y-3">
                <RegistrationCardSkeleton />
                <RegistrationCardSkeleton />
              </div>
            ) : upcoming.length === 0 ? (
              <EmptyState
                icon={<CalendarCheck />}
                title={d.nextMatch ? "Nothing else booked" : "No upcoming scrims"}
                description="Register for more scrims to fill up your week."
                action={
                  <Button asChild>
                    <Link to="/team/scrims">Browse scrims</Link>
                  </Button>
                }
                className="py-10"
              />
            ) : (
              <StaggerList className="space-y-3">
                {upcoming.slice(0, 6).map((r) => (
                  <StaggerItem key={r.id}>
                    <RegistrationCard reg={r} today={today} showDate compact cancellable={false} />
                  </StaggerItem>
                ))}
              </StaggerList>
            )}
          </section>
        </>
      )}
    </div>
  );
}
