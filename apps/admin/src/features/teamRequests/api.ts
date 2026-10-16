import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ListResponse, TeamRequestRow, TeamRequestStatus, TeamRow } from "@7xen/shared";
import { api } from "@/lib/api";
import { statsKey } from "@/features/stats/api";
import { teamsKey } from "@/features/teams/api";

export const teamRequestsKey = ["admin", "team-requests"] as const;

export function useTeamRequests(status: TeamRequestStatus) {
  return useQuery({
    queryKey: [...teamRequestsKey, status],
    queryFn: () => api.get<ListResponse<TeamRequestRow>>("/api/admin/team-requests", { status }).then((r) => r.items),
    refetchInterval: status === "PENDING" ? 30_000 : false,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: teamRequestsKey }),
      qc.invalidateQueries({ queryKey: teamsKey }),
      qc.invalidateQueries({ queryKey: statsKey }),
    ]);
}

/** Removes the request from the pending list right away; restores it if the server refuses. */
function useOptimisticRemove() {
  const qc = useQueryClient();
  const key = [...teamRequestsKey, "PENDING"];
  return {
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<TeamRequestRow[]>(key);
      qc.setQueryData<TeamRequestRow[]>(key, (list) => list?.filter((r) => r.id !== id));
      return { previous };
    },
    onError: (_e: unknown, _id: unknown, ctx: { previous?: TeamRequestRow[] } | undefined) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
  };
}

export function useApproveTeamRequest() {
  const invalidate = useInvalidate();
  const optimistic = useOptimisticRemove();
  return useMutation({
    mutationFn: (id: string) => api.post<TeamRow>(`/api/admin/team-requests/${id}/approve`),
    ...optimistic,
    onSettled: () => invalidate(),
  });
}

export function useRejectTeamRequest() {
  const invalidate = useInvalidate();
  const optimistic = useOptimisticRemove();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => api.post<TeamRequestRow>(`/api/admin/team-requests/${id}/reject`, { reason }),
    onMutate: ({ id }) => optimistic.onMutate(id),
    onError: (e, v, ctx) => optimistic.onError(e, v, ctx),
    onSettled: () => invalidate(),
  });
}
