import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminPlayerRow, ListResponse } from "@7xen/shared";
import { api } from "@/lib/api";

export const playersKey = ["admin", "players"] as const;

export function usePlayers(q = "") {
  return useQuery({
    queryKey: [...playersKey, { q }],
    queryFn: () => api.get<ListResponse<AdminPlayerRow>>("/api/admin/players", { q: q.trim() || undefined }),
    placeholderData: keepPreviousData,
  });
}

/** Turn a player's account on/off. Updates every cached list in place. */
export function useSetPlayerActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.patch<AdminPlayerRow>(`/api/admin/players/${id}`, { isActive }),
    onSuccess: (row) => {
      qc.setQueriesData<ListResponse<AdminPlayerRow>>({ queryKey: playersKey }, (old) =>
        old ? { ...old, items: old.items.map((p) => (p.id === row.id ? row : p)) } : old,
      );
      return qc.invalidateQueries({ queryKey: playersKey });
    },
  });
}
