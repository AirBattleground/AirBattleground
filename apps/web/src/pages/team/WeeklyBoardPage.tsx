import { useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { PageHeader } from "@7xen/ui/components/brand/page";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { useAuth } from "@/lib/auth";
import { QueryError } from "@/features/team/components/QueryError";
import { StandingsSkeleton } from "@/features/results/components/Standings";
import { useTeamWeekly } from "@/features/weekly/api";
import { WeeklyBoardView } from "@/features/weekly/WeeklyBoardView";
import { useT } from "@/i18n/core";
import { weeklyMsg } from "@/i18n/weekly";

/** A scrim's Weekly Board (Mon–Fri points) for players: /team/weekly/:scrimId?week=YYYY-MM-DD */
export default function WeeklyBoardPage() {
  const t = useT(weeklyMsg);
  const steps = useMemo<TourStep[]>(
    () => [
      { title: t("tour_title"), description: t("tour_desc") },
      { element: '[data-tour="weekly-leader"]', title: t("tour_leader_title"), description: t("tour_leader_desc"), side: "bottom" },
      { element: '[data-tour="weekly-table"]', title: t("tour_table_title"), description: t("tour_table_desc"), side: "top" },
    ],
    [t],
  );
  usePageTour("team.weekly", steps);
  const { scrimId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const week = params.get("week") ?? "";
  const { user } = useAuth();
  const q = useTeamWeekly(scrimId, week);

  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={q.data?.scrim.title ?? t("eyebrow")} />
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} title={t("load_error")} />
      ) : !q.data ? (
        <StandingsSkeleton />
      ) : (
        <WeeklyBoardView
          board={q.data}
          fetching={q.isPlaceholderData}
          highlightTeamId={user?.team?.id}
          onWeek={(w) => setParams(w ? { week: w } : {}, { replace: true })}
        />
      )}
    </>
  );
}
