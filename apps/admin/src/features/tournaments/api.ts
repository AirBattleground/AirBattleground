import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ListResponse,
  ManagerTournamentDetail,
  PromoteInput,
  PromotionPreview,
  StageDetail,
  TournamentEntryRow,
  TournamentSummary,
} from "@7xen/shared";
import { api } from "@/lib/api";

/** Admin mirrors every manager tournament endpoint under this prefix (ownership not checked). */
const BASE = "/api/admin/tournaments";
const tournamentsKey = ["admin", "tournaments"] as const;

export function useAdminTournaments(opts: { refetchInterval?: number } = {}) {
  return useQuery({
    queryKey: tournamentsKey,
    queryFn: () => api.get<ListResponse<TournamentSummary>>(BASE),
    placeholderData: keepPreviousData,
    refetchInterval: opts.refetchInterval,
  });
}

export function useAdminTournament(id: string | undefined) {
  return useQuery({
    queryKey: [...tournamentsKey, id],
    queryFn: () => api.get<ManagerTournamentDetail>(`${BASE}/${id}`),
    enabled: !!id,
  });
}

export function useTournamentEntries(id: string | undefined) {
  return useQuery({
    queryKey: [...tournamentsKey, id, "entries"],
    queryFn: () => api.get<ListResponse<TournamentEntryRow>>(`${BASE}/${id}/entries`),
    enabled: !!id,
  });
}

export function useStageDetail(id: string | undefined, stageId: string | null | undefined) {
  return useQuery({
    queryKey: [...tournamentsKey, id, "stage", stageId],
    queryFn: () => api.get<StageDetail>(`${BASE}/${id}/stages/${stageId}`),
    enabled: !!id && !!stageId,
  });
}

export function usePromotionPreview(id: string | undefined, stageId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: [...tournamentsKey, id, "promotion", stageId],
    queryFn: () => api.get<PromotionPreview>(`${BASE}/${id}/stages/${stageId}/promotion`),
    enabled: !!id && !!stageId && enabled,
  });
}

export type TournamentAction = "publish" | "close-registration" | "reopen-registration" | "cancel" | "complete";

/** Every admin action invalidates the whole tournaments tree (list, detail, entries, stages). */
function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: tournamentsKey });
}

export function useTournamentAction(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (action: TournamentAction) => api.post<ManagerTournamentDetail>(`${BASE}/${id}/${action}`),
    onSuccess: () => invalidate(),
  });
}

export function useRemoveEntry(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (entryId: string) => api.del<void>(`${BASE}/${id}/entries/${entryId}`),
    onSuccess: () => invalidate(),
  });
}

export function usePromote(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ stageId, input }: { stageId: string; input: PromoteInput }) =>
      api.post<ManagerTournamentDetail>(`${BASE}/${id}/stages/${stageId}/promote`, input),
    onSuccess: () => invalidate(),
  });
}
