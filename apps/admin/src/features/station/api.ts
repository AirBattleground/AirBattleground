import { useQuery } from "@tanstack/react-query";
import { ApiError, type StationStatus } from "@7xen/shared";
import { api } from "@/lib/api";

export const OFFLINE_STATION: StationStatus = {
  online: false,
  emulator: "OFF",
  bgmiInstalled: false,
  phase: "IDLE",
  matchId: null,
  recordingId: null,
  startedAt: null,
  screen: null,
  rotation: null,
  error: null,
  version: "",
};

/** 7XEN Station health. An unreachable station (or an API without the endpoint yet) reads as offline. */
export function useStationStatus(opts: { refetchInterval?: number } = {}) {
  return useQuery({
    queryKey: ["admin", "station"],
    queryFn: async () => {
      try {
        return await api.get<StationStatus>("/api/admin/station");
      } catch (e) {
        if (e instanceof ApiError && (e.status === 0 || e.status === 404 || e.status === 405 || e.status >= 500)) return OFFLINE_STATION;
        throw e;
      }
    },
    refetchInterval: opts.refetchInterval ?? 10_000,
  });
}
