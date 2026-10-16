import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Lock } from "lucide-react";
import { ApiError } from "@7xen/shared";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { cn } from "@7xen/ui/lib/utils";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { useAuth } from "@/lib/auth";
import { formatDate, formatTime } from "@/features/team/format";
import { MapChip } from "@/features/team/components/MapChips";
import { QueryError } from "@/features/team/components/QueryError";
import { useTeamStandings } from "@/features/results/api";
import { MatchStatusPill } from "@/features/matches/components/MatchStatusPill";
import { PointsLegend, StandingsBoard, StandingsSkeleton, StandingsSummary } from "@/features/results/components/Standings";

const STEPS: TourStep[] = [
  { title: "Session points table", description: "How every team did in this session. Your team is highlighted." },
  { element: '[data-tour="standings-table"]', title: "Rankings", description: "Points per match, chicken dinners, finishes and total points." },
  { element: '[data-tour="session-matches"]', title: "Match scorecards", description: "Open any published match to see every team's rank, players and finishes." },
  { element: '[data-tour="standings-copy"]', title: "Share it", description: "Copy the table and paste it into your team chat." },
];

export default function SessionResultsPage() {
  usePageTour("team.sessionResults", STEPS);
  const { scrimId = "", date = "" } = useParams();
  const { user } = useAuth();
  const q = useTeamStandings(scrimId, date);
  const s = q.data;

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
        <Link to="/team/results">
          <ArrowLeft /> All results
        </Link>
      </Button>
      <PageHeader
        eyebrow={s ? `${formatDate(s.date)} · ${formatTime(s.scrim.startTime)} IST` : "Points table"}
        title={s?.scrim.title ?? "Points table"}
      />
      {q.isError ? (
        q.error instanceof ApiError && (q.error.status === 403 || q.error.status === 404) ? (
          <EmptyState
            icon={<Lock />}
            title="This points table isn't available"
            description="You can only see results for sessions your team played in."
            action={
              <Button asChild>
                <Link to="/team/results">Back to your results</Link>
              </Button>
            }
          />
        ) : (
          <QueryError error={q.error} onRetry={() => void q.refetch()} title="Couldn't load the points table" />
        )
      ) : !s ? (
        <StandingsSkeleton />
      ) : (
        <div className="space-y-5">
          <StandingsSummary standings={s} />
          <StandingsBoard
            standings={s}
            highlightTeamId={user?.team?.id}
            matchHref={(m) => (m.status === "PUBLISHED" ? `/team/results/${scrimId}/${date}/matches/${m.id}` : undefined)}
          />
          <section data-tour="session-matches" className="space-y-2">
            <h2 className="font-display text-xl font-bold">Match scorecards</h2>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {s.matches.map((m) => {
                const open = m.status === "PUBLISHED";
                const inner = (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display text-xl font-bold">Match {m.number}</span>
                      {open ? <ArrowRight className="size-4 text-primary" /> : <MatchStatusPill status={m.status} className="text-[10px]" />}
                    </div>
                    <MapChip map={m.map} className="self-start" />
                  </>
                );
                return (
                  <li key={m.id}>
                    {open ? (
                      <Link
                        to={`/team/results/${scrimId}/${date}/matches/${m.id}`}
                        className="flex h-full flex-col gap-2 rounded-xl border bg-card p-3 shadow-sm outline-none transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-glow focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      >
                        {inner}
                      </Link>
                    ) : (
                      <div className={cn("flex h-full flex-col gap-2 rounded-xl border border-dashed p-3 opacity-70")} title="Results not published yet">
                        {inner}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
          <PointsLegend ps={s.pointsSystem} />
        </div>
      )}
    </>
  );
}
