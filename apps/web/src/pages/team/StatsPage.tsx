import { useMemo } from "react";
import { PageHeader } from "@7xen/ui/components/brand/page";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { usePlayerSession } from "@/lib/auth";
import { PlayerStatsSection } from "@/features/player/stats/PlayerStatsSection";
import { common } from "@/i18n/common";
import { useT } from "@/i18n/core";
import { statsMsg } from "@/i18n/playerStats";

/** The player's own statistics (opened from the avatar menu): /team/stats */
export default function StatsPage() {
  const tc = useT(common);
  const ts = useT(statsMsg);
  const steps = useMemo<TourStep[]>(() => [{ element: '[data-tour="player-stats"]', title: ts("title"), description: ts("desc"), side: "top" }], [ts]);
  usePageTour("team.stats", steps);
  const { user, player } = usePlayerSession();
  return (
    <>
      <PageHeader eyebrow={tc("nav_stats")} title={player?.ign || user?.displayName || tc("nav_stats")} />
      <PlayerStatsSection />
    </>
  );
}
