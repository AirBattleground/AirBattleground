import { useQuery } from "@tanstack/react-query";
import type { DeviceRow, ListResponse } from "@7xen/shared";
import { api } from "@/lib/api";

export const deviceKeys = {
  all: ["manager", "devices"] as const,
};

/** Polls so Online / Streaming changes show up within a few seconds. */
export function useDevices(enabled = true) {
  return useQuery({
    queryKey: deviceKeys.all,
    queryFn: async () => (await api.get<ListResponse<DeviceRow>>("/api/manager/devices")).items,
    enabled,
    refetchInterval: 5_000,
  });
}
