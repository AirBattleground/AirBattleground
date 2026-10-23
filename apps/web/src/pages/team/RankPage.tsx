import { useMemo } from "react";
import { Crown } from "lucide-react";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { common } from "@/i18n/common";
import { useT } from "@/i18n/core";

/** AirBattleground-wide leaderboard (/team/rank) — placeholder until the ranking is designed. */
export default function RankPage() {
  const t = useT(common);
  const steps = useMemo<TourStep[]>(() => [{ title: t("rank_title"), description: t("rank_soon_desc") }], [t]);
  usePageTour("team.rank", steps);
  return (
    <>
      <PageHeader eyebrow={t("nav_rank")} title={t("rank_title")} />
      <EmptyState icon={<Crown />} title={t("rank_soon")} description={t("rank_soon_desc")} />
    </>
  );
}
