import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateTeamInput, ListResponse, ResetPasswordInput, TeamRow, UpdateTeamInput } from "@7xen/shared";
import { api } from "@/lib/api";
import { statsKey } from "@/features/stats/api";

export const teamsKey = ["admin", "teams"] as const;

export function useTeams(q = "") {
  return useQuery({
    queryKey: [...teamsKey, { q }],
    queryFn: () => api.get<ListResponse<TeamRow>>("/api/admin/teams", { q: q.trim() || undefined }),
    placeholderData: keepPreviousData,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: teamsKey }), qc.invalidateQueries({ queryKey: statsKey })]);
}

export function useCreateTeam() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CreateTeamInput) => api.post<TeamRow>("/api/admin/teams", input),
    onSuccess: () => invalidate(),
  });
}

/** :id is the team id (not the login user id). */
export function useUpdateTeam() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTeamInput }) => api.patch<TeamRow>(`/api/admin/teams/${id}`, input),
    onSuccess: () => invalidate(),
  });
}

export function useResetTeamPassword() {
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ResetPasswordInput }) => api.post<void>(`/api/admin/teams/${id}/reset-password`, input),
  });
}
