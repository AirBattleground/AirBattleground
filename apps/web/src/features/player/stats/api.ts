import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { PlayerStats, PlayerStatsPeriod, PlayerStatsScope, TdmPlayerStats } from "@7xen/shared";
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

export const tdmStatsKey = (period: PlayerStatsPeriod) => [...playerKeys.all, "stats", "tdm", period] as const;

/** GET /api/player/stats/tdm — the signed-in player's TDM Results (kept apart from the battle royale stats). */
export function useTdmStats(period: PlayerStatsPeriod, enabled = true) {
  return useQuery({
    queryKey: tdmStatsKey(period),
    queryFn: () => api.get<TdmPlayerStats>(`/api/player/stats/tdm?period=${period}`),
    placeholderData: keepPreviousData,
    enabled,
  });
}
