import { useMutation, useQueries, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ApiError,
  type CreateRegistrationInput,
  type ListResponse,
  type RegistrationStatus,
  type TeamDashboard,
  type TeamRegistration,
  type TeamScrimDetail,
  type TeamScrimOnDate,
} from "@7xen/shared";
import { api } from "@/lib/api";
import { invalidateSuggestions } from "@/features/player/api";

export type RegistrationScope = "upcoming" | "past";

const teamKeys = {
  all: ["team"] as const,
  dashboard: ["team", "dashboard"] as const,
  scrimsAll: ["team", "scrims"] as const,
  scrims: (date: string) => ["team", "scrims", date] as const,
  registrationsAll: ["team", "registrations"] as const,
  registrations: (scope: RegistrationScope) => ["team", "registrations", scope] as const,
  // not under "scrims": register/cancel rewrite those cached lists in place
  scrimDetailAll: ["team", "scrim-detail"] as const,
  scrimDetail: (scrimId: string, date: string) => ["team", "scrim-detail", scrimId, date] as const,
};

/** How often approvals are polled so they show up without a refresh. */
export const POLL_MS = 30_000;

// ---------------------------------------------------------------------------
// Approval watcher: remembers the last status seen for every registration (across
// all team queries) and celebrates when one flips PENDING → APPROVED between polls.
// ---------------------------------------------------------------------------
const lastSeen = new Map<string, RegistrationStatus>();

function track(id: string, status: RegistrationStatus, slot: number | null, title: string) {
  if (id.startsWith("optimistic")) return;
  const prev = lastSeen.get(id);
  lastSeen.set(id, status);
  if (prev !== "PENDING" || prev === status) return;
  if (status === "APPROVED") {
    const slotText = slot != null ? `Slot #${String(slot).padStart(2, "0")}` : "a slot";
    toast.success(`You got ${slotText} in ${title}!`, {
      id: `approved-${id}`,
      description: "Your team is in. See you in the room!",
      duration: 10_000,
    });
  } else if (status === "REJECTED") {
    toast.error(`Your request for ${title} was not accepted`, {
      id: `rejected-${id}`,
      description: "Check My registrations for the reason, or try another scrim.",
      duration: 8_000,
    });
  }
}

function trackRegistrations(items: TeamRegistration[]) {
  for (const r of items) track(r.id, r.status, r.slotNumber, r.scrim.title);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
export function useTeamDashboard(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: teamKeys.dashboard,
    enabled: opts.enabled ?? true,
    queryFn: async () => {
      const d = await api.get<TeamDashboard>("/api/team/dashboard");
      trackRegistrations(d.nextMatch ? [d.nextMatch, ...d.upcoming] : d.upcoming);
      return d;
    },
    refetchInterval: POLL_MS,
  });
}

async function fetchScrims(date: string) {
  const res = await api.get<ListResponse<TeamScrimOnDate>>("/api/team/scrims", { date });
  for (const s of res.items) {
    if (s.myRegistration) track(s.myRegistration.id, s.myRegistration.status, s.myRegistration.slotNumber, s.scrim.title);
  }
  return res.items;
}

export function useTeamScrims(date: string) {
  return useQuery({ queryKey: teamKeys.scrims(date), queryFn: () => fetchScrims(date), refetchInterval: POLL_MS });
}

/** Scrims for several days at once (same cache as useTeamScrims): per-day lists + loading/error. */
export function useTeamScrimsForDays(dates: string[]) {
  return useQueries({
    queries: dates.map((date) => ({ queryKey: teamKeys.scrims(date), queryFn: () => fetchScrims(date), refetchInterval: POLL_MS })),
    combine: (results) => ({
      byDate: new Map(dates.map((d, i) => [d, results[i]?.data])),
      isLoading: results.some((r) => r.isLoading),
      isError: results.every((r) => r.isError),
      error: results.find((r) => r.error)?.error ?? null,
      refetch: () => results.forEach((r) => void r.refetch()),
    }),
  });
}

export function useMyRegistrations(scope: RegistrationScope, opts: { poll?: boolean } = {}) {
  const poll = opts.poll ?? scope === "upcoming";
  return useQuery({
    queryKey: teamKeys.registrations(scope),
    queryFn: async () => {
      const res = await api.get<ListResponse<TeamRegistration>>("/api/team/registrations", { scope });
      if (scope === "upcoming") trackRegistrations(res.items);
      return res.items;
    },
    refetchInterval: poll ? POLL_MS : false,
  });
}

