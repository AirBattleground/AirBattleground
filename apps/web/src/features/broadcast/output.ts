import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ListResponse, StreamDestinationInput, StreamDestinationRow } from "@7xen/shared";
import { api } from "@/lib/api";
import { errorMessage } from "@/features/manager/api";

const destKey = ["manager", "stream", "destinations"] as const;

/** The manager's saved stream destinations (YouTube / Facebook / RTMP keys). */
export function useDestinations() {
  return useQuery({ queryKey: destKey, queryFn: async () => (await api.get<ListResponse<StreamDestinationRow>>("/api/manager/stream/destinations")).items });
}

export function useCreateDestination() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StreamDestinationInput) => api.post<StreamDestinationRow>("/api/manager/stream/destinations", input),
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: destKey });
      toast.success(`${d.name} added`);
    },
  });
}

export function useDeleteDestination() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/manager/stream/destinations/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: destKey }),
    onError: (e) => toast.error(errorMessage(e)),
  });
}
