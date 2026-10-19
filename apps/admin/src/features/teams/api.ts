import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminTeamDetail, ListResponse, TeamRow } from "@7xen/shared";
import { api } from "@/lib/api";
import { statsKey } from "@/features/stats/api";
import { playersKey } from "@/features/players/api";

export const teamsKey = ["admin", "teams"] as const;

export function useTeams(q = "") {
  return useQuery({
    queryKey: [...teamsKey, { q }],
    queryFn: () => api.get<ListResponse<TeamRow>>("/api/admin/teams", { q: q.trim() || undefined }),
    placeholderData: keepPreviousData,
  });
}

export function useTeamDetail(id: string | null) {
  return useQuery({
    queryKey: [...teamsKey, "detail", id],
    queryFn: () => api.get<AdminTeamDetail>(`/api/admin/teams/${id}`),
    enabled: !!id,
  });
}

/** Disband = delete the team; members become free agents. 409 CONFLICT while it has upcoming registrations. */
export function useDisbandTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/admin/teams/${id}`),
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: [...teamsKey, "detail", id] });
      return Promise.all([
        qc.invalidateQueries({ queryKey: teamsKey }),
        qc.invalidateQueries({ queryKey: playersKey }),
        qc.invalidateQueries({ queryKey: statsKey }),
      ]);
    },
  });
}
