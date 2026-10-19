import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ApiError,
  type ListResponse,
  type MyTournamentStatus,
  type RegisterTournamentInput,
  type StageDetail,
  type TeamTournamentDetail,
  type TournamentSummary,
} from "@7xen/shared";
import { api } from "@/lib/api";
import { invalidateSuggestions } from "@/features/player/api";
import { teamAccessToast } from "@/features/team/api";

export type TournamentScope = "open" | "live" | "mine" | "completed";

export const tournamentKeys = {
  all: ["team", "tournaments"] as const,
  list: (scope: TournamentScope | "default") => ["team", "tournaments", "list", scope] as const,
  detail: (id: string) => ["team", "tournaments", "detail", id] as const,
  stage: (id: string, stageId: string) => ["team", "tournaments", "stage", id, stageId] as const,
};

const POLL_MS = 30_000;

export function useTeamTournaments(scope?: TournamentScope) {
  return useQuery({
    queryKey: tournamentKeys.list(scope ?? "default"),
    queryFn: async () => (await api.get<ListResponse<TournamentSummary>>("/api/team/tournaments", scope ? { scope } : undefined)).items,
    refetchInterval: scope === "live" || scope === "mine" ? POLL_MS : false,
  });
}

export function useTeamTournament(id: string | undefined) {
  return useQuery({
    queryKey: tournamentKeys.detail(id ?? ""),
    queryFn: () => api.get<TeamTournamentDetail>(`/api/team/tournaments/${id}`),
    enabled: !!id,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "LIVE" || s === "REGISTRATION_OPEN" ? POLL_MS : false;
    },
  });
}

export function useTeamStage(id: string | undefined, stageId: string | undefined) {
  return useQuery({
    queryKey: tournamentKeys.stage(id ?? "", stageId ?? ""),
    queryFn: () => api.get<StageDetail>(`/api/team/tournaments/${id}/stages/${stageId}`),
    enabled: !!id && !!stageId,
    refetchInterval: (q) => (q.state.data?.stage.status === "LIVE" ? POLL_MS : false),
  });
}

// ---------------------------------------------------------------------------

function errorToast(title: string, err: unknown) {
  if (teamAccessToast(err)) return;
  if (err instanceof ApiError) {
    if (err.code === "REGISTRATION_CLOSED") return toast.error("Registration closed", { description: err.message || "This tournament isn't taking teams any more." });
    if (err.code === "CONFLICT") return toast.error(title, { description: err.message || "Your team is already registered." });
    return toast.error(title, { description: err.message });
  }
  toast.error(title, { description: "Something went wrong. Please try again." });
}

function applyMe(qc: QueryClient, id: string, me: MyTournamentStatus | null) {
  qc.setQueryData<TeamTournamentDetail>(tournamentKeys.detail(id), (d) => {
    if (!d || !me) return d;
    return { ...d, me };
  });
}

function refresh(qc: QueryClient, id: string) {
  void qc.invalidateQueries({ queryKey: tournamentKeys.detail(id) });
  void qc.invalidateQueries({ queryKey: ["team", "tournaments", "list"] });
}

export function useRegisterTournament(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterTournamentInput) => api.post<MyTournamentStatus>(`/api/team/tournaments/${id}/entry`, input),
    onSuccess: (me) => {
      applyMe(qc, id, me);
      if (me.state === "WAITLISTED") {
        const pos = me.entry?.waitlistPosition;
        toast.success(`You're on the waiting list${pos ? ` (#${pos})` : ""}`, {
          description: "All spots are taken. If a team drops out before the draw, you move up automatically.",
          duration: 8000,
        });
      } else {
        toast.success("You're in! Your spot is confirmed.", { description: "We'll place you in a group and time slot at the draw.", duration: 8000 });
      }
    },
    onError: (err) => errorToast("Couldn't register", err),
    onSettled: () => {
      refresh(qc, id);
      invalidateSuggestions(qc);
    },
  });
}

export function useUpdateTournamentPreferences(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterTournamentInput) => api.put<MyTournamentStatus>(`/api/team/tournaments/${id}/entry`, input),
    onSuccess: (me) => {
      applyMe(qc, id, me);
      toast.success("Time preferences saved");
    },
    onError: (err) => errorToast("Couldn't save your preferences", err),
    onSettled: () => refresh(qc, id),
  });
}

export function useWithdrawTournament(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del(`/api/team/tournaments/${id}/entry`),
    onSuccess: () => toast.success("You've withdrawn from the tournament", { description: "Your spot was released to the next team." }),
    onError: (err) => errorToast("Couldn't withdraw", err),
    onSettled: () => refresh(qc, id),
  });
}
