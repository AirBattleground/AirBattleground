import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ApiError,
  type AuthConfig,
  type CreateJoinRequestInput,
  type CreatePlayerTeamInput,
  type CreateSuggestionInput,
  type ImageUrlResponse,
  type InviteByBgmiInput,
  type ListResponse,
  type MyJoinRequest,
  type MyTeamInvite,
  type PlayerProfile,
  type PlayerTeam,
  type SuggestionStatus,
  type TeamInvitePreview,
  type TeamSuggestionRow,
  type UpdatePlayerProfileInput,
  type UpdatePlayerTeamInput,
} from "@7xen/shared";
import { api } from "@/lib/api";
import { ME_KEY } from "@/lib/auth";
import { uploadImage } from "@/features/manager/branding";

export const playerKeys = {
  all: ["player"] as const,
  config: ["auth", "config"] as const,
  me: ["player", "me"] as const,
  team: ["player", "team"] as const,
  invite: (code: string) => ["player", "invite", code] as const,
  joinRequests: ["player", "join-requests"] as const,
  teamInvites: ["player", "team-invites"] as const,
  suggestionsAll: ["player", "suggestions"] as const,
  suggestions: (status: SuggestionStatus) => ["player", "suggestions", status] as const,
};

const POLL_MS = 30_000;

/** After anything that changes who is in which team: session, player data and every team screen. */
export async function refreshMembership(qc: QueryClient) {
  await qc.invalidateQueries({ queryKey: ME_KEY });
  void qc.invalidateQueries({ queryKey: playerKeys.all });
  void qc.invalidateQueries({ queryKey: ["team"] });
}

const msg = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
export const failToast = (title: string) => (err: unknown) => toast.error(title, { description: msg(err) });

// ---------------------------------------------------------------------------
// Auth config (public)
// ---------------------------------------------------------------------------
export function useAuthConfig() {
  return useQuery({
    queryKey: playerKeys.config,
    queryFn: () => api.get<AuthConfig>("/api/auth/config"),
    staleTime: 10 * 60_000,
    retry: 1,
  });
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------
export function usePlayerProfile(opts: { poll?: boolean; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: playerKeys.me,
    queryFn: () => api.get<PlayerProfile>("/api/player/me"),
    enabled: opts.enabled ?? true,
    refetchInterval: opts.poll ? 20_000 : false,
  });
}

/** Errors are left to the caller (forms map ApiError.fields / BGMI_ID_TAKEN onto inputs). */
export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdatePlayerProfileInput) => api.patch<PlayerProfile>("/api/player/me", input),
    onSuccess: async (p) => {
      qc.setQueryData(playerKeys.me, p);
      await qc.invalidateQueries({ queryKey: ME_KEY });
    },
  });
}

// ---------------------------------------------------------------------------
// My team
// ---------------------------------------------------------------------------
/** The caller's team; `null` when they aren't in one (404 NO_TEAM). */
export function usePlayerTeam(opts: { enabled?: boolean; poll?: boolean } = {}) {
  return useQuery({
    queryKey: playerKeys.team,
    queryFn: async () => {
      try {
        return await api.get<PlayerTeam>("/api/player/team");
      } catch (e) {
        if (e instanceof ApiError && (e.code === "NO_TEAM" || e.status === 404)) return null;
        throw e;
      }
    },
    enabled: opts.enabled ?? true,
    refetchInterval: opts.poll === false ? false : POLL_MS,
  });
}

function useTeamMutation<V>(fn: (v: V) => Promise<PlayerTeam | void>, ok: string | ((v: V) => string), fail: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (team, v) => {
      if (team) qc.setQueryData(playerKeys.team, team);
      toast.success(typeof ok === "function" ? ok(v) : ok);
      await refreshMembership(qc);
    },
    onError: failToast(fail),
  });
}

/** Create: errors left to the dialog (name taken, BGMI ID). */
export function useCreateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePlayerTeamInput) => api.post<PlayerTeam>("/api/player/team", input),
    onSuccess: async (team) => {
      qc.setQueryData(playerKeys.team, team);
      await refreshMembership(qc);
    },
  });
}

