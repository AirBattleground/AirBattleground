import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, type ApiErrorBody, type DeviceRow, type ListResponse, type LiveMatchCard, type SponsorLogo, type StreamLayoutConfig, type StreamLayoutResponse } from "@7xen/shared";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/query";
import { errorMessage } from "@/features/manager/api";
import { deviceKeys } from "@/features/devices/api";

const layoutKey = ["manager", "stream", "layout"] as const;

export function useStreamLayout() {
  return useQuery({ queryKey: layoutKey, queryFn: () => api.get<StreamLayoutResponse>("/api/manager/stream/layout") });
}

export function useSaveStreamLayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: StreamLayoutConfig) => api.put<StreamLayoutResponse>("/api/manager/stream/layout", config),
    onSuccess: (data) => {
      qc.setQueryData(layoutKey, data);
      toast.success("Layout saved", { description: "Your live device view shows it straight away." });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

async function postImage(path: string, file: File): Promise<SponsorLogo> {
  const form = new FormData();
  form.append("image", file, file.name);
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", credentials: "include", body: form });
  } catch {
    throw new ApiError(0, "INTERNAL", "Can't reach the server. Check your connection and try again.");
  }
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    if (res.status === 401) queryClient.setQueryData(["auth", "me"], null);
    throw new ApiError(res.status, err?.code ?? "INTERNAL", err?.message ?? (res.status === 413 ? "The image must be 5 MB or smaller." : "Upload failed. Please try again."), err?.fields);
  }
  return data as SponsorLogo;
}

export function useUploadSponsor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => postImage("/api/manager/stream/sponsors", file),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: layoutKey });
      toast.success("Sponsor logo added");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function useRemoveSponsor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/manager/stream/sponsors/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: layoutKey }),
    onError: (e) => toast.error(errorMessage(e)),
  });
}

/** The manager's scrim + tournament matches from today (and the next 2 days), for the match picker. */
export function useUpcomingMatches() {
  return useQuery({
    queryKey: ["manager", "live", "today", 2],
    queryFn: async () => (await api.get<ListResponse<LiveMatchCard>>("/api/manager/live/today?days=2")).items,
    staleTime: 60_000,
  });
}

export function useSetDeviceMatch(deviceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (matchId: string | null) => api.put<DeviceRow>(`/api/manager/devices/${deviceId}/match`, { matchId }),
    onSuccess: (d) => {
      qc.setQueryData([...deviceKeys.all, deviceId], d);
      void qc.invalidateQueries({ queryKey: deviceKeys.all });
      toast.success(d.match ? `Layout now shows ${d.match.title}` : "Layout shows sample data");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

/** PNG of an unsaved layout (editor preview) as an object URL; the caller revokes it. */
export async function fetchPreview(config: StreamLayoutConfig, opts: { matchId?: string | null; deviceId?: string | null } = {}, signal?: AbortSignal): Promise<string> {
  const res = await fetch("/api/manager/stream/preview", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config, ...opts }),
    signal,
  });
  if (!res.ok) {
    const err = ((await res.json().catch(() => null)) as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, err?.code ?? "INTERNAL", err?.message ?? "Couldn't draw the preview", err?.fields);
  }
  return URL.createObjectURL(await res.blob());
}
