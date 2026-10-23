import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ApiError,
  type ApiErrorBody,
  type ListResponse,
  type MatchDetail,
  type MatchSummary,
  type SaveLineupInput,
  type LiveAutoInput,
  type SaveLiveTeamInput,
  type SaveResultsInput,
  type ScreenshotKind,
  type ScreenshotRow,
  type StudioLinkLive,
} from "@7xen/shared";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/query";
import { errorMessage } from "@/features/manager/api";

export const matchKeys = {
  all: ["manager", "matches"] as const,
  session: (scrimId: string, date: string) => ["manager", "matches", "session", scrimId, date] as const,
  detail: (matchId: string) => ["manager", "matches", "detail", matchId] as const,
  live: (matchId: string) => ["manager", "matches", "live", matchId] as const,
  standingsAll: ["manager", "standings"] as const,
  standings: (scrimId: string, date: string) => ["manager", "standings", scrimId, date] as const,
};

/** Screenshot image URL (cookie-authenticated, same origin). */
export const screenshotUrl = (id: string) => `/api/manager/screenshots/${id}/image`;

const isWorking = (s: { status: ScreenshotRow["status"] }) => s.status === "QUEUED" || s.status === "PROCESSING";

// ---------- queries ----------
export function useSessionMatches(scrimId: string | undefined, date: string | undefined, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: matchKeys.session(scrimId ?? "", date ?? ""),
    queryFn: async () =>
      (await api.get<ListResponse<MatchSummary>>(`/api/manager/scrims/${scrimId}/sessions/${date}/matches`)).items,
    enabled: !!scrimId && !!date && (opts.enabled ?? true),
    refetchInterval: (q) => (q.state.data?.some((m) => m.screenshotCounts.processing > 0) ? 4_000 : 30_000),
  });
}

export function useMatch(matchId: string | undefined) {
  return useQuery({
    queryKey: matchKeys.detail(matchId ?? ""),
    queryFn: () => api.get<MatchDetail>(`/api/manager/matches/${matchId}`),
    enabled: !!matchId,
    // poll every 2s while the reader is still working on a screenshot
    refetchInterval: (q) => (q.state.data?.screenshots.some(isWorking) ? 2_000 : false),
  });
}

/** Live team status (what the studio's Team Status board shows). Polls so a second device stays in step. */
export function useLiveStatus(matchId: string, enabled = true) {
  return useQuery({
    queryKey: matchKeys.live(matchId),
    queryFn: () => api.get<StudioLinkLive>(`/api/manager/matches/${matchId}/team-status`),
    enabled,
    refetchInterval: 5_000,
  });
}

// ---------- helpers ----------
function settleMatch(qc: QueryClient, detail?: MatchDetail) {
  if (detail) qc.setQueryData(matchKeys.detail(detail.match.id), detail);
  void qc.invalidateQueries({ queryKey: ["manager", "matches", "session"] });
  void qc.invalidateQueries({ queryKey: matchKeys.standingsAll });
}

