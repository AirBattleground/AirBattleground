import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarDays, Crosshair, Drumstick, Medal, Search, Swords, Trophy } from "lucide-react";
import { EmptyState, PageHeader, StatCard } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { usePlayerSession } from "@/lib/auth";
import { NoTeamHint } from "@/features/player/components/NoTeamHint";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { useTeamDashboard } from "@/features/team/api";
import { useDayFormat } from "@/features/team/format";
import { QueryError } from "@/features/team/components/QueryError";
import { StaggerItem, StaggerList } from "@/features/team/components/Stagger";
import { useTeamResults } from "@/features/results/api";
import { RankBadge } from "@/features/results/components/Rank";
import { useT } from "@/i18n/core";
import { resultsMsg, useOrdinal } from "@/i18n/results";

const Num = ({ v }: { v: ReactNode | undefined }) =>
  v === undefined ? <span className="inline-block h-9 w-10 animate-pulse rounded bg-muted" /> : <>{v}</>;

export default function ResultsPage() {
  const t = useT(resultsMsg);
  const ord = useOrdinal();
  const { formatDate } = useDayFormat();
  const steps = useMemo<TourStep[]>(
    () => [
      { title: t("tour_title"), description: t("tour_desc") },
      { element: '[data-tour="results-stats"]', title: t("tour_stats_title"), description: t("tour_stats_desc") },
      { element: '[data-tour="results-list"]', title: t("tour_list_title"), description: t("tour_list_desc") },
    ],
    [t],
  );
  usePageTour("team.results", steps);
  const { hasTeam } = usePlayerSession();
  const dash = useTeamDashboard({ enabled: hasTeam });
  const q = useTeamResults();
  // phase 5c: no team → no numbers (zeros), the list explains why
  const sum = !hasTeam ? null : dash.data ? dash.data.results : undefined;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5" data-tour="results-stats">
        <StatCard label={t("stat_sessions")} value={<Num v={sum === undefined ? undefined : (sum?.sessionsPlayed ?? 0)} />} icon={<CalendarDays />} tone="info" />
        <StatCard label={t("stat_matches")} value={<Num v={sum === undefined ? undefined : (sum?.matchesPlayed ?? 0)} />} icon={<Swords />} tone="brand" />
        <StatCard label={t("stat_finishes")} value={<Num v={sum === undefined ? undefined : (sum?.totalKills ?? 0)} />} icon={<Crosshair />} tone="brand" />
        <StatCard label={t("stat_wins")} value={<Num v={sum === undefined ? undefined : (sum?.wins ?? 0)} />} icon={<Drumstick />} tone="warning" />
        <StatCard
          label={t("stat_best")}
          value={<Num v={sum === undefined ? undefined : sum?.bestRank != null ? ord(sum.bestRank) : "—"} />}
          icon={<Medal />}
          tone="success"
          className="col-span-2 lg:col-span-1"
        />
      </div>

      <section className="space-y-3" data-tour="results-list">
        <h2 className="font-display text-2xl font-bold">{t("sessions_played")}</h2>
        {q.isError ? (
          <QueryError error={q.error} onRetry={() => void q.refetch()} title={t("load_error")} />
        ) : !q.data ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : q.data.length === 0 && !hasTeam ? (
          <NoTeamHint icon={<Trophy />}>{t("no_team")}</NoTeamHint>
        ) : q.data.length === 0 ? (
          <EmptyState
            icon={<Trophy />}
            title={t("empty_title")}
            description={t("empty_desc")}
            action={
              <Button asChild>
                <Link to="/team/scrims">
                  <Search /> {t("find_scrim")}
                </Link>
              </Button>
            }
          />
        ) : (
          <StaggerList className="space-y-2">
            {q.data.map((r) => (
              <StaggerItem key={`${r.scrim.id}-${r.date}`}>
                <Link
                  to={`/team/results/${r.scrim.id}/${r.date}`}
                  className="group flex items-center gap-3 rounded-xl border bg-card p-3 shadow-sm outline-none transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-glow focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:gap-4 sm:p-4"
                >
                  <RankBadge rank={r.rank} size="lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-lg font-bold">{r.scrim.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(r.date)} · {t("rank_of", { rank: ord(r.rank), total: r.teamsCount })}
                      {r.slotNumber != null && ` · ${t("slot_n", { n: String(r.slotNumber).padStart(2, "0") })}`}
                    </p>
                    <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      <span>{t("matches_of", { done: r.matchesPublished, total: r.matchesTotal })}</span>
                      <span className="inline-flex items-center gap-1">
                        <Crosshair className="size-3" /> {t.plural("finishes", r.kills)}
                      </span>
                      {r.wins > 0 && (
                        <span className="inline-flex items-center gap-1 font-semibold text-warning-foreground dark:text-warning">
                          <Drumstick className="size-3" /> {r.wins}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-display text-3xl font-bold leading-none tabular-nums">{r.totalPoints}</p>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("points")}</p>
                  </div>
                  <ArrowRight className="hidden size-5 text-muted-foreground transition-transform group-hover:translate-x-0.5 sm:block" />
                </Link>
              </StaggerItem>
            ))}
          </StaggerList>
        )}
      </section>
    </div>
  );
}
