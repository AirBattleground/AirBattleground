import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { PlayerStats, PlayerStatsPeriod, PlayerStatsScope } from "@7xen/shared";
import { api } from "@/lib/api";
import { playerKeys } from "../api";

export const statsKey = (scope: PlayerStatsScope, period: PlayerStatsPeriod) => [...playerKeys.all, "stats", scope, period] as const;

/** GET /api/player/stats — the signed-in player's report (keeps the last result on screen while a filter loads). */
export function usePlayerStats(scope: PlayerStatsScope, period: PlayerStatsPeriod) {
  return useQuery({
    queryKey: statsKey(scope, period),
    queryFn: () => api.get<PlayerStats>(`/api/player/stats?scope=${scope}&period=${period}`),
    placeholderData: keepPreviousData,
  });
}
