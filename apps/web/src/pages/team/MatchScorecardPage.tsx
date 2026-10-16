import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Lock } from "lucide-react";
import { format, parseISO } from "date-fns";
import { ApiError } from "@7xen/shared";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/features/team/format";
import { MapChip } from "@/features/team/components/MapChips";
import { QueryError } from "@/features/team/components/QueryError";
import { useTeamScorecard } from "@/features/results/api";
import { ordinal } from "@/features/results/components/Rank";
import { ScorecardList } from "@/features/results/components/Scorecard";

const STEPS: TourStep[] = [
  { title: "Match scorecard", description: "Every team's result in this match. Your team is highlighted." },
  { element: '[data-tour="scorecard-mine"]', title: "Your match", description: "Your rank, finishes and the points you earned." },
  { element: '[data-tour="scorecard-list"]', title: "All teams", description: "Rank, slot, players with their finishes, and points (placement + finishes)." },
];

export default function MatchScorecardPage() {
  usePageTour("team.scorecard", STEPS);
  const { scrimId = "", date = "", matchId } = useParams();
  const { user } = useAuth();
  const q = useTeamScorecard(matchId);
  const s = q.data;
  const mine = s?.teams.find((t) => t.team.id === user?.team?.id);

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
        <Link to={`/team/results/${scrimId}/${date}`}>
          <ArrowLeft /> Points table
        </Link>
      </Button>
      <PageHeader
        eyebrow={s ? `${s.scrim.title} · ${formatDate(s.date)}` : "Scorecard"}
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
          <EmptyState
            icon={<Lock />}
            title="This scorecard isn't available"
            description="It may have been unpublished by the organiser while they fix something. Check back soon."
          />
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
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Your team</p>
                  <p className="font-display text-4xl font-bold">
                    {mine.rank === 1 ? "Winner winner!" : `${ordinal(mine.rank)} place`}
                  </p>
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
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={big ? "font-display text-4xl font-bold text-primary" : "font-display text-3xl font-bold"}>{value}</p>
    </div>
  );
}
