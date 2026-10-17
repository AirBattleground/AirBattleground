import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Lock } from "lucide-react";
import { format, parseISO } from "date-fns";
import { ApiError } from "@7xen/shared";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { useAuth } from "@/lib/auth";
import { useTeamScorecard } from "@/features/results/api";
import { ordinal } from "@/features/results/components/Rank";
import { ScorecardList } from "@/features/results/components/Scorecard";
import { MapChip } from "@/features/team/components/MapChips";
import { QueryError } from "@/features/team/components/QueryError";

const STEPS: TourStep[] = [
  { title: "Match scorecard", description: "Every team's result in this tournament match. Your team is highlighted if you played it." },
  { element: '[data-tour="scorecard-mine"]', title: "Your match", description: "Your rank, finishes and the points you earned." },
  { element: '[data-tour="scorecard-list"]', title: "All teams", description: "Rank, slot, players with their finishes, and points (placement + finishes)." },
];

/** Scorecard for a tournament group match (same data and components as scrim scorecards; back link goes to the stage). */
export default function TournamentMatchPage() {
  usePageTour("team.tournament-scorecard", STEPS);
  const { id = "", matchId } = useParams();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const q = useTeamScorecard(matchId);
  const s = q.data;
  const tc = s?.tournament;
  const stageId = params.get("stage") ?? tc?.stageId ?? null;
  const mine = s?.teams.find((t) => t.team.id === user?.team?.id);
  const backTo = stageId ? `/team/tournaments/${id}/stages/${stageId}?tab=matches` : `/team/tournaments/${id}`;

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
        <Link to={backTo}>
          <ArrowLeft /> {stageId ? "Back to the stage" : "Back to the tournament"}
        </Link>
      </Button>
      <PageHeader
        eyebrow={tc ? `${tc.title} · ${tc.stageName} · Group ${tc.groupName}` : s ? s.scrim.title : "Scorecard"}
        title={
          s ? (
            <span className="flex flex-wrap items-center gap-3">
              Match {s.match.number} <MapChip map={s.match.map} className="text-sm" />
            </span>
          ) : (
            "Scorecard"
          )
        }
        description={s ? `Published ${format(parseISO(s.match.publishedAt), "d MMM, h:mm a")}` : undefined}
      />
      {q.isError ? (
        q.error instanceof ApiError && (q.error.status === 403 || q.error.status === 404) ? (
          <EmptyState icon={<Lock />} title="This scorecard isn't available yet" description="Results show up here as soon as the organiser publishes them." />
        ) : (
          <QueryError error={q.error} onRetry={() => void q.refetch()} title="Couldn't load the scorecard" />
        )
      ) : !s ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-5">
          {mine && (
            <div data-tour="scorecard-mine" className="relative overflow-hidden rounded-2xl border border-primary/40 bg-card p-5 shadow-glow">
              <div className="pointer-events-none absolute inset-0 bg-grid opacity-50" />
              <div className="relative flex flex-wrap items-center gap-x-8 gap-y-3">
                <div>
                  <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">Your team</p>
                  <p className="font-display text-4xl font-bold">{mine.rank === 1 ? "Winner winner!" : `${ordinal(mine.rank)} place`}</p>
                </div>
                <Stat label="Finishes" value={mine.kills} />
                <Stat label="Placement pts" value={mine.placementPoints} />
                <Stat label="Finish pts" value={mine.killPoints} />
                <Stat label="Total" value={mine.totalPoints} big />
              </div>
            </div>
          )}
          <ScorecardList teams={s.teams} highlightTeamId={user?.team?.id} />
        </div>
      )}
    </>
  );
}

function Stat({ label, value, big }: { label: string; value: number; big?: boolean }) {
  return (
    <div>
      <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{label}</p>
      <p className={big ? "font-display text-4xl font-bold text-primary" : "font-display text-3xl font-bold"}>{value}</p>
    </div>
  );
}
