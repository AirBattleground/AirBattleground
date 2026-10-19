import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateManagerInviteInput, ListResponse, ManagerInviteRow, ManagerRow, ResetPasswordInput, UpdateManagerInput } from "@7xen/shared";
import { api } from "@/lib/api";
import { statsKey } from "@/features/stats/api";

const managersKey = ["admin", "managers"] as const;
const invitesKey = ["admin", "manager-invites"] as const;

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

// ---------------------------------------------------------------------------
// Manager invitations (phase 5b): invited email signs in with Google → becomes a manager
// ---------------------------------------------------------------------------
export function useManagerInvites() {
  return useQuery({
    queryKey: [...invitesKey, "PENDING"],
    queryFn: () => api.get<ListResponse<ManagerInviteRow>>("/api/admin/manager-invites", { status: "PENDING" }),
  });
}

export function useCreateManagerInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateManagerInviteInput) => api.post<ManagerInviteRow>("/api/admin/manager-invites", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: invitesKey }),
  });
}

export function useRevokeManagerInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/api/admin/manager-invites/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: invitesKey }),
  });
}
