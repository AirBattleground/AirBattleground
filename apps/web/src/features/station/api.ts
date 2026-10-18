import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, type ListResponse, type MatchDetail, type MatchLive, type ScreenshotRow, type StationInput, type StationPhase, type StationStatus, type TeamLiveCard } from "@7xen/shared";
import { api } from "@/lib/api";
import { errorMessage } from "@/features/manager/api";
import { matchKeys } from "@/features/matches/api";
import { liveKeys } from "@/features/live/api";

export const stationKeys = {
  status: ["manager", "station"] as const,
  live: (matchId: string) => ["manager", "station", "live", matchId] as const,
  teamLive: ["team", "live"] as const,
};

/** HLS playlist of a match (cookie-authenticated, same origin). */
export const liveHlsUrl = (matchId: string) => `/api/live/${matchId}/index.m3u8`;

/** What the panel shows while the station can't be reached (or the API predates the station). */
export const OFFLINE_STATUS: StationStatus = {
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

const missing = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 405 || e.status === 501);

/** Phases where the station is busy getting ready (poll fast). */
export const isPreparing = (p: StationPhase | undefined) => p === "STARTING_EMULATOR" || p === "LAUNCHING_BGMI";
/** Phases where a match holds the station. */
export const isActive = (p: StationPhase | undefined) => isPreparing(p) || p === "LIVE" || p === "STOPPING";

/** BlueStacks is starting/stopping (background job running or emulator booting): poll fast. */
export const deviceBusy = (s: StationStatus | undefined | null) => !!s && (s.device?.job?.phase === "running" || s.emulator === "BOOTING");

// ---------- manager ----------

/** Station health, polled every 5 s while the page is open. Never errors: an unreachable API reads as offline. */
export function useStationStatus() {
  return useQuery({
    queryKey: stationKeys.status,
    queryFn: async () => {
      try {
        return await api.get<StationStatus>("/api/manager/station");
      } catch (e) {
        if (missing(e) || (e instanceof ApiError && (e.status === 0 || e.status >= 500))) return OFFLINE_STATUS;
        throw e;
      }
    },
    refetchInterval: (q) => (deviceBusy(q.state.data) ? 2_000 : 5_000),
    refetchIntervalInBackground: false,
  });
}

/** Live state of one match: every 2 s while getting ready, 4 s while live, 15 s otherwise. */
export function useMatchLive(matchId: string, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: stationKeys.live(matchId),
    queryFn: async () => {
      try {
        return await api.get<MatchLive>(`/api/manager/matches/${matchId}/live`);
      } catch (e) {
        if (missing(e)) return null;
        throw e;
      }
    },
    enabled: opts.enabled ?? true,
    refetchInterval: (q) => {
      const d = q.state.data;
      const mine = d?.station.matchId === matchId;
      if (deviceBusy(d?.station)) return 2_000;
      if (mine && (isPreparing(d?.station.phase) || d?.station.phase === "STOPPING")) return 2_000;
      if (d?.streaming || (mine && d?.station.phase === "LIVE")) return 4_000;
      return 15_000;
    },
  });
}

export function usePrepareStation(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<MatchLive>(`/api/manager/matches/${matchId}/station/prepare`),
    onSuccess: (live) => {
      qc.setQueryData(stationKeys.live(matchId), live);
      qc.setQueryData(stationKeys.status, live.station);
      void qc.invalidateQueries({ queryKey: liveKeys.recordings(matchId) });
    },
    onError: (err) => toast.error("Couldn't prepare the station", { description: errorMessage(err) }),
  });
}

/** BlueStacks mode: start the emulator (+ BGMI) in the background. Progress comes from polling live/status. */
export function useDeviceStart(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { launchBgmi?: boolean } = {}) => api.post<StationStatus>(`/api/manager/matches/${matchId}/station/device/start`, body),
    onSuccess: (status) => {
      qc.setQueryData(stationKeys.status, status);
      qc.setQueryData<MatchLive | null | undefined>(stationKeys.live(matchId), (d) => (d ? { ...d, station: status } : d));
    },
    onError: (err) => toast.error("Couldn't start the emulator", { description: errorMessage(err) }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: stationKeys.status });
      void qc.invalidateQueries({ queryKey: stationKeys.live(matchId) });
    },
  });
}

