import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Route, SearchX } from "lucide-react";
import { ApiError, type TeamTournamentDetail } from "@7xen/shared";
import { EmptyState } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { cn } from "@7xen/ui/lib/utils";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { useAuth } from "@/lib/auth";
import { PointsLegend } from "@/features/results/components/Standings";
import { QueryError } from "@/features/team/components/QueryError";
import { StageFlow, StageFlowSkeleton } from "@/features/tournaments/shared/StageFlow";
import { useTeamStage, useTeamTournament } from "@/features/tournaments/team/api";
import { FormatSummary, OnFire, RulesSection, TournamentHero } from "@/features/tournaments/team/components/HubSections";
import { JourneyCard } from "@/features/tournaments/team/components/JourneyCard";
import { RegistrationPanel } from "@/features/tournaments/team/components/RegistrationPanel";
import { youFromMe } from "@/features/tournaments/team/journey";
import { TeamLiveCards } from "@/features/station/components/TeamLiveCard";

const STEPS: TourStep[] = [
  { element: '[data-tour="hero"]', title: "The tournament", description: "Prize, dates, organiser and how many teams have registered so far.", side: "bottom" },
  { element: '[data-tour="watch-live"]', title: "Watch live", description: "When your match in this tournament is being streamed, tap here to watch it live.", side: "bottom" },
  { element: '[data-tour="journey"]', title: "Your journey", description: "Where your team stands right now, your next goal and a countdown to your next match.", side: "bottom" },
  { element: '[data-tour="room-details"]', title: "Room details", description: "The room ID and password for your next match show up here before it starts — tap to copy.", side: "bottom" },
  { element: '[data-tour="stage-flow"]', title: "The road to the trophy", description: "Every stage from registration to the final. The glowing stage is happening now and the YOU marker shows where your team is. Tap a stage for groups, schedule and live standings.", side: "bottom" },
  { element: '[data-tour="register"]', title: "Register", description: "First come, first served. Pick the time slots you can play (or “Any time works”) and register. When registration is closed, you'll see why here.", side: "left" },
  { element: '[data-tour="on-fire"]', title: "Who's on fire", description: "The teams scoring the most points per match and the players with the most finishes.", side: "top" },
  { element: '[data-tour="format"]', title: "Format", description: "How many teams play each stage, how many go through, and which maps are played. Tap a stage for more.", side: "top" },
];

function HubSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-52 rounded-2xl" />
      <div className="rounded-2xl border bg-card p-5">
        <StageFlowSkeleton />
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <Skeleton className="h-48 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    </div>
  );
}

/** The stage worth showcasing: the live one, else the latest completed one. */
function featuredStage(t: TeamTournamentDetail) {
  return t.stages.find((s) => s.status === "LIVE") ?? [...t.stages].reverse().find((s) => s.status === "COMPLETED") ?? null;
}

export default function TournamentHubPage() {
  usePageTour("team.tournament", STEPS);
  const { id = "" } = useParams();
  const { user } = useAuth();
  const q = useTeamTournament(id);
  const t = q.data;
  const featured = t ? featuredStage(t) : null;
  const stageQ = useTeamStage(featured ? id : undefined, featured?.id);
  const you = useMemo(() => (t ? youFromMe(t.me, user?.team, t) : null), [t, user?.team]);

  const back = (
    <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
      <Link to="/team/tournaments">
        <ArrowLeft /> All tournaments
      </Link>
    </Button>
  );

  if (q.isError)
    return (
      <>
        {back}
        {q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 403) ? (
          <EmptyState
            icon={<SearchX />}
            title="Tournament not found"
            description="It may have been removed or isn't published yet."
            action={
              <Button asChild>
                <Link to="/team/tournaments">See all tournaments</Link>
              </Button>
            }
          />
        ) : (
          <QueryError error={q.error} onRetry={() => void q.refetch()} title="Couldn't load this tournament" />
        )}
      </>
    );

  if (!t)
    return (
      <>
        {back}
        <HubSkeleton />
      </>
    );

  const regOpen = t.status === "REGISTRATION_OPEN";
  return (
    <>
      {back}
      <div className={cn("grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]", stageQ.data ? "lg:grid-rows-[auto_auto_auto_auto_1fr]" : "lg:grid-rows-[auto_auto_auto_1fr]")}>
        <div className="order-1 lg:col-span-2 lg:row-start-1">
          <TournamentHero t={t} />
        </div>

        <section
          data-tour="stage-flow"
          aria-labelledby="flow-title"
          className="order-4 rounded-2xl border bg-card p-4 shadow-sm sm:p-5 lg:col-span-2 lg:row-start-2"
        >
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Route className="size-5 text-primary" />
            <h2 id="flow-title" className="font-display text-xl font-bold">
              Road to the trophy
            </h2>
            <span className="text-xs text-muted-foreground">Tap a stage for groups, schedule and standings</span>
          </div>
          <StageFlow
            stages={t.stages}
            registration={{ open: regOpen, confirmed: t.confirmedCount, max: t.maxTeams }}
            champion={t.champion}
            you={you}
            stageHref={(s) => `/team/tournaments/${t.id}/stages/${s.id}`}
          />
        </section>

        <div className="order-2 space-y-5 lg:col-start-1 lg:row-start-3">
          {/* TeamLiveCard has no tournamentId — match by the next match or the tournament title */}
          <TeamLiveCards filter={(c) => c.matchId === t.me.nextMatch?.matchId || c.title === t.title} />
          <JourneyCard t={t} />
        </div>

        <aside className={cn("contents lg:col-start-2 lg:row-start-3 lg:flex lg:flex-col lg:gap-5", stageQ.data ? "lg:row-span-3" : "lg:row-span-2")}>
          <div className="order-3 empty:hidden lg:order-none">
            <RegistrationPanel t={t} />
          </div>
          <div className="order-7 lg:order-none">
            <PointsLegend ps={t.pointsSystem} className="rounded-2xl" />
          </div>
          {t.rules && (
            <div className="order-8 lg:order-none">
              <RulesSection rules={t.rules} />
            </div>
          )}
        </aside>

        {stageQ.data && (
          <div className="order-5 empty:hidden lg:col-start-1 lg:row-start-4">
            <OnFire stage={stageQ.data} href={`/team/tournaments/${t.id}/stages/${stageQ.data.stage.id}`} />
          </div>
        )}

        <div className={cn("order-6 lg:col-start-1", stageQ.data ? "lg:row-start-5" : "lg:row-start-4")}>
          <FormatSummary t={t} />
        </div>
      </div>
    </>
  );
}
