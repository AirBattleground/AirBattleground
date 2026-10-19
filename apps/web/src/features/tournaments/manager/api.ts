import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  type CreateTournamentInput,
  type DisqualifyInput,
  type DrawInput,
  type GroupMovesInput,
  type InviteTeamInput,
  type ListResponse,
  type ManagerTournamentDetail,
  type PromoteInput,
  type PromotionPreview,
  type RescheduleMatchInput,
  type ScheduleConfig,
  type StageDetail,
  type TeamSummary,
  type TournamentEntryRow,
  type TournamentSummary,
  type UpdateTournamentInput,
} from "@7xen/shared";
import { api } from "@/lib/api";
import { errorMessage } from "@/features/manager/api";

export { errorMessage };

const BASE = "/api/manager/tournaments";

export const tKeys = {
  all: ["manager", "tournaments"] as const,
  list: ["manager", "tournaments", "list"] as const,
  detail: (id: string) => ["manager", "tournaments", "detail", id] as const,
  entries: (id: string) => ["manager", "tournaments", "entries", id] as const,
  stageAll: ["manager", "tournaments", "stage"] as const,
  stage: (id: string, stageId: string) => ["manager", "tournaments", "stage", id, stageId] as const,
  promotion: (id: string, stageId: string) => ["manager", "tournaments", "promotion", id, stageId] as const,
  teamSearch: (q: string) => ["manager", "tournaments", "team-search", q] as const,
};

/** Any change can ripple (counts, next action, stage status) — refresh every tournament view. */
function settle(qc: QueryClient, detail?: ManagerTournamentDetail) {
  if (detail) qc.setQueryData(tKeys.detail(detail.id), detail);
  void qc.invalidateQueries({ queryKey: tKeys.all });
}

function settleStage(qc: QueryClient, s: StageDetail) {
  qc.setQueryData(tKeys.stage(s.tournament.id, s.stage.id), s);
  void qc.invalidateQueries({ queryKey: tKeys.detail(s.tournament.id) });
  void qc.invalidateQueries({ queryKey: tKeys.list });
  void qc.invalidateQueries({ queryKey: ["manager", "tournaments", "promotion", s.tournament.id] });
}

// ---------- queries ----------
export function useTournaments() {
  return useQuery({
    queryKey: tKeys.list,
    queryFn: async () => (await api.get<ListResponse<TournamentSummary>>(BASE)).items,
  });
}

export function useTournament(id: string | undefined) {
  return useQuery({
    queryKey: tKeys.detail(id ?? ""),
    queryFn: () => api.get<ManagerTournamentDetail>(`${BASE}/${id}`),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.status === "REGISTRATION_OPEN" || q.state.data?.status === "LIVE" ? 30_000 : false),
  });
}

export function useEntries(id: string | undefined) {
  return useQuery({
    queryKey: tKeys.entries(id ?? ""),
    queryFn: async () => (await api.get<ListResponse<TournamentEntryRow>>(`${BASE}/${id}/entries`)).items,
    enabled: !!id,
    refetchInterval: 30_000,
  });
}

export function useStage(id: string | undefined, stageId: string | undefined) {
  return useQuery({
    queryKey: tKeys.stage(id ?? "", stageId ?? ""),
    queryFn: () => api.get<StageDetail>(`${BASE}/${id}/stages/${stageId}`),
    enabled: !!id && !!stageId,
    refetchInterval: (q) => (q.state.data?.stage.status === "LIVE" ? 20_000 : false),
  });
}

export function usePromotion(id: string | undefined, stageId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: tKeys.promotion(id ?? "", stageId ?? ""),
    queryFn: () => api.get<PromotionPreview>(`${BASE}/${id}/stages/${stageId}/promotion`),
    enabled: !!id && !!stageId && enabled,
  });
}

/** Team search for invites: `GET /api/manager/teams?q=` (active teams, max 20). */
export function useTeamSearch(q: string, enabled: boolean) {
  return useQuery({
    queryKey: tKeys.teamSearch(q),
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<TeamSummary[]> => {
      const res = await api.get<ListResponse<TeamSummary>>("/api/manager/teams", { q: q || undefined });
      return res.items.map((t) => ({ id: t.id, name: t.name, tag: t.tag }));
    },
  });
}

// ---------- tournament mutations ----------
export function useCreateTournament() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTournamentInput) => api.post<ManagerTournamentDetail>(BASE, input),
    onSuccess: (d) => settle(qc, d),
  });
}

export function useUpdateTournament(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTournamentInput) => api.patch<ManagerTournamentDetail>(`${BASE}/${id}`, input),
    onSuccess: (d) => settle(qc, d),
  });
}

export type TournamentAction = "publish" | "close-registration" | "reopen-registration" | "cancel" | "complete";

/** Publish a tournament by id (used right after creating it, when the id isn't known up front). */
export function usePublishTournament() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<ManagerTournamentDetail>(`${BASE}/${id}/publish`),
    onSuccess: (d) => settle(qc, d),
  });
}

