import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, SearchX } from "lucide-react";
import { ApiError, type TeamTournamentDetail } from "@7xen/shared";
import { EmptyState } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { useAuth } from "@/lib/auth";
import { QueryError } from "@/features/team/components/QueryError";
import { StageFlow, StageFlowSkeleton } from "@/features/tournaments/shared/StageFlow";
import { useTeamStage, useTeamTournament } from "@/features/tournaments/team/api";
import { DetailsTabs, OnFire, PanelTitle, PosterWash, TournamentHero } from "@/features/tournaments/team/components/HubSections";
import { JourneyCard } from "@/features/tournaments/team/components/JourneyCard";
import { RegistrationPanel } from "@/features/tournaments/team/components/RegistrationPanel";
import { youFromMe } from "@/features/tournaments/team/journey";
import { TeamLiveCards } from "@/features/station/components/TeamLiveCard";
import { useT } from "@/i18n/core";
import { tHub } from "@/i18n/tournamentsHub";

function HubSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-60 rounded-2xl" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="rounded-2xl border bg-card p-5 lg:col-start-1 lg:row-start-1">
          <StageFlowSkeleton />
        </div>
        <Skeleton className="h-72 rounded-2xl lg:col-start-2 lg:row-start-1" />
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
  // teams that aren't in: the registration panel is their status + action, the journey card would repeat it
  const inIt = t.me.state !== "NOT_REGISTERED" && t.me.state !== "WITHDRAWN";
  const stageHref = (s: { id: string }) => `/team/tournaments/${t.id}/stages/${s.id}`;
  return (
    <>
      {/* the hero carries the back link + share; its poster runs up under the header */}
      <div className="space-y-6">
        <TournamentHero t={t} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-start">
          {/* right zone (first on phones): your status + the one action */}
          <aside className="space-y-4 lg:col-start-2 lg:row-start-1" aria-label={th("zone_you")}>
            {inIt && <JourneyCard t={t} />}
            <RegistrationPanel t={t} />
          </aside>

          {/* main zone: what's happening in the tournament */}
          <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">
            {/* TeamLiveCard has no tournamentId — match by the next match or the tournament title */}
            <TeamLiveCards filter={(c) => c.matchId === t.me.nextMatch?.matchId || c.title === t.title} />

            <section data-tour="stage-flow" aria-labelledby="flow-title" className="relative isolate overflow-hidden rounded-2xl border bg-card p-4 shadow-sm sm:p-6">
              <PosterWash url={t.posterUrl} className="-z-10 opacity-10 dark:opacity-15" />
              <PanelTitle id="flow-title" desc={th("journey_desc")} className="mb-5 lg:mb-1">
                {th("road")}
              </PanelTitle>
              <StageFlow
                stages={t.stages}
                registration={{ open: regOpen, confirmed: t.confirmedCount, max: t.maxTeams }}
                champion={t.champion}
                you={you}
                stageHref={stageHref}
              />
            </section>

            {stageQ.data && <OnFire stage={stageQ.data} limit={3} href={stageHref(stageQ.data.stage)} />}

            <DetailsTabs t={t} />
          </div>
        </div>
      </div>
    </>
  );
}
