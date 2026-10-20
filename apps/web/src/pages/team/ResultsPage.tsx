import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Search, Trophy } from "lucide-react";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
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
  v === undefined ? <span className="inline-block h-7 w-8 animate-pulse rounded bg-muted" /> : <>{v}</>;

function PanelLabel({ children }: { children: ReactNode }) {
  return <h2 className="text-[11px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">{children}</h2>;
}

function Stat({ label, value, accent }: { label: string; value: ReactNode; accent?: boolean }) {
  return (
    <div className="min-w-0 text-center lg:text-left">
      <p className={accent ? "font-display text-2xl font-bold text-primary tabular-nums sm:text-3xl" : "font-display text-2xl font-bold tabular-nums sm:text-3xl"}>
        {value}
      </p>
      <p className="truncate text-[10px] font-semibold tracking-wider text-muted-foreground uppercase sm:text-xs">{label}</p>
    </div>
  );
}

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
  const v = (n: number | undefined) => <Num v={sum === undefined ? undefined : (n ?? 0)} />;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start">
        <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5 lg:order-2" data-tour="results-stats">
          <PanelLabel>{t("tour_stats_title")}</PanelLabel>
          <div className="mt-2 grid grid-cols-4 gap-2 lg:grid-cols-2 lg:gap-4">
            <Stat label={t("stat_matches")} value={v(sum?.matchesPlayed)} />
            <Stat label={t("stat_finishes")} value={v(sum?.totalKills)} />
            <Stat label={t("stat_wins")} value={v(sum?.wins)} />
            <Stat
              label={t("stat_best")}
              accent
              value={<Num v={sum === undefined ? undefined : sum?.bestRank != null ? ord(sum.bestRank) : "—"} />}
            />
          </div>
        </section>

        <section className="rounded-2xl border bg-card shadow-sm lg:order-1" data-tour="results-list">
          <div className="px-4 pt-4 sm:px-5">
            <PanelLabel>
              {t("sessions_played")}
              {sum ? ` · ${sum.sessionsPlayed}` : ""}
            </PanelLabel>
          </div>
          {q.isError ? (
            <div className="p-4 sm:p-5">
              <QueryError error={q.error} onRetry={() => void q.refetch()} title={t("load_error")} />
            </div>
          ) : !q.data ? (
            <div className="space-y-2 p-4 sm:p-5">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-14 rounded-lg" />
              ))}
            </div>
          ) : q.data.length === 0 && !hasTeam ? (
            <div className="p-4 sm:p-5">
              <NoTeamHint icon={<Trophy />} className="border-0 py-6">{t("no_team")}</NoTeamHint>
            </div>
          ) : q.data.length === 0 ? (
            <EmptyState
              className="border-0 shadow-none"
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
            <StaggerList className="mt-2 divide-y border-t">
              {q.data.map((r) => (
                <StaggerItem key={`${r.scrim.id}-${r.date}`}>
                  <Link
                    to={`/team/results/${r.scrim.id}/${r.date}`}
                    className="group flex min-h-16 items-center gap-3 px-4 py-3 outline-none transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 sm:gap-4 sm:px-5"
                  >
                    <RankBadge rank={r.rank} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{r.scrim.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatDate(r.date)} · {t("rank_of", { rank: ord(r.rank), total: r.teamsCount })} · {t.plural("finishes", r.kills)}
                        {r.matchesPublished < r.matchesTotal && ` · ${t("matches_of", { done: r.matchesPublished, total: r.matchesTotal })}`}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-display text-3xl leading-none font-bold tabular-nums">{r.totalPoints}</p>
                      <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{t("pts")}</p>
                    </div>
                    <ChevronRight className="hidden size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 sm:block" />
                  </Link>
                </StaggerItem>
              ))}
            </StaggerList>
          )}
        </section>
      </div>
    </div>
  );
}
