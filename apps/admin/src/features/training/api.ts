import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  type ApiErrorBody,
  type ExtractionResult,
  type ExtractorStatus,
  type ListResponse,
  type ModelList,
  type ResultsLabels,
  type SampleSplit,
  type ScreenshotKind,
  type SlotListLabels,
  type StartTrainingInput,
  type TrainingRun,
  type TrainingSampleDetail,
  type TrainingSampleRow,
  type UpdateSampleInput,
} from "@7xen/shared";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/query";

export const trainingKey = ["admin", "training"] as const;
export const samplesKey = [...trainingKey, "samples"] as const;
export const sampleKey = (id: string) => [...trainingKey, "sample", id] as const;
export const modelsKey = [...trainingKey, "models"] as const;
export const runsKey = [...trainingKey, "runs"] as const;
export const extractorStatusKey = ["admin", "extractor", "status"] as const;

export const sampleImageUrl = (id: string) => `/api/admin/training/samples/${encodeURIComponent(id)}/image`;

/** multipart POST (the shared JSON client can't send files). Same error shape as the JSON client. */
async function postForm<T>(path: string, form: FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", credentials: "include", body: form });
  } catch {
    throw new ApiError(0, "INTERNAL", "Can't reach the server. Check your connection and try again.");
  }
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    if (res.status === 401) queryClient.setQueryData(["admin", "me"], null);
    throw new ApiError(res.status, err?.code ?? "INTERNAL", err?.message ?? "Something went wrong. Please try again.", err?.fields);
  }
  return data as T;
}

// ---------- extractor status ----------
export function useExtractorStatus(opts: { refetchInterval?: number } = {}) {
  return useQuery({
    queryKey: extractorStatusKey,
    queryFn: () => api.get<ExtractorStatus>("/api/admin/extractor/status"),
    refetchInterval: opts.refetchInterval ?? 15_000,
  });
}

// ---------- samples ----------
export interface SampleQuery {
  kind?: ScreenshotKind;
  split?: SampleSplit;
  q?: string;
}
export function useSamples(query: SampleQuery = {}) {
  return useQuery({
    queryKey: [...samplesKey, query],
    queryFn: () => api.get<ListResponse<TrainingSampleRow>>("/api/admin/training/samples", { kind: query.kind, split: query.split, q: query.q?.trim() || undefined }),
    placeholderData: keepPreviousData,
  });
}

export function useSample(id: string | undefined) {
  return useQuery({
    queryKey: sampleKey(id ?? ""),
    queryFn: () => api.get<TrainingSampleDetail>(`/api/admin/training/samples/${encodeURIComponent(id!)}`),
    enabled: !!id,
  });
}

function useInvalidateSamples() {
  const qc = useQueryClient();
  return (detail?: TrainingSampleDetail) => {
    if (detail) qc.setQueryData(sampleKey(detail.id), detail);
    return qc.invalidateQueries({ queryKey: samplesKey });
  };
}

export function useUpdateSample() {
  const invalidate = useInvalidateSamples();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateSampleInput }) => api.patch<TrainingSampleDetail>(`/api/admin/training/samples/${encodeURIComponent(id)}`, input),
    onSuccess: (d) => invalidate(d),
  });
}

/** Apply the same change to many samples; resolves with how many worked / failed. */
export function useBulkUpdateSamples() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, input }: { ids: string[]; input: UpdateSampleInput }) => {
      const results = await Promise.allSettled(ids.map((id) => api.patch<TrainingSampleDetail>(`/api/admin/training/samples/${encodeURIComponent(id)}`, input)));
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const firstError = results.find((r): r is PromiseRejectedResult => r.status === "rejected")?.reason as unknown;
      return { ok, failed: ids.length - ok, firstError };
    },
    onSettled: () => qc.invalidateQueries({ queryKey: trainingKey }),
  });
}