/** BlueStacks mode: shut down the game (target "game") or the whole emulator ("all", default). 409 while a match is live. */
export function useDeviceStop(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { target?: "game" | "all" } = {}) => api.post<StationStatus>(`/api/manager/matches/${matchId}/station/device/stop`, body),
    onSuccess: (status) => {
      qc.setQueryData(stationKeys.status, status);
      qc.setQueryData<MatchLive | null | undefined>(stationKeys.live(matchId), (d) => (d ? { ...d, station: status } : d));
    },
    onError: (err) => toast.error("Couldn't shut down the emulator", { description: errorMessage(err) }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: stationKeys.status });
      void qc.invalidateQueries({ queryKey: stationKeys.live(matchId) });
    },
  });
}

export function useStopStation(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<MatchLive>(`/api/manager/matches/${matchId}/station/stop`),
    onSuccess: (live) => {
      qc.setQueryData(stationKeys.live(matchId), live);
      qc.setQueryData(stationKeys.status, live.station);
      toast.success("Stopped", { description: "The video is being saved — it shows up in Recordings in a minute." });
    },
    onError: (err) => toast.error("Couldn't stop the station", { description: errorMessage(err) }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: liveKeys.recordings(matchId) });
      void qc.invalidateQueries({ queryKey: stationKeys.status });
    },
  });
}

export function useStationCapture(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kind: "SLOT_LIST" | "RESULTS") => api.post<ScreenshotRow>(`/api/manager/matches/${matchId}/station/capture`, { kind }),
    onSuccess: (row, kind) => {
      if (row?.id) {
        qc.setQueryData<MatchDetail>(matchKeys.detail(matchId), (d) =>
          d && !d.screenshots.some((s) => s.id === row.id) ? { ...d, screenshots: [...d.screenshots, row] } : d,
        );
      }
      void qc.invalidateQueries({ queryKey: matchKeys.detail(matchId) });
      void qc.invalidateQueries({ queryKey: ["manager", "matches", "session"] });
      toast.success(kind === "SLOT_LIST" ? "Team list captured — reading it now" : "Results captured — reading them now", {
        description: kind === "SLOT_LIST" ? "It's in the team list screenshots below." : "It's in the results screenshots below.",
      });
    },
    onError: (err) => toast.error("Couldn't take the screenshot", { description: errorMessage(err) }),
  });
}

const MAX_QUEUE = 6;
const MIN_GAP_MS = 60;

/**
 * Remote control sender: inputs go out one at a time (in order) with a small gap, so a burst of taps can't
 * flood the station. Extra inputs beyond a short queue are dropped. Errors show one toast at a time.
 */
export function useStationInput(matchId: string) {
  const queue = useRef<StationInput[]>([]);
  const running = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      queue.current = [];
    };
  }, []);

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      while (alive.current && queue.current.length) {
        const input = queue.current.shift()!;
        try {
          await api.post<void>(`/api/manager/matches/${matchId}/station/input`, input);
        } catch (err) {
          queue.current = [];
          toast.error("The station didn't get that", { id: "station-input", description: errorMessage(err) });
        }
        await new Promise((r) => setTimeout(r, MIN_GAP_MS));
      }
    } finally {
      running.current = false;
    }
  }, [matchId]);

  return useCallback(
    (input: StationInput) => {
      if (queue.current.length >= MAX_QUEUE) {
        toast.warning("Slow down a little", { id: "station-input-busy", description: "The station is still working through your last taps." });
        return false;
      }
      queue.current.push(input);
      void pump();
      return true;
    },
    [pump],
  );
}

// ---------- team ----------

/** Matches of the team streaming right now. Polls every 15 s. */
export function useTeamLive(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: stationKeys.teamLive,
    queryFn: async () => {
      try {
        return (await api.get<ListResponse<TeamLiveCard>>("/api/team/live")).items;
      } catch (e) {
        if (missing(e)) return [] as TeamLiveCard[];
        throw e;
      }
    },
    enabled: opts.enabled ?? true,
    refetchInterval: 15_000,
    retry: 1,
  });
}
