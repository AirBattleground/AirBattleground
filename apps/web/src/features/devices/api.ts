import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { DeviceKey, DeviceNameInput, DeviceRow, DeviceWithKey, ListResponse } from "@7xen/shared";
import { api } from "@/lib/api";
import { errorMessage } from "@/features/manager/api";

export const deviceKeys = {
  all: ["manager", "devices"] as const,
  key: (id: string) => ["manager", "devices", id, "key"] as const,
};

/** Polls so Online / Streaming changes show up within a few seconds. */
export function useDevices() {
  return useQuery({
    queryKey: deviceKeys.all,
    queryFn: async () => (await api.get<ListResponse<DeviceRow>>("/api/manager/devices")).items,
    refetchInterval: 5_000,
  });
}

export function useDevice(id: string | undefined) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: [...deviceKeys.all, id ?? ""] as const,
    queryFn: () => api.get<DeviceRow>(`/api/manager/devices/${id}`),
    enabled: !!id,
    refetchInterval: 3_000,
    initialData: () => qc.getQueryData<DeviceRow[]>(deviceKeys.all)?.find((d) => d.id === id),
  });
}

export function useDeviceKey(id: string | null) {
  return useQuery({
    queryKey: deviceKeys.key(id ?? ""),
    queryFn: () => api.get<DeviceKey>(`/api/manager/devices/${id}/key`),
    enabled: !!id,
    staleTime: Infinity,
  });
}

export function useCreateDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DeviceNameInput) => api.post<DeviceWithKey>("/api/manager/devices", input),
    onSuccess: (d) => {
      qc.setQueryData(deviceKeys.key(d.id), { key: d.key });
      void qc.invalidateQueries({ queryKey: deviceKeys.all });
    },
  });
}

export function useRenameDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.patch<DeviceRow>(`/api/manager/devices/${id}`, { name }),
    onSuccess: () => {
      toast.success("Device renamed");
      void qc.invalidateQueries({ queryKey: deviceKeys.all });
    },
  });
}

export function useRegenerateKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<DeviceWithKey>(`/api/manager/devices/${id}/regenerate-key`),
    onSuccess: (d) => {
      qc.setQueryData(deviceKeys.key(d.id), { key: d.key });
      void qc.invalidateQueries({ queryKey: deviceKeys.all });
      toast.success("New key ready", { description: "Enter it in the app on the phone. The old key no longer works." });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function useDeleteDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/manager/devices/${id}`),
    onSuccess: () => {
      toast.success("Device removed");
      void qc.invalidateQueries({ queryKey: deviceKeys.all });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}
