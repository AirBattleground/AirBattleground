import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { CreateWorkerInput, ListResponse, StudioWorkerRow } from "@7xen/shared";
import { api } from "@/lib/api";
import { errorMessage } from "@/features/manager/api";

export const studioKeys = {
  all: ["manager", "studio"] as const,
  workers: ["manager", "studio", "workers"] as const,
};

/** The manager's connected studios (7XEN Studio apps linked by key; polled so the online dots stay current). */
export function useWorkers() {
  return useQuery({
    queryKey: studioKeys.workers,
    queryFn: async () => (await api.get<ListResponse<StudioWorkerRow>>("/api/manager/studio/workers")).items,
    refetchInterval: 5_000,
  });
}

export function useCreateWorker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWorkerInput) => api.post<{ worker: StudioWorkerRow; key: string }>("/api/manager/studio/workers", input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: studioKeys.workers }),
  });
}

export function useDeleteWorker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/manager/studio/workers/${id}`),
    onSuccess: () => {
      toast.success("Studio removed");
      void qc.invalidateQueries({ queryKey: studioKeys.workers });
    },
    onError: (e) => toast.error("Couldn't remove the studio", { description: errorMessage(e) }),
  });
}
