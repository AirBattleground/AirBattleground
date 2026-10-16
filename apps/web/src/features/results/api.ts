import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  ListResponse,
  MatchScorecard,
  PointsSystem,
  SaveRosterInput,
  Scrim,
  SessionStandings,
  TeamRoster,
  TeamSessionResult,
} from "@7xen/shared";
import { api } from "@/lib/api";
import { errorMessage } from "@/features/manager/api";
import { matchKeys } from "@/features/matches/api";

export const resultKeys = {
  teamResults: ["team", "results"] as const,
  teamStandings: (scrimId: string, date: string) => ["team", "standings", scrimId, date] as const,
  teamScorecard: (matchId: string) => ["team", "scorecard", matchId] as const,
  roster: ["team", "roster"] as const,
};

// ---------- manager ----------
export function useManagerStandings(scrimId: string | undefined, date: string | undefined) {
  return useQuery({
    queryKey: matchKeys.standings(scrimId ?? "", date ?? ""),
    queryFn: () => api.get<SessionStandings>(`/api/manager/scrims/${scrimId}/sessions/${date}/standings`),
    enabled: !!scrimId && !!date,
    refetchInterval: 60_000,
  });
}

export function useUpdatePointsSystem(scrimId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pointsSystem: PointsSystem) => api.patch<Scrim>(`/api/manager/scrims/${scrimId}`, { pointsSystem }),
    onSuccess: (scrim) => {
      qc.setQueryData(["manager", "scrim", scrim.id], scrim);
      void qc.invalidateQueries({ queryKey: ["manager", "scrims"] });
      void qc.invalidateQueries({ queryKey: matchKeys.all });
      void qc.invalidateQueries({ queryKey: matchKeys.standingsAll });
      toast.success("Points system updated", { description: "The points table has been recalculated." });
    },
    onError: (err) => toast.error("Couldn't update the points system", { description: errorMessage(err) }),
  });
}

// ---------- team ----------
export function useTeamResults() {
  return useQuery({
    queryKey: resultKeys.teamResults,
    queryFn: async () => (await api.get<ListResponse<TeamSessionResult>>("/api/team/results")).items,
  });
}

export function useTeamStandings(scrimId: string | undefined, date: string | undefined) {
  return useQuery({
    queryKey: resultKeys.teamStandings(scrimId ?? "", date ?? ""),
    queryFn: () => api.get<SessionStandings>(`/api/team/sessions/${scrimId}/${date}/standings`),
    enabled: !!scrimId && !!date,
    refetchInterval: 60_000,
  });
}

export function useTeamScorecard(matchId: string | undefined) {
  return useQuery({
    queryKey: resultKeys.teamScorecard(matchId ?? ""),
    queryFn: () => api.get<MatchScorecard>(`/api/team/matches/${matchId}`),
    enabled: !!matchId,
  });
}

export function useRoster() {
  return useQuery({
    queryKey: resultKeys.roster,
    queryFn: () => api.get<TeamRoster>("/api/team/roster"),
  });
}

export function useSaveRoster() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveRosterInput) => api.put<TeamRoster>("/api/team/roster", input),
    onSuccess: (roster) => {
      qc.setQueryData(resultKeys.roster, roster);
      toast.success("Roster saved", { description: "We'll use these names to match your players in results." });
    },
  });
}
