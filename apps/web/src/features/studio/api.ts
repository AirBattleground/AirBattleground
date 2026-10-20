import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  CreateShowInput,
  CreateWorkerInput,
  ListResponse,
  ShowControlInput,
  ShowControlState,
  StudioOutputs,
  StudioShow,
  StudioShowRow,
  StudioStatus,
  StudioWorkerRow,
  UpdateShowInput,
} from "@7xen/shared";
import { api } from "@/lib/api";
import { errorMessage } from "@/features/manager/api";

export const studioKeys = {
  all: ["manager", "studio"] as const,
  list: ["manager", "studio", "list"] as const,
  show: (id: string) => ["manager", "studio", "show", id] as const,
  status: (id: string) => ["manager", "studio", "status", id] as const,
  control: (id: string) => ["manager", "studio", "control", id] as const,
  workers: ["manager", "studio", "workers"] as const,
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

// ---------------------------------------------------------------- Studio workers (phase 8b)

/** The manager's Studio workers (polled so the online dots stay current). */
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
      toast.success("Worker removed");
      void qc.invalidateQueries({ queryKey: studioKeys.workers });
    },
    onError: (e) => toast.error("Couldn't remove the worker", { description: errorMessage(e) }),
  });
}

/** Go live with the show running on a Studio worker. */
export function useStartWorker(showId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (workerId: string) => api.post<StudioStatus>(`/api/manager/studio/shows/${showId}/start-worker`, { workerId }),
    onSuccess: (st) => {
      qc.setQueryData(studioKeys.status(showId), st);
      void qc.invalidateQueries({ queryKey: studioKeys.workers });
      void qc.invalidateQueries({ queryKey: studioKeys.list });
    },
    onError: (e) => toast.error("Couldn't start the show on the worker", { description: errorMessage(e) }),
  });
}

/** End a show (browser or worker). */
export function useStopShow(showId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<StudioStatus>(`/api/manager/studio/shows/${showId}/stop`),
    onSuccess: (st) => {
      if (st) qc.setQueryData(studioKeys.status(showId), st);
      void qc.invalidateQueries({ queryKey: studioKeys.status(showId) });
      void qc.invalidateQueries({ queryKey: studioKeys.workers });
      void qc.invalidateQueries({ queryKey: studioKeys.list });
    },
    onError: (e) => toast.error("Couldn't end the show", { description: errorMessage(e) }),
  });
}

/** The show's control state once (the console reads where a worker-run show is at when it opens). */
export function useShowControl(showId: string) {
  return useQuery({
    queryKey: studioKeys.control(showId),
    queryFn: () => api.get<ShowControlState>(`/api/manager/studio/shows/${showId}/control`),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/** Mirror a take to the worker (the caller decides whether a failure is worth a toast). */
export function useUpdateControl(showId: string) {
  return useMutation({
    mutationFn: (input: ShowControlInput) => api.patch<{ version: number }>(`/api/manager/studio/shows/${showId}/control`, input),
  });
}

/**
 * Long-poll the control state (render page). Answers at once when the version moved past `since`, otherwise after
 * up to 25 s with the same state. Raw fetch so it can be aborted on unmount.
 */
export async function pollControl(showId: string, since: number, signal: AbortSignal): Promise<ShowControlState> {
  const res = await fetch(`/api/manager/studio/shows/${showId}/control?since=${since}`, { credentials: "include", signal });
  if (!res.ok) throw new Error(`Control ${res.status}`);
  return (await res.json()) as ShowControlState;
}
