import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, type ApiErrorBody, type ImageUrlResponse, type ManagerTournamentDetail, type Scrim } from "@7xen/shared";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/query";
import { errorMessage } from "./api";

/** Org logo + scrim/tournament posters (multipart uploads — the JSON client can't send files). */

const brandingKey = ["manager", "branding"] as const;

async function uploadImage(path: string, file: File): Promise<ImageUrlResponse> {
  const form = new FormData();
  form.append("file", file, file.name);
  let res: Response;
  try {
    res = await fetch(path, { method: "PUT", credentials: "include", body: form });
  } catch {
    throw new ApiError(0, "INTERNAL", "Can't reach the server. Check your connection and try again.");
  }
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    if (res.status === 401) queryClient.setQueryData(["auth", "me"], null);
    throw new ApiError(
      res.status,
      err?.code ?? (res.status === 413 ? "VALIDATION_ERROR" : "INTERNAL"),
      err?.message ?? (res.status === 413 ? "The image must be 5 MB or smaller." : "Upload failed. Please try again."),
      err?.fields,
    );
  }
  return data as ImageUrlResponse;
}

// ---------- org logo ----------
export function useOrgLogo() {
  return useQuery({
    queryKey: brandingKey,
    queryFn: () => api.get<ImageUrlResponse>("/api/manager/branding"),
  });
}

/** manager.logoUrl is embedded in scrim + tournament DTOs — refresh them too. */
function settleLogo(qc: QueryClient, res: ImageUrlResponse) {
  qc.setQueryData(brandingKey, res);
  void qc.invalidateQueries({ queryKey: ["manager", "scrims"] });
  void qc.invalidateQueries({ queryKey: ["manager", "scrim"] });
  void qc.invalidateQueries({ queryKey: ["manager", "tournaments"] });
}

export function useUploadOrgLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => uploadImage("/api/manager/branding/logo", file),
    onSuccess: (res) => {
      settleLogo(qc, res);
      toast.success("Logo updated", { description: "Teams will see it on your scrims and tournaments." });
    },
    onError: (err) => toast.error("Couldn't upload the logo", { description: errorMessage(err) }),
  });
}

export function useRemoveOrgLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del<ImageUrlResponse>("/api/manager/branding/logo"),
    onSuccess: (res) => {
      settleLogo(qc, res ?? { url: null });
      toast.success("Logo removed");
    },
    onError: (err) => toast.error("Couldn't remove the logo", { description: errorMessage(err) }),
  });
}

// ---------- scrim poster ----------
function settleScrimPoster(qc: QueryClient, scrimId: string, url: string | null) {
  qc.setQueryData<Scrim>(["manager", "scrim", scrimId], (s) => (s ? { ...s, posterUrl: url } : s));
  qc.setQueryData<Scrim[]>(["manager", "scrims"], (list) => list?.map((s) => (s.id === scrimId ? { ...s, posterUrl: url } : s)));
  void qc.invalidateQueries({ queryKey: ["manager", "scrims"] });
  void qc.invalidateQueries({ queryKey: ["manager", "scrim", scrimId] });
  void qc.invalidateQueries({ queryKey: ["manager", "schedule"] });
  void qc.invalidateQueries({ queryKey: ["manager", "session"] });
  void qc.invalidateQueries({ queryKey: ["manager", "dashboard"] });
}

export function useScrimPoster(scrimId: string) {
  const qc = useQueryClient();
  const upload = useMutation({
    mutationFn: (file: File) => uploadImage(`/api/manager/scrims/${scrimId}/poster`, file),
    onSuccess: (res) => {
      settleScrimPoster(qc, scrimId, res.url);
      toast.success("Poster updated", { description: "Teams will see it on this scrim." });
    },
    onError: (err) => toast.error("Couldn't upload the poster", { description: errorMessage(err) }),
  });
  const remove = useMutation({
    mutationFn: () => api.del<ImageUrlResponse>(`/api/manager/scrims/${scrimId}/poster`),
    onSuccess: () => {
      settleScrimPoster(qc, scrimId, null);
      toast.success("Poster removed");
    },
    onError: (err) => toast.error("Couldn't remove the poster", { description: errorMessage(err) }),
  });
  return { upload, remove, pending: upload.isPending || remove.isPending };
}

// ---------- tournament poster ----------
function settleTournamentPoster(qc: QueryClient, tournamentId: string, url: string | null) {
  qc.setQueryData<ManagerTournamentDetail>(["manager", "tournaments", "detail", tournamentId], (t) => (t ? { ...t, posterUrl: url } : t));
  void qc.invalidateQueries({ queryKey: ["manager", "tournaments"] });
}

export function useTournamentPoster(tournamentId: string) {
  const qc = useQueryClient();
  const upload = useMutation({
    mutationFn: (file: File) => uploadImage(`/api/manager/tournaments/${tournamentId}/poster`, file),
    onSuccess: (res) => {
      settleTournamentPoster(qc, tournamentId, res.url);
      toast.success("Poster updated", { description: "Teams will see it on this tournament." });
    },
    onError: (err) => toast.error("Couldn't upload the poster", { description: errorMessage(err) }),
  });
  const remove = useMutation({
    mutationFn: () => api.del<ImageUrlResponse>(`/api/manager/tournaments/${tournamentId}/poster`),
    onSuccess: () => {
      settleTournamentPoster(qc, tournamentId, null);
      toast.success("Poster removed");
    },
    onError: (err) => toast.error("Couldn't remove the poster", { description: errorMessage(err) }),
  });
  return { upload, remove, pending: upload.isPending || remove.isPending };
}
