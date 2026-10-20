import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Lock } from "lucide-react";
import { ApiError } from "@7xen/shared";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { useAuth } from "@/lib/auth";
import { useTeamScorecard } from "@/features/results/api";
import { ScorecardList } from "@/features/results/components/Scorecard";
import { MapChip } from "@/features/team/components/MapChips";
import { QueryError } from "@/features/team/components/QueryError";
import { useMemo } from "react";
import { useDateFormat, useT } from "@/i18n/core";
import { ordFor, tShared } from "@/i18n/tournaments";
import { tStage } from "@/i18n/tournamentsHub";

/** Scorecard for a tournament group match (same data and components as scrim scorecards; back link goes to the stage). */
export default function TournamentMatchPage() {
  const ts = useT(tStage);
  const tsh = useT(tShared);
  const fmt = useDateFormat();
  const steps = useMemo<TourStep[]>(
    () => [
      { title: ts("sc_tour_title"), description: ts("sc_tour_desc") },
      { element: '[data-tour="scorecard-mine"]', title: ts("sc_tour_mine_title"), description: ts("sc_tour_mine_desc") },
      { element: '[data-tour="scorecard-list"]', title: ts("sc_tour_list_title"), description: ts("sc_tour_list_desc") },
    ],
    [ts],
  );
  usePageTour("team.tournament-scorecard", steps);
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
          <ArrowLeft /> {stageId ? ts("back_stage") : ts("back_tournament")}
        </Link>
      </Button>
      <PageHeader
        eyebrow={tc ? `${tc.title} · ${tc.stageName} · ${tsh("group_name", { name: tc.groupName })}` : s ? s.scrim.title : ts("scorecard")}
        title={
          s ? (
            <span className="flex flex-wrap items-center gap-3">
              {ts("match_n", { n: s.match.number })} <MapChip map={s.match.map} className="text-sm" />
            </span>
          ) : (
            ts("scorecard")
          )
        }
        description={s ? ts("published", { when: fmt(s.match.publishedAt, "d MMM, h:mm a") }) : undefined}
      />
      {q.isError ? (
        q.error instanceof ApiError && (q.error.status === 403 || q.error.status === 404) ? (
          <EmptyState icon={<Lock />} title={ts("sc_unavailable")} description={ts("sc_unavailable_desc")} />
        ) : (
          <QueryError error={q.error} onRetry={() => void q.refetch()} title={ts("sc_err")} />
        )
      ) : !s ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {mine && (
            <div data-tour="scorecard-mine" className="rounded-2xl border border-primary/40 bg-card p-4 shadow-glow sm:p-5">
              <p className="text-[11px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">{ts("your_team")}</p>
              <div className="mt-1 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <p className="font-display text-4xl leading-none font-bold">{mine.rank === 1 ? ts("winner_winner") : ts("place", { rank: ordFor(ts.lang, mine.rank) })}</p>
                <dl className="grid grid-cols-4 gap-3 sm:gap-6">
                  <Stat label={ts("finishes")} value={mine.kills} />
                  <Stat label={ts("placement_pts")} value={mine.placementPoints} />
                  <Stat label={ts("finish_pts")} value={mine.killPoints} />
                  <Stat label={ts("total")} value={mine.totalPoints} big />
                </dl>
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
    <div className="min-w-0">
      <dt className="text-[10px] leading-tight font-semibold tracking-wider text-muted-foreground uppercase">{label}</dt>
      <dd className={big ? "font-display text-3xl font-bold text-primary tabular-nums" : "font-display text-2xl font-bold tabular-nums"}>{value}</dd>
    </div>
  );
}
