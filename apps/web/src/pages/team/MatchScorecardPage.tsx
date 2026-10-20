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
import { useDateFormat, useT } from "@/i18n/core";
import { resultsMsg, useOrdinal } from "@/i18n/results";
import { MapChip } from "@/features/team/components/MapChips";
import { QueryError } from "@/features/team/components/QueryError";
import { useTeamScorecard } from "@/features/results/api";
import { ScorecardList } from "@/features/results/components/Scorecard";

export default function MatchScorecardPage() {
  const t = useT(resultsMsg);
  const ord = useOrdinal();
  const fmt = useDateFormat();
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
        description={s ? t("published_at", { when: fmt(s.match.publishedAt, "d MMM, h:mm a") }) : undefined}
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
        <div className="space-y-5">
          {mine && (
            <div data-tour="scorecard-mine" className="relative overflow-hidden rounded-2xl border border-primary/40 bg-card p-5 shadow-glow">
              <div className="pointer-events-none absolute inset-0 bg-grid opacity-50" />
              <div className="relative flex flex-wrap items-center gap-x-8 gap-y-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">{t("your_team")}</p>
                  <p className="font-display text-4xl font-bold">
                    {mine.rank === 1 ? t("winner") : t("place_n", { ord: ord(mine.rank) })}
                  </p>
                </div>
                <Stat label={t("stat_finishes")} value={mine.kills} />
                <Stat label={t("placement_pts")} value={mine.placementPoints} />
                <Stat label={t("finish_pts")} value={mine.killPoints} />
                <Stat label={t("total")} value={mine.totalPoints} big />
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