const ACTION_TOASTS: Record<TournamentAction, string> = {
  publish: "Published — teams can register now",
  "close-registration": "Registration closed",
  "reopen-registration": "Registration is open again",
  cancel: "Tournament cancelled",
  complete: "Tournament complete — congratulations to the champion!",
};

export function useTournamentAction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: TournamentAction) => api.post<ManagerTournamentDetail>(`${BASE}/${id}/${action}`),
    onSuccess: (d, action) => {
      settle(qc, d);
      toast.success(ACTION_TOASTS[action], { description: d.title });
    },
    onError: (err) => toast.error("That didn't work", { description: errorMessage(err) }),
  });
}

export function useRemoveEntry(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entry: TournamentEntryRow) => api.del(`${BASE}/${id}/entries/${entry.id}`),
    onMutate: async (entry) => {
      await qc.cancelQueries({ queryKey: tKeys.entries(id) });
      const prev = qc.getQueryData<TournamentEntryRow[]>(tKeys.entries(id));
      qc.setQueryData<TournamentEntryRow[]>(tKeys.entries(id), (l) => l?.filter((e) => e.id !== entry.id));
      return { prev };
    },
    onError: (err, entry, ctx) => {
      if (ctx?.prev) qc.setQueryData(tKeys.entries(id), ctx.prev);
      toast.error(`Couldn't remove ${entry.team.name}`, { description: errorMessage(err) });
    },
    onSuccess: (_r, entry) => toast.success(`Removed ${entry.team.name}`, { description: entry.status === "CONFIRMED" ? "The next team on the waitlist (if any) takes the spot." : undefined }),
    onSettled: () => void qc.invalidateQueries({ queryKey: tKeys.all }),
  });
}

export function useInviteTeam(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: InviteTeamInput) => api.post<TournamentEntryRow>(`${BASE}/${id}/invites`, input),
    onSuccess: (row) => {
      toast.success(`Invited ${row.team.name}`, { description: `They start at stage ${row.entryStage}.` });
      void qc.invalidateQueries({ queryKey: tKeys.all });
    },
    onError: (err) => toast.error("Couldn't invite the team", { description: errorMessage(err) }),
  });
}

// ---------- stage mutations ----------
function useStageMutation<V>(fn: (v: V) => Promise<StageDetail>, fail: string, ok?: (s: StageDetail, v: V) => string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (s, v) => {
      settleStage(qc, s);
      const msg = ok?.(s, v);
      if (msg) toast.success(msg);
    },
    onError: (err) => toast.error(fail, { description: errorMessage(err) }),
  });
}

export function useSaveSchedule(id: string, stageId: string) {
  return useStageMutation<ScheduleConfig>(
    (cfg) => api.put<StageDetail>(`${BASE}/${id}/stages/${stageId}/schedule`, cfg),
    "Couldn't save the schedule",
    () => "Schedule saved",
  );
}

/** Draw (or redraw) groups. No toast on success — the page plays the draw reveal instead. */
export function useDraw(id: string, stageId: string) {
  return useStageMutation<DrawInput & { redraw?: boolean }>(
    ({ redraw, ...input }) => api.post<StageDetail>(`${BASE}/${id}/stages/${stageId}/${redraw ? "redraw" : "draw"}`, input),
    "Couldn't draw the groups",
  );
}

export function useStartStage(id: string, stageId: string) {
  return useStageMutation<void>(
    () => api.post<StageDetail>(`${BASE}/${id}/stages/${stageId}/start`),
    "Couldn't start the stage",
    (s) => `${s.stage.name} is live — good luck to every team!`,
  );
}

export function useGroupMoves(id: string, stageId: string) {
  return useStageMutation<GroupMovesInput>(
    (input) => api.patch<StageDetail>(`${BASE}/${id}/stages/${stageId}/groups`, input),
    "Couldn't move the team",
    () => "Groups updated",
  );
}

export function useRescheduleMatch(id: string) {
  return useStageMutation<RescheduleMatchInput & { matchId: string }>(
    ({ matchId, ...input }) => api.patch<StageDetail>(`${BASE}/${id}/matches/${matchId}/schedule`, input),
    "Couldn't reschedule the match",
    () => "Match rescheduled",
  );
}

export function useDisqualify(id: string, stageId: string) {
  return useStageMutation<DisqualifyInput & { team: TeamSummary }>(
    ({ team, ...input }) => api.post<StageDetail>(`${BASE}/${id}/stages/${stageId}/teams/${team.id}/disqualify`, input),
    "Couldn't disqualify the team",
    (_s, v) => `${v.team.name} was disqualified`,
  );
}

export function usePromote(id: string, stageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PromoteInput) => api.post<ManagerTournamentDetail>(`${BASE}/${id}/stages/${stageId}/promote`, input),
    onSuccess: (d) => settle(qc, d),
    onError: (err) => toast.error("Couldn't promote the teams", { description: errorMessage(err) }),
  });
}
