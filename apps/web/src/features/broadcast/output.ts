import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { DeviceOutput, ListResponse, StreamDestinationInput, StreamDestinationRow } from "@7xen/shared";
import { api } from "@/lib/api";
import { errorMessage } from "@/features/manager/api";

const destKey = ["manager", "stream", "destinations"] as const;
const outputKey = (deviceId: string) => ["manager", "devices", deviceId, "output"] as const;

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

/** Broadcast output of a device; polls while it runs. */
export function useDeviceOutput(deviceId: string) {
  return useQuery({
    queryKey: outputKey(deviceId),
    queryFn: () => api.get<DeviceOutput>(`/api/manager/devices/${deviceId}/output`),
    refetchInterval: (q) => (q.state.data && q.state.data.state !== "OFF" ? 3_000 : 15_000),
  });
}

export function useStartOutput(deviceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (destinationIds: string[]) => api.post<DeviceOutput>(`/api/manager/devices/${deviceId}/output/start`, { destinationIds }),
    onSuccess: (o) => {
      qc.setQueryData(outputKey(deviceId), o);
      toast.success("Going live", { description: "The broadcast starts in a few seconds." });
    },
    onError: (e) => toast.error("Couldn't go live", { description: errorMessage(e) }),
  });
}

export function useStopOutput(deviceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<DeviceOutput>(`/api/manager/devices/${deviceId}/output/stop`),
    onSuccess: (o) => {
      qc.setQueryData(outputKey(deviceId), o);
      toast.success("Broadcast stopped");
    },
    onError: (e) => toast.error("Couldn't stop", { description: errorMessage(e) }),
  });
}
