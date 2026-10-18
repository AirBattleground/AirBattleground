import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { ArrowRight, CalendarCheck, Hourglass, Search, Trophy } from "lucide-react";
import { todayInAppTz, type TeamRegistration } from "@7xen/shared";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { PageHeader } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { cn } from "@7xen/ui/lib/utils";
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
import { TeamLiveCards } from "@/features/station/components/TeamLiveCard";

const STEPS: TourStep[] = [
  { title: "Welcome to AirBattleground!", description: "This is your team's home. Here's a quick look around — it takes 20 seconds." },
  { element: '[data-tour="watch-live"]', title: "Watch live", description: "When one of your matches is being streamed, it shows up right here. Tap it to watch the game live.", side: "bottom" },
  { element: '[data-tour="next-match"]', title: "Your next match", description: "Once an organiser approves you, your slot number, time and maps show up here with a live countdown.", side: "bottom" },
  { element: '[data-tour="next-room"]', title: "Room ID & password", description: "Before each match the room ID and password appear here, with copy buttons. Until then it shows when they'll appear.", side: "bottom" },
  { element: '[data-tour="home-tournaments"]', title: "Tournaments", description: "Your next tournament match, or an open tournament you can join. Tap it for the full details.", side: "bottom" },
  { element: '[data-tour="last-result"]', title: "Your last result", description: "Your rank and points from the latest published scrim. Tap it for the full points table.", side: "bottom" },
  { element: '[data-tour="stats"]', title: "Your numbers", description: "Approved matches, requests still waiting for approval, and matches you've played.", side: "top" },
  { element: '[data-tour="upcoming"]', title: "Everything coming up", description: "All your upcoming scrims with their status — waiting or approved with a slot.", side: "top" },
  { element: '[data-tour="find-scrim"]', title: "Find a scrim", description: "Tap here to browse scrims by day and register your team.", side: "bottom" },
];

const STAT_TONES = { success: "bg-success/10 text-success", warning: "bg-warning/15 text-warning-foreground dark:text-warning", brand: "bg-primary/10 text-primary" };

/** One card, three numbers: side by side on every screen so phones don't scroll past three tall boxes. */
function StatStrip({ items }: { items: { label: string; hint: string; value: number | null; icon: ReactNode; tone: keyof typeof STAT_TONES }[] }) {
  return (
    <div className="grid grid-cols-3 divide-x overflow-hidden rounded-2xl border bg-card shadow-sm" data-tour="stats">
      {items.map((s) => (
        <div key={s.label} className="flex min-w-0 flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4 sm:p-6">
          <span className={cn("hidden size-12 shrink-0 items-center justify-center rounded-2xl sm:flex [&_svg]:size-6", STAT_TONES[s.tone])}>{s.icon}</span>
          <div className="min-w-0">
            <p className="font-display text-3xl leading-none font-bold tabular-nums sm:text-4xl">
              {s.value ?? <span className="inline-block h-8 w-8 animate-pulse rounded bg-muted align-middle" />}
            </p>
            <p className="mt-1.5 text-xs leading-snug font-semibold text-foreground sm:text-sm">{s.label}</p>
            <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block">{s.hint}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

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

  const loading = q.isLoading || !d;
  const booked = !!d?.nextMatch;

  return (
    <div className="flex flex-col gap-6">
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
          // with nothing booked, the "No match booked yet" card owns the one Find-a-scrim button
          booked && (
            <Button asChild size="lg" className="h-11" data-tour="find-scrim">
              <Link to="/team/scrims">
                <Search /> Find a scrim
              </Link>
            </Button>
          )
        }
        className="mb-0"
      />

      <TeamLiveCards />

      {q.isError && !d ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} title="Couldn't load your dashboard" />
      ) : (
        <>
          {loading ? <NextMatchSkeleton /> : <NextMatchCard match={d.nextMatch} today={today} />}

          <NextRoomCard />

          <TournamentsHomeCard />

          <LastResultCard results={d?.results ?? null} loading={loading} />

          <StatStrip
            items={[
              { label: "Approved upcoming", hint: "Matches you have a slot in", value: d?.counts.approvedUpcoming ?? null, icon: <CalendarCheck />, tone: "success" },
              { label: "Waiting for approval", hint: "Organiser hasn't decided yet", value: d?.counts.pending ?? null, icon: <Hourglass />, tone: "warning" },
              { label: "Matches played", hint: "All time", value: d?.counts.totalPlayed ?? null, icon: <Trophy />, tone: "brand" },
            ]}
          />

          {/* Upcoming only earns its space when there's something in it, or to say "nothing else" under a booked match */}
          {(loading || booked || upcoming.length > 0) && (
            <section className="space-y-3" data-tour="upcoming">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-2xl font-bold">Upcoming</h2>
                {upcoming.length > 0 && (
                  <Button asChild variant="ghost" size="sm">
                    <Link to="/team/registrations">
                      See all <ArrowRight />
                    </Link>
                  </Button>
                )}
              </div>
              {loading ? (
                <div className="space-y-3">
                  <RegistrationCardSkeleton />
                  <RegistrationCardSkeleton />
                </div>
              ) : upcoming.length === 0 ? (
                <p className="flex items-center gap-3 rounded-2xl border border-dashed px-5 py-4 text-sm text-muted-foreground">
                  <CalendarCheck className="size-5 shrink-0 text-primary" />
                  Nothing else booked yet. Use <span className="font-medium text-foreground">Find a scrim</span> to fill up your week.
                </p>
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
          )}
        </>
      )}
    </div>
  );
}
