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
import { useT } from "@/i18n/core";
import { tHub } from "@/i18n/tournamentsHub";

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
  const th = useT(tHub);
  const steps = useMemo<TourStep[]>(
    () => [
      { element: '[data-tour="hero"]', title: th("tour_hero_title"), description: th("tour_hero_desc"), side: "bottom" },
      { element: '[data-tour="watch-live"]', title: th("tour_watch_title"), description: th("tour_watch_desc"), side: "bottom" },
      { element: '[data-tour="journey"]', title: th("tour_journey_title"), description: th("tour_journey_desc"), side: "bottom" },
      { element: '[data-tour="room-details"]', title: th("tour_room_title"), description: th("tour_room_desc"), side: "bottom" },
      { element: '[data-tour="stage-flow"]', title: th("tour_flow_title"), description: th("tour_flow_desc"), side: "bottom" },
      { element: '[data-tour="register"]', title: th("tour_register_title"), description: th("tour_register_desc"), side: "left" },
      { element: '[data-tour="on-fire"]', title: th("tour_fire_title"), description: th("tour_fire_desc"), side: "top" },
      { element: '[data-tour="format"]', title: th("tour_format_title"), description: th("tour_format_desc"), side: "top" },
    ],
    [th],
  );
  usePageTour("team.tournament", steps);
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
        <ArrowLeft /> {th("back_all")}
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
            title={th("not_found")}
            description={th("not_found_desc")}
            action={
              <Button asChild>
                <Link to="/team/tournaments">{th("see_all")}</Link>
              </Button>
            }
          />
        ) : (
          <QueryError error={q.error} onRetry={() => void q.refetch()} title={th("load_err")} />
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
              {th("road")}
            </h2>
            <span className="text-xs text-muted-foreground">{th("road_hint")}</span>
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

        {/* desktop: the side column takes exactly the height of the left boxes and scrolls inside it,
            so a long registration panel never stretches the grid */}
        <aside className={cn("contents lg:relative lg:col-start-2 lg:row-start-3 lg:block lg:min-h-[26rem]", stageQ.data ? "lg:row-span-3" : "lg:row-span-2")}>
          <div className="contents lg:absolute lg:inset-0 lg:flex lg:flex-col lg:gap-5 lg:overflow-y-auto lg:overscroll-contain lg:rounded-2xl lg:pr-1 lg:[scrollbar-gutter:stable] lg:[scrollbar-width:thin]">
            <div className="order-3 shrink-0 empty:hidden lg:order-none">
              <RegistrationPanel t={t} />
            </div>
            <div className="order-7 shrink-0 lg:order-none">
              <PointsLegend ps={t.pointsSystem} className="rounded-2xl" />
            </div>
            {t.rules && (
              <div className="order-8 shrink-0 lg:order-none">
                <RulesSection rules={t.rules} />
              </div>
            )}
          </div>
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
