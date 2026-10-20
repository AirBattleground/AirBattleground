import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ChevronRight, Lock } from "lucide-react";
import { ApiError } from "@7xen/shared";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { cn } from "@7xen/ui/lib/utils";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { useAuth } from "@/lib/auth";
import { formatTime, useDayFormat } from "@/features/team/format";
import { useT } from "@/i18n/core";
import { resultsMsg } from "@/i18n/results";
import { MapChip } from "@/features/team/components/MapChips";
import { QueryError } from "@/features/team/components/QueryError";
import { useTeamStandings } from "@/features/results/api";
import { PointsLegend, StandingsBoard, StandingsSkeleton, StandingsSummary } from "@/features/results/components/Standings";

export default function SessionResultsPage() {
  const t = useT(resultsMsg);
  const { formatDate } = useDayFormat();
  const steps = useMemo<TourStep[]>(
    () => [
      { title: t("st_tour_title"), description: t("st_tour_desc") },
      { element: '[data-tour="standings-table"]', title: t("st_tour_table_title"), description: t("st_tour_table_desc") },
      { element: '[data-tour="session-matches"]', title: t("st_tour_matches_title"), description: t("st_tour_matches_desc") },
      { element: '[data-tour="standings-copy"]', title: t("st_tour_copy_title"), description: t("st_tour_copy_desc") },
    ],
    [t],
  );
  usePageTour("team.sessionResults", steps);
  const { scrimId = "", date = "" } = useParams();
  const { user } = useAuth();
  const q = useTeamStandings(scrimId, date);
  const s = q.data;

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
        <Link to="/team/results">
          <ArrowLeft /> {t("all_results")}
        </Link>
      </Button>
      <PageHeader
        eyebrow={s ? `${formatDate(s.date)} · ${formatTime(s.scrim.startTime)} IST` : t("points_table")}
        title={s?.scrim.title ?? t("points_table")}
      />
      {q.isError ? (
        q.error instanceof ApiError && (q.error.status === 403 || q.error.status === 404) ? (
          <EmptyState
            icon={<Lock />}
            title={t("st_unavailable_title")}
            description={t("st_unavailable_desc")}
            action={
              <Button asChild>
                <Link to="/team/results">{t("back_to_results")}</Link>
              </Button>
            }
          />
        ) : (
          <QueryError error={q.error} onRetry={() => void q.refetch()} title={t("st_load_error")} />
        )
      ) : !s ? (
        <StandingsSkeleton />
      ) : (
        <div className="space-y-6">
          <StandingsSummary standings={s} />
          <StandingsBoard
            standings={s}
            highlightTeamId={user?.team?.id}
            matchHref={(m) => (m.status === "PUBLISHED" ? `/team/results/${scrimId}/${date}/matches/${m.id}` : undefined)}
          />
          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <section data-tour="session-matches" className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
              <h2 className="text-[11px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">{t("match_scorecards")}</h2>
              <ul className="flex flex-wrap gap-2">
                {s.matches.map((m) => {
                  const open = m.status === "PUBLISHED";
                  const inner = (
                    <>
                      <span className="font-display text-base font-bold">{t("match_n", { n: m.number })}</span>
                      <MapChip map={m.map} className="px-1.5 py-0.5 text-[10px]" />
                      {open && <ChevronRight className="size-4 text-muted-foreground" />}
                    </>
                  );
                  const cls = "flex min-h-10 items-center gap-2 rounded-lg border px-3 py-1.5";
                  return (
                    <li key={m.id}>
                      {open ? (
                        <Link
                          to={`/team/results/${scrimId}/${date}/matches/${m.id}`}
                          className={cn(
                            cls,
                            "bg-background outline-none transition-colors hover:border-primary/50 focus-visible:ring-[3px] focus-visible:ring-ring/50",
                          )}
                        >
                          {inner}
                        </Link>
                      ) : (
                        <div className={cn(cls, "border-dashed opacity-60")} title={t("not_published")}>
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
        </div>
      )}
    </>
  );
}