/** Upload with progress (multipart; the JSON client can't send files). */
export function uploadScreenshots(
  matchId: string,
  kind: ScreenshotKind,
  files: File[],
  onProgress?: (pct: number) => void,
): Promise<ScreenshotRow[]> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("kind", kind);
    for (const f of files) form.append("files", f, f.name);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/manager/matches/${matchId}/screenshots`);
    xhr.withCredentials = true;
    xhr.responseType = "text";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new ApiError(0, "INTERNAL", "Can't reach the server. Check your connection and try again."));
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve((data as ListResponse<ScreenshotRow> | null)?.items ?? []);
        return;
      }
      const err = (data as ApiErrorBody | null)?.error;
      if (xhr.status === 401) queryClient.setQueryData(["auth", "me"], null);
      reject(
        new ApiError(
          xhr.status,
          err?.code ?? "INTERNAL",
          err?.message ?? (xhr.status === 413 ? "That file is too big. Each screenshot must be under 10 MB." : "Upload failed. Please try again."),
          err?.fields,
        ),
      );
    };
    xhr.send(form);
  });
}

export function useUploadScreenshots(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, files, onProgress }: { kind: ScreenshotKind; files: File[]; onProgress?: (pct: number) => void }) =>
      uploadScreenshots(matchId, kind, files, onProgress),
    onSuccess: (rows, vars) => {
      qc.setQueryData<MatchDetail>(matchKeys.detail(matchId), (d) => {
        if (!d) return d;
        const known = new Set(d.screenshots.map((s) => s.id));
        return { ...d, screenshots: [...d.screenshots, ...rows.filter((r) => !known.has(r.id))] };
      });
      const skipped = vars.files.length - rows.length;
      toast.success(rows.length === 1 ? "Screenshot uploaded — reading it now" : `${rows.length} screenshots uploaded — reading them now`, {
        description: skipped > 0 ? `${skipped} duplicate${skipped === 1 ? " was" : "s were"} skipped (already uploaded).` : undefined,
      });
    },
    onError: (err) => toast.error("Upload failed", { description: errorMessage(err) }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: matchKeys.detail(matchId) });
      void qc.invalidateQueries({ queryKey: ["manager", "matches", "session"] });
    },
  });
}

export function useRetryScreenshot(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<ScreenshotRow>(`/api/manager/screenshots/${id}/retry`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: matchKeys.detail(matchId) });
      const prev = qc.getQueryData<MatchDetail>(matchKeys.detail(matchId));
      qc.setQueryData<MatchDetail>(matchKeys.detail(matchId), (d) =>
        d ? { ...d, screenshots: d.screenshots.map((s) => (s.id === id ? { ...s, status: "QUEUED", error: null } : s)) } : d,
      );
      return { prev };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(matchKeys.detail(matchId), ctx.prev);
      toast.error("Couldn't retry", { description: errorMessage(err) });
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: matchKeys.detail(matchId) }),
  });
}

export function useDeleteScreenshot(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/manager/screenshots/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: matchKeys.detail(matchId) });
      const prev = qc.getQueryData<MatchDetail>(matchKeys.detail(matchId));
      qc.setQueryData<MatchDetail>(matchKeys.detail(matchId), (d) =>
        d ? { ...d, screenshots: d.screenshots.filter((s) => s.id !== id) } : d,
      );
      return { prev };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(matchKeys.detail(matchId), ctx.prev);
      toast.error("Couldn't delete the screenshot", { description: errorMessage(err) });
    },
    onSuccess: () => toast.success("Screenshot deleted"),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: matchKeys.detail(matchId) });
      void qc.invalidateQueries({ queryKey: ["manager", "matches", "session"] });
    },
  });
}

export function useSaveLineup(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveLineupInput) => api.put<MatchDetail>(`/api/manager/matches/${matchId}/lineup`, input),
    onSuccess: (d, input) => {
      settleMatch(qc, d);
      toast.success(input.confirm ? "Lineup confirmed — match is in progress" : "Lineup saved", {
        description: input.confirm ? "When the match ends, upload the final results screenshots." : undefined,
      });
    },
    onError: (err) => toast.error("Couldn't save the lineup", { description: errorMessage(err) }),
  });
}

export function useSaveResults(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveResultsInput & { silent?: boolean }) => {
      const { silent: _s, ...body } = input;
      return api.put<MatchDetail>(`/api/manager/matches/${matchId}/results`, body);
    },
    onSuccess: (d, vars) => {
      settleMatch(qc, d);
      if (!vars.silent) toast.success("Draft saved", { description: "Teams can't see it until you publish." });
    },
    onError: (err, vars) => {
      if (!vars.silent) toast.error("Couldn't save the results", { description: errorMessage(err) });
    },
  });
}

export function usePublishMatch(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<MatchDetail>(`/api/manager/matches/${matchId}/publish`),
    onSuccess: (d) => {
      settleMatch(qc, d);
      toast.success("Results published!", { description: "Teams can see the scorecard and the points table now." });
    },
    onError: (err) => toast.error("Couldn't publish", { description: errorMessage(err) }),
  });
}

export function useUnpublishMatch(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<MatchDetail>(`/api/manager/matches/${matchId}/unpublish`),
    onSuccess: (d) => {
      settleMatch(qc, d);
      toast.success("Results hidden from teams", { description: "Fix what you need, then publish again." });
    },
    onError: (err) => toast.error("Couldn't unpublish", { description: errorMessage(err) }),
  });
}

export function useSaveLiveTeam(matchId: string) {
  const qc = useQueryClient();
  const key = matchKeys.live(matchId);
  return useMutation({
    mutationFn: (input: SaveLiveTeamInput) => api.patch<StudioLinkLive>(`/api/manager/matches/${matchId}/team-status`, input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<StudioLinkLive>(key);
      qc.setQueryData<StudioLinkLive>(key, (d) =>
        d
          ? {
              ...d,
              teams: d.teams.map((t) =>
                t.id === input.teamId
                  ? {
                      ...t,
                      status: input.players.filter((s) => s === "alive").length,
                      players: t.players.map((p, i) => ({ ...p, state: input.players[i] ?? p.state })),
                    }
                  : t,
              ),
            }
          : d,
      );
      return { prev };
    },
    onSuccess: (d) => qc.setQueryData(key, d),
    onError: (err, _input, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error("Couldn't update the player", { description: errorMessage(err) });
    },
  });
}

export function useSetAutoPaused(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LiveAutoInput) => api.patch<StudioLinkLive>(`/api/manager/matches/${matchId}/team-status/auto`, input),
    onSuccess: (d, input) => {
      qc.setQueryData(matchKeys.live(matchId), d);
      toast.success(input.paused ? "Auto updates paused" : "Auto updates back on", {
        description: input.paused ? "Captures still arrive, but only your taps change the board." : undefined,
      });
    },
    onError: (err) => toast.error("Couldn't change auto updates", { description: errorMessage(err) }),
  });
}