export function useDeleteSample() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/admin/training/samples/${encodeURIComponent(id)}`),
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: sampleKey(id) });
      return qc.invalidateQueries({ queryKey: samplesKey });
    },
  });
}

export function useCreateSample() {
  const invalidate = useInvalidateSamples();
  return useMutation({
    mutationFn: ({ file, kind, labels, split }: { file: File; kind: ScreenshotKind; labels: SlotListLabels | ResultsLabels; split?: SampleSplit }) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", kind);
      fd.append("labels", JSON.stringify(labels));
      if (split) fd.append("split", split);
      return postForm<TrainingSampleRow>("/api/admin/training/samples", fd);
    },
    onSuccess: () => invalidate(),
  });
}

/** Run the current model on an image (nothing is saved). */
export function previewExtraction(file: Blob, kind: ScreenshotKind, filename = "screenshot.jpg") {
  const fd = new FormData();
  fd.append("file", file, filename);
  fd.append("kind", kind);
  return postForm<ExtractionResult>("/api/admin/training/preview", fd);
}

/** Server-side re-read: labels := current model output, verified=false. */
export function usePrefillSample() {
  const invalidate = useInvalidateSamples();
  return useMutation({
    mutationFn: (id: string) => api.post<TrainingSampleDetail>(`/api/admin/training/samples/${encodeURIComponent(id)}/prefill`),
    onSuccess: (d) => invalidate(d),
  });
}

/** models + runs live in the extractor: don't call them while it's known to be offline */
const noRetryWhenOffline = (count: number, err: unknown) => !(err instanceof ApiError && err.status >= 400) && count < 2;
function useReaderOnline() {
  const status = useExtractorStatus();
  return { online: status.data?.online === true, offline: status.data?.online === false };
}

// ---------- models ----------
export function useModels() {
  const { online, offline } = useReaderOnline();
  const q = useQuery({ queryKey: modelsKey, queryFn: () => api.get<ModelList>("/api/admin/training/models"), enabled: online, retry: noRetryWhenOffline });
  return Object.assign(q, { offline: offline && !q.data });
}

export function useActivateModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (version: string) => api.post<ModelList>(`/api/admin/training/models/${encodeURIComponent(version)}/activate`),
    onSuccess: (list) => {
      qc.setQueryData(modelsKey, list);
      return qc.invalidateQueries({ queryKey: extractorStatusKey });
    },
  });
}

// ---------- runs ----------
const isLive = (r: TrainingRun) => r.status === "QUEUED" || r.status === "RUNNING";

export function useRuns() {
  const qc = useQueryClient();
  const { online, offline } = useReaderOnline();
  const q = useQuery({
    queryKey: runsKey,
    queryFn: async () => {
      const prev = qc.getQueryData<ListResponse<TrainingRun>>(runsKey);
      const next = await api.get<ListResponse<TrainingRun>>("/api/admin/training/runs");
      // a run just finished → new model version / metrics are available
      const finished = prev?.items.some((p) => isLive(p) && next.items.some((n) => n.id === p.id && !isLive(n)));
      if (finished) void Promise.all([qc.invalidateQueries({ queryKey: modelsKey }), qc.invalidateQueries({ queryKey: extractorStatusKey })]);
      return next;
    },
    refetchInterval: (q) => (q.state.data?.items.some(isLive) ? 2_000 : false),
    enabled: online,
    retry: noRetryWhenOffline,
  });
  return Object.assign(q, { offline: offline && !q.data });
}

/** true when the last status check said the reader is offline */
export const readerKnownOffline = () => queryClient.getQueryData<ExtractorStatus>(extractorStatusKey)?.online === false;

export function useStartRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StartTrainingInput) => api.post<TrainingRun>("/api/admin/training/runs", input),
    onSuccess: (run) => {
      qc.setQueryData<ListResponse<TrainingRun>>(runsKey, (old) => (old ? { ...old, items: [run, ...old.items.filter((r) => r.id !== run.id)] } : old));
      return qc.invalidateQueries({ queryKey: runsKey });
    },
  });
}
