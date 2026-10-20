import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Lock } from "lucide-react";
import { ApiError } from "@7xen/shared";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { useAuth } from "@/lib/auth";
import { useDayFormat } from "@/features/team/format";
import { useT } from "@/i18n/core";
import { resultsMsg, useOrdinal } from "@/i18n/results";
import { MapChip } from "@/features/team/components/MapChips";
import { QueryError } from "@/features/team/components/QueryError";
import { useTeamScorecard } from "@/features/results/api";
import { ScorecardList, TieNote } from "@/features/results/components/Scorecard";

export default function MatchScorecardPage() {
  const t = useT(resultsMsg);
  const ord = useOrdinal();
  const { formatDate } = useDayFormat();
  const steps = useMemo<TourStep[]>(
    () => [
      { title: t("sc_tour_title"), description: t("sc_tour_desc") },
      { element: '[data-tour="scorecard-mine"]', title: t("sc_tour_mine_title"), description: t("sc_tour_mine_desc") },
      { element: '[data-tour="scorecard-list"]', title: t("sc_tour_list_title"), description: t("sc_tour_list_desc") },
    ],
    [t],
  );
  usePageTour("team.scorecard", steps);
  const { scrimId = "", date = "", matchId } = useParams();
  const { user } = useAuth();
  const q = useTeamScorecard(matchId);
  const s = q.data;
  const mine = s?.teams.find((t) => t.team.id === user?.team?.id);

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
        <Link to={`/team/results/${scrimId}/${date}`}>
          <ArrowLeft /> {t("points_table")}
        </Link>
      </Button>
      <PageHeader
        eyebrow={s ? `${s.scrim.title} · ${formatDate(s.date)}` : t("scorecard")}
        title={
          s ? (
            <span className="flex flex-wrap items-center gap-3">
              {t("match_n", { n: s.match.number })} <MapChip map={s.match.map} className="text-sm" />
            </span>
          ) : (
            t("scorecard")
          )
        }
      />
      {q.isError ? (
        q.error instanceof ApiError && (q.error.status === 403 || q.error.status === 404) ? (
          <EmptyState
            icon={<Lock />}
            title={t("sc_unavailable_title")}
            description={t("sc_unavailable_desc")}
          />
        ) : (
          <QueryError error={q.error} onRetry={() => void q.refetch()} title={t("sc_load_error")} />
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
            <section data-tour="scorecard-mine" className="flex items-center gap-4 rounded-2xl border border-primary/40 bg-card p-4 shadow-sm sm:p-5">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold tracking-[0.2em] text-primary uppercase">{t("your_team")}</p>
                <p className="truncate font-display text-3xl font-bold sm:text-4xl">
                  {mine.rank === 1 ? t("winner") : t("place_n", { ord: ord(mine.rank) })}
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {t.plural("finishes", mine.kills)} · {mine.placementPoints} + {mine.killPoints} {t("pts")}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-display text-4xl leading-none font-bold text-primary tabular-nums sm:text-5xl">{mine.totalPoints}</p>
                <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{t("pts")}</p>
              </div>
            </section>
          )}
          <TieNote note={s.tieNote} />
          <ScorecardList teams={s.teams} highlightTeamId={user?.team?.id} />
        </div>
      )}
    </>
  );
}

