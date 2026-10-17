import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, type AdminRecordingRow, type AppRelease, type AppSettings, type ListResponse, type Recipe, type RecipeKey, type RecordingStatus, type SaveRecipeInput, type UpdateSettingsInput } from "@7xen/shared";
import { api } from "@/lib/api";

export type { AdminRecordingRow };

export const managerName = (r: AdminRecordingRow): string => r.manager?.displayName ?? "Unknown manager";

export const mappKeys = {
  all: ["admin", "manager-app"] as const,
  recordings: (f: { status?: string; q?: string }) => ["admin", "manager-app", "recordings", f] as const,
  recordingsAll: ["admin", "manager-app", "recordings"] as const,
  settings: ["admin", "manager-app", "settings"] as const,
  recipes: ["admin", "manager-app", "recipes"] as const,
  release: ["admin", "manager-app", "release"] as const,
};

export const adminVideoUrl = (id: string) => `/api/admin/recordings/${id}/video`;
export const adminPosterUrl = (id: string) => `/api/admin/recordings/${id}/poster`;

/** An API without these endpoints yet behaves like "nothing yet". */
async function orEmpty<T>(p: Promise<T>, empty: T): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405 || e.status === 501)) return empty;
    throw e;
  }
}

const busy = (s: RecordingStatus) => s === "LIVE" || s === "STOPPED" || s === "UPLOADING" || s === "PROCESSING";

export function useAdminRecordings(f: { status?: RecordingStatus | ""; q?: string } = {}) {
  const filters = { status: f.status || undefined, q: f.q?.trim() || undefined };
  return useQuery({
    queryKey: mappKeys.recordings(filters),
    queryFn: () => orEmpty(api.get<ListResponse<AdminRecordingRow>>("/api/admin/recordings", filters), { items: [] }),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (q.state.data?.items.some((r) => busy(r.status)) ? 5_000 : 60_000),
  });
}

export function useDeleteRecording() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/admin/recordings/${id}`),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: mappKeys.recordingsAll }), qc.invalidateQueries({ queryKey: mappKeys.settings })]),
  });
}

export function useAppSettings(opts: { refetchInterval?: number } = {}) {
  return useQuery({
    queryKey: mappKeys.settings,
    queryFn: () => orEmpty<AppSettings | null>(api.get<AppSettings>("/api/admin/settings"), null),
    refetchInterval: opts.refetchInterval,
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSettingsInput) => api.patch<AppSettings>("/api/admin/settings", input),
    onSuccess: (s) => qc.setQueryData(mappKeys.settings, s),
  });
}

export function useAdminRecipes() {
  return useQuery({
    queryKey: mappKeys.recipes,
    queryFn: () => orEmpty(api.get<ListResponse<Recipe>>("/api/admin/recipes"), { items: [] }),
  });
}

export function useSaveRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, input }: { key: RecipeKey; input: SaveRecipeInput }) => api.put<Recipe>(`/api/admin/recipes/${key}`, input),
    onSettled: () => qc.invalidateQueries({ queryKey: mappKeys.recipes }),
  });
}

export function useDeleteRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/admin/recipes/${id}`),
    onSettled: () => qc.invalidateQueries({ queryKey: mappKeys.recipes }),
  });
}

export function useLatestRelease() {
  return useQuery({
    queryKey: mappKeys.release,
    queryFn: () => orEmpty<AppRelease | null>(api.get<AppRelease | null>("/api/app/manager/latest"), null).then((r) => r ?? null),
    staleTime: 5 * 60_000,
  });
}
