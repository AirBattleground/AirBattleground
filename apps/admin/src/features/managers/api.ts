import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateManagerInput, ListResponse, ManagerRow, ResetPasswordInput, UpdateManagerInput } from "@7xen/shared";
import { api } from "@/lib/api";
import { statsKey } from "@/features/stats/api";

const managersKey = ["admin", "managers"] as const;

export function useManagers(q = "") {
  return useQuery({
    queryKey: [...managersKey, { q }],
    queryFn: () => api.get<ListResponse<ManagerRow>>("/api/admin/managers", { q: q.trim() || undefined }),
    placeholderData: keepPreviousData,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: managersKey }), qc.invalidateQueries({ queryKey: statsKey })]);
}

export function useCreateManager() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CreateManagerInput) => api.post<ManagerRow>("/api/admin/managers", input),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateManager() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateManagerInput }) => api.patch<ManagerRow>(`/api/admin/managers/${id}`, input),
    onSuccess: () => invalidate(),
  });
}

export function useResetManagerPassword() {
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ResetPasswordInput }) => api.post<void>(`/api/admin/managers/${id}/reset-password`, input),
  });
}