/** Rename / retag: errors left to the dialog. */
export function useUpdateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdatePlayerTeamInput) => api.patch<PlayerTeam>("/api/player/team", input),
    onSuccess: async (team) => {
      qc.setQueryData(playerKeys.team, team);
      toast.success("Team details saved");
      await refreshMembership(qc);
    },
  });
}

export const useDisbandTeam = () => useTeamMutation<void>(() => api.del("/api/player/team"), "Team disbanded", "Couldn't disband the team");
export const useRotateInvite = () =>
  useTeamMutation<void>(() => api.post<PlayerTeam>("/api/player/team/invite-code"), "New invite code ready — old links stop working", "Couldn't make a new code");
export const useLeaveTeam = () => useTeamMutation<void>(() => api.post<void>("/api/player/team/leave"), "You left the team", "Couldn't leave the team");
export const useRemoveMember = () =>
  useTeamMutation(
    (v: { userId: string; name: string }) => api.del<PlayerTeam>(`/api/player/team/members/${v.userId}`),
    (v) => `${v.name} was removed from the team`,
    "Couldn't remove this player",
  );
export const useTransferLeader = () =>
  useTeamMutation(
    (v: { userId: string; name: string }) => api.post<PlayerTeam>("/api/player/team/transfer", { userId: v.userId }),
    (v) => `${v.name} is now the team leader`,
    "Couldn't change the leader",
  );
export const useApproveJoin = () =>
  useTeamMutation(
    (v: { id: string; name: string }) => api.post<PlayerTeam>(`/api/player/team/join-requests/${v.id}/approve`),
    (v) => `${v.name} joined your team`,
    "Couldn't approve",
  );
export const useRejectJoin = () =>
  useTeamMutation(
    (v: { id: string; name: string }) => api.post<PlayerTeam>(`/api/player/team/join-requests/${v.id}/reject`),
    (v) => `Request from ${v.name} declined`,
    "Couldn't decline",
  );

// ---------------------------------------------------------------------------
// Invites & join requests
// ---------------------------------------------------------------------------
export function useInvitePreview(code: string | undefined, enabled = true) {
  return useQuery({
    queryKey: playerKeys.invite(code ?? ""),
    queryFn: () => api.get<TeamInvitePreview>(`/api/player/invites/${code}`),
    enabled: !!code && enabled,
  });
}

/** Errors left to the caller (BGMI_ID_REQUIRED, TEAM_FULL, …). */
export function useCreateJoinRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateJoinRequestInput) => api.post<MyJoinRequest>("/api/player/join-requests", input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: playerKeys.all }),
  });
}

