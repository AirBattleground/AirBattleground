import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { CreateShowInput, ListResponse, StudioOutputs, StudioShow, StudioShowRow, StudioStatus, UpdateShowInput } from "@7xen/shared";
import { api } from "@/lib/api";
import { errorMessage } from "@/features/manager/api";

export const studioKeys = {
  all: ["manager", "studio"] as const,
  list: ["manager", "studio", "list"] as const,
  show: (id: string) => ["manager", "studio", "show", id] as const,
  status: (id: string) => ["manager", "studio", "status", id] as const,
};

/** What a show can go out to (site YouTube when connected, the manager's own channels). */
export function useStudioOutputs() {
  return useQuery({ queryKey: [...studioKeys.all, "outputs"], queryFn: () => api.get<StudioOutputs>("/api/manager/studio/outputs"), staleTime: 30_000 });
}

export function useShows() {
  return useQuery({ queryKey: studioKeys.list, queryFn: async () => (await api.get<ListResponse<StudioShowRow>>("/api/manager/studio/shows")).items });
}

export function useShow(id: string | undefined) {
  return useQuery({ queryKey: studioKeys.show(id ?? ""), queryFn: () => api.get<StudioShow>(`/api/manager/studio/shows/${id}`), enabled: !!id, staleTime: Infinity });
}

export function useShowStatus(id: string | undefined, live: boolean) {
  return useQuery({
    queryKey: studioKeys.status(id ?? ""),
    queryFn: () => api.get<StudioStatus>(`/api/manager/studio/shows/${id}/status`),
    enabled: !!id,
    refetchInterval: live ? 3_000 : 15_000,
  });
}

export function useCreateShow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateShowInput) => api.post<StudioShow>("/api/manager/studio/shows", input),
    onSuccess: (s) => {
      qc.setQueryData(studioKeys.show(s.id), s);
      void qc.invalidateQueries({ queryKey: studioKeys.list });
    },
    onError: (e) => toast.error("Couldn't create the show", { description: errorMessage(e) }),
  });
}

export function useUpdateShow(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateShowInput) => api.patch<StudioShow>(`/api/manager/studio/shows/${id}`, input),
    onSuccess: (s) => {
      qc.setQueryData(studioKeys.show(s.id), s);
      void qc.invalidateQueries({ queryKey: studioKeys.list });
    },
    onError: (e) => toast.error("Couldn't save the show", { description: errorMessage(e) }),
  });
}

export function useDeleteShow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/manager/studio/shows/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: studioKeys.list }),
    onError: (e) => toast.error("Couldn't delete the show", { description: errorMessage(e) }),
  });
}