/** Scrim detail page: one scrim on one date ("" = its next date). Polled like the lists so approvals and rooms show up. */
export function useTeamScrimDetail(scrimId: string, date: string) {
  return useQuery({
    queryKey: teamKeys.scrimDetail(scrimId, date),
    queryFn: () => api.get<TeamScrimDetail>(`/api/team/scrims/${scrimId}${date ? `?date=${date}` : ""}`),
    refetchInterval: POLL_MS,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
function invalidateTeam(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: teamKeys.dashboard });
  void qc.invalidateQueries({ queryKey: teamKeys.registrationsAll });
  void qc.invalidateQueries({ queryKey: teamKeys.scrimsAll });
  void qc.invalidateQueries({ queryKey: teamKeys.scrimDetailAll });
}

/** Phase 5: the player isn't in a team / isn't its leader (the session refreshes itself; see lib/query). */
export function teamAccessToast(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.code === "LEADER_ONLY") {
    toast.error("Only your team leader can do this", { description: "Tap “Ask my leader” instead — they'll get it on their home screen." });
    return true;
  }
  if (err.code === "NO_TEAM") {
    toast.error("You're not in a team", { description: "Create a team or join one with an invite code first." });
    return true;
  }
  return false;
}

function registerErrorToast(err: unknown) {
  if (teamAccessToast(err)) return;
  if (err instanceof ApiError) {
    switch (err.code) {
      case "REGISTRATION_CLOSED":
        toast.error("Registration closed", { description: err.message || "This scrim is no longer taking teams." });
        return;
      case "CONFLICT":
        toast.error("Already registered", { description: err.message || "Your team is already in this scrim." });
        return;
      case "SLOTS_FULL":
        toast.error("Scrim is full", { description: err.message || "Every slot is taken. Try another scrim." });
        return;
      case "FORBIDDEN":
        toast.error("Can't join this scrim", { description: err.message });
        return;
      case "NOT_FOUND":
        toast.error("Scrim not found", { description: err.message || "This scrim may have been removed by the organiser." });
        return;
      default:
        toast.error("Couldn't register", { description: err.message });
        return;
    }
  }
  toast.error("Couldn't register", { description: "Something went wrong. Please try again." });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRegistrationInput) => api.post<TeamRegistration>("/api/team/registrations", input),
    // no optimistic row: the slot number comes from the server, which hands it out straight away
    onError: (err) => registerErrorToast(err),
    onSuccess: (reg, input) => {
      lastSeen.set(reg.id, reg.status);
      qc.setQueryData<TeamScrimOnDate[]>(teamKeys.scrims(input.date), (list) =>
        list?.map((s) =>
          s.scrim.id === input.scrimId ? { ...s, myRegistration: { id: reg.id, status: reg.status, slotNumber: reg.slotNumber, rejectionReason: reg.rejectionReason } } : s,
        ),
      );
      toast.success(reg.slotNumber != null ? `You're in! Slot #${String(reg.slotNumber).padStart(2, "0")}` : "You're in!", {
        description: "See you in the lobby.",
      });
      invalidateSuggestions(qc);
    },
    onSettled: () => invalidateTeam(qc),
  });
}

export function useCancelRegistration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; wasApproved?: boolean; title?: string }) => api.del(`/api/team/registrations/${vars.id}`),
    onMutate: async (vars) => {
      // optimistically clear it from every cached scrims list
      await qc.cancelQueries({ queryKey: teamKeys.scrimsAll });
      const snapshots = qc.getQueriesData<TeamScrimOnDate[]>({ queryKey: teamKeys.scrimsAll });
      for (const [key, list] of snapshots) {
        if (!list) continue;
        qc.setQueryData<TeamScrimOnDate[]>(
          key,
          list.map((s) =>
            s.myRegistration?.id === vars.id
              ? {
                  ...s,
                  myRegistration: null,
                  counts: {
                    ...s.counts,
                    pending: Math.max(0, s.counts.pending - (s.myRegistration.status === "PENDING" ? 1 : 0)),
                    approved: Math.max(0, s.counts.approved - (s.myRegistration.status === "APPROVED" ? 1 : 0)),
                    slotsLeft: s.counts.slotsLeft + (s.myRegistration.status === "APPROVED" ? 1 : 0),
                  },
                }
              : s,
          ),
        );
      }
      return { snapshots };
    },
    onError: (err, _vars, ctx) => {
      for (const [key, list] of ctx?.snapshots ?? []) qc.setQueryData(key, list);
      if (teamAccessToast(err)) return;
      const msg = err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
      toast.error("Couldn't cancel", { description: msg });
    },
    onSuccess: (_d, vars) => {
      lastSeen.set(vars.id, "CANCELLED");
      toast.success(vars.wasApproved ? "Cancelled — your slot was released." : "Request cancelled.", {
        description: vars.title,
      });
    },
    onSettled: () => invalidateTeam(qc),
  });
}