export function useCancelJoinRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/player/join-requests/${id}`),
    onSuccess: () => {
      toast.success("Join request cancelled");
      void qc.invalidateQueries({ queryKey: playerKeys.all });
    },
    onError: failToast("Couldn't cancel the request"),
  });
}

// ---------------------------------------------------------------------------
// "Ask my leader" suggestions
// ---------------------------------------------------------------------------
export function useTeamSuggestions(status: SuggestionStatus = "OPEN", opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: playerKeys.suggestions(status),
    queryFn: async () => {
      try {
        return (await api.get<ListResponse<TeamSuggestionRow>>("/api/player/team/suggestions", { status })).items;
      } catch (e) {
        if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return [];
        throw e;
      }
    },
    enabled: opts.enabled ?? true,
    refetchInterval: POLL_MS,
  });
}

export function useCreateSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSuggestionInput) => api.post<TeamSuggestionRow>("/api/player/team/suggestions", input),
    onSuccess: (row) => {
      qc.setQueryData<TeamSuggestionRow[]>(playerKeys.suggestions("OPEN"), (list) => (list ? [row, ...list.filter((r) => r.id !== row.id)] : [row]));
      toast.success("Sent to your leader", { description: "They'll see it on their home screen and can register in one tap." });
      void qc.invalidateQueries({ queryKey: playerKeys.suggestionsAll });
      void qc.invalidateQueries({ queryKey: ["team", "scrims"] });
    },
    onError: failToast("Couldn't ask your leader"),
  });
}

export function useDismissSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<TeamSuggestionRow>(`/api/player/team/suggestions/${id}/dismiss`),
    onMutate: async (id) => {
      const key = playerKeys.suggestions("OPEN");
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<TeamSuggestionRow[]>(key);
      qc.setQueryData<TeamSuggestionRow[]>(key, (l) => l?.filter((r) => r.id !== id));
      return { prev, key };
    },
    onError: (err, _id, ctx) => {
      if (ctx) qc.setQueryData(ctx.key, ctx.prev);
      failToast("Couldn't dismiss")(err);
    },
    onSuccess: () => toast.success("Dismissed"),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: playerKeys.suggestionsAll });
      void qc.invalidateQueries({ queryKey: playerKeys.team });
    },
  });
}

/** Called after the leader registers: the API marks matching OPEN suggestions DONE. */
export function invalidateSuggestions(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: playerKeys.suggestionsAll });
  void qc.invalidateQueries({ queryKey: playerKeys.team });
}

// ---------------------------------------------------------------------------
// Team logo (leader)
// ---------------------------------------------------------------------------
export function useTeamLogo() {
  const qc = useQueryClient();
  const settle = (res: ImageUrlResponse, ok: string) => {
    qc.setQueryData<PlayerTeam | null | undefined>(playerKeys.team, (t) => (t ? { ...t, logoUrl: res.url } : t));
    void qc.invalidateQueries({ queryKey: playerKeys.team });
    toast.success(ok);
  };
  const upload = useMutation({
    mutationFn: (file: File) => uploadImage("/api/player/team/logo", file),
    onSuccess: (res) => settle(res, "Team logo updated"),
    onError: failToast("Couldn't upload the logo"),
  });
  const remove = useMutation({
    mutationFn: () => api.del<ImageUrlResponse>("/api/player/team/logo"),
    onSuccess: (res) => settle(res ?? { url: null }, "Team logo removed"),
    onError: failToast("Couldn't remove the logo"),
  });
  return { upload, remove, pending: upload.isPending || remove.isPending };
}

// ---------------------------------------------------------------------------
// Invite by BGMI ID
// ---------------------------------------------------------------------------
/** Leader: errors left to the form (unknown BGMI ID, already in a team, …). */
export function useInviteByBgmi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: InviteByBgmiInput) => api.post<PlayerTeam>("/api/player/team/invites", input),
    onSuccess: (team) => {
      qc.setQueryData(playerKeys.team, team);
      toast.success("Invite sent", { description: "They'll see it on their My team page and can accept it." });
    },
  });
}

export const useRevokeInvite = () =>
  useTeamMutation((v: { id: string; name: string }) => api.del<PlayerTeam>(`/api/player/team/invites/${v.id}`), (v) => `Invite to ${v.name} taken back`, "Couldn't take the invite back");

/** The invitations waiting for me (a player without a team). */
export function useMyTeamInvites(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: playerKeys.teamInvites,
    queryFn: async () => (await api.get<ListResponse<MyTeamInvite>>("/api/player/team-invites")).items,
    enabled: opts.enabled ?? true,
    refetchInterval: POLL_MS,
  });
}

export function useAcceptTeamInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; team: string }) => api.post<PlayerTeam>(`/api/player/team-invites/${v.id}/accept`),
    onSuccess: async (team, v) => {
      qc.setQueryData(playerKeys.team, team);
      toast.success(`You're in ${v.team}!`, { description: "Welcome to the squad." });
      await refreshMembership(qc);
    },
    onError: async (err) => {
      failToast("Couldn't accept the invite")(err);
      void qc.invalidateQueries({ queryKey: playerKeys.teamInvites });
    },
  });
}

export function useDeclineTeamInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; team: string }) => api.post<void>(`/api/player/team-invites/${v.id}/decline`),
    onSuccess: (_r, v) => {
      toast.success(`Invite from ${v.team} declined`);
      void qc.invalidateQueries({ queryKey: playerKeys.teamInvites });
    },
    onError: failToast("Couldn't decline the invite"),
  });
}
