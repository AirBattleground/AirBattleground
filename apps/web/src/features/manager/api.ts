import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ApiError,
  type CreateScrimInput,
  type ListResponse,
  type ManagerDashboard,
  type PendingRequest,
  type Registration,
  type Scrim,
  type ScrimOnDate,
  type SessionDetail,
  type UpdateScrimInput,
} from "@7xen/shared";
import { api } from "@/lib/api";
import { slotLabel } from "./format";

const managerKeys = {
  all: ["manager"] as const,
  dashboard: ["manager", "dashboard"] as const,
  scrims: ["manager", "scrims"] as const,
  scrim: (id: string) => ["manager", "scrim", id] as const,
  scheduleAll: ["manager", "schedule"] as const,
  schedule: (date: string) => ["manager", "schedule", date] as const,
  sessionAll: ["manager", "session"] as const,
  session: (scrimId: string, date: string) => ["manager", "session", scrimId, date] as const,
  requests: ["manager", "requests"] as const,
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong. Please try again.";
}

// ---------- queries ----------
export function useDashboard() {
  return useQuery({
    queryKey: managerKeys.dashboard,
    queryFn: () => api.get<ManagerDashboard>("/api/manager/dashboard"),
  });
}

export function useScrims() {
  return useQuery({
    queryKey: managerKeys.scrims,
    queryFn: async () => (await api.get<ListResponse<Scrim>>("/api/manager/scrims")).items,
  });
}

export function useScrim(id: string | undefined) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: managerKeys.scrim(id ?? ""),
    queryFn: () => api.get<Scrim>(`/api/manager/scrims/${id}`),
    enabled: !!id,
    initialData: () => qc.getQueryData<Scrim[]>(managerKeys.scrims)?.find((s) => s.id === id),
    initialDataUpdatedAt: () => qc.getQueryState(managerKeys.scrims)?.dataUpdatedAt,
  });
}

export function useSchedule(date: string) {
  return useQuery({
    queryKey: managerKeys.schedule(date),
    queryFn: async () => (await api.get<ListResponse<ScrimOnDate>>("/api/manager/schedule", { date })).items,
    placeholderData: (prev) => prev,
  });
}

export function useSession(scrimId: string | undefined, date: string | undefined) {
  return useQuery({
    queryKey: managerKeys.session(scrimId ?? "", date ?? ""),
    queryFn: () => api.get<SessionDetail>(`/api/manager/scrims/${scrimId}/sessions/${date}`),
    enabled: !!scrimId && !!date,
    refetchInterval: 30_000,
  });
}

export function useRequests(opts: { refetchInterval?: number } = {}) {
  return useQuery({
    queryKey: managerKeys.requests,
    queryFn: async () => (await api.get<ListResponse<PendingRequest>>("/api/manager/requests")).items,
    refetchInterval: opts.refetchInterval,
  });
}

// ---------- scrim mutations ----------
function invalidateScrimViews(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: managerKeys.scrims });
  void qc.invalidateQueries({ queryKey: managerKeys.dashboard });
  void qc.invalidateQueries({ queryKey: managerKeys.scheduleAll });
  void qc.invalidateQueries({ queryKey: managerKeys.sessionAll });
  void qc.invalidateQueries({ queryKey: managerKeys.requests });
}

export function useCreateScrim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateScrimInput) => api.post<Scrim>("/api/manager/scrims", input),
    onSuccess: (scrim) => {
      qc.setQueryData(managerKeys.scrim(scrim.id), scrim);
      invalidateScrimViews(qc);
    },
  });
}

export function useUpdateScrim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateScrimInput }) =>
      api.patch<Scrim>(`/api/manager/scrims/${id}`, input),
    onSuccess: (scrim) => {
      qc.setQueryData(managerKeys.scrim(scrim.id), scrim);
      qc.setQueryData<Scrim[]>(managerKeys.scrims, (list) => list?.map((s) => (s.id === scrim.id ? scrim : s)));
      invalidateScrimViews(qc);
    },
  });
}

// ---------- registration decisions (optimistic) ----------
type Snapshot = [readonly unknown[], unknown][];

async function snapshotDecisionViews(qc: QueryClient): Promise<Snapshot> {
  await Promise.all([
    qc.cancelQueries({ queryKey: managerKeys.sessionAll }),
    qc.cancelQueries({ queryKey: managerKeys.requests }),
  ]);
  return [
    ...qc.getQueriesData({ queryKey: managerKeys.sessionAll }),
    ...qc.getQueriesData({ queryKey: managerKeys.requests }),
  ];
}

function restore(qc: QueryClient, snap: Snapshot | undefined) {
  snap?.forEach(([key, data]) => qc.setQueryData(key, data));
}

function settleDecision(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: managerKeys.dashboard });
  void qc.invalidateQueries({ queryKey: managerKeys.scheduleAll });
  void qc.invalidateQueries({ queryKey: managerKeys.requests });
  void qc.invalidateQueries({ queryKey: managerKeys.sessionAll });
}

/** Apply a change to the registration with `id` in every cached session detail. */
function patchSessions(
  qc: QueryClient,
  id: string,
  fn: (s: SessionDetail, reg: Registration) => SessionDetail,
) {
  qc.getQueriesData<SessionDetail>({ queryKey: managerKeys.sessionAll }).forEach(([key, s]) => {
    const reg = s?.registrations.find((r) => r.id === id);
    if (s && reg) qc.setQueryData(key, fn(s, reg));
  });
}

/** Remove a request from the inbox and adjust sibling counts for that session. */
function patchRequestsRemove(qc: QueryClient, id: string, approvedDelta: number) {
  qc.setQueryData<PendingRequest[]>(managerKeys.requests, (list) => {
    if (!list) return list;
    const target = list.find((r) => r.registration.id === id);
    if (!target) return list;
    return list
      .filter((r) => r.registration.id !== id)
      .map((r) =>
        r.scrim.id === target.scrim.id && r.date === target.date
          ? {
              ...r,
              counts: {
                approved: r.counts.approved + approvedDelta,
                slotsLeft: Math.max(0, r.counts.slotsLeft - approvedDelta),
              },
            }
          : r,
      );
  });
}

interface DecisionVars {
  id: string;
  teamName: string;
  /** suppress the per-item toast (bulk actions show their own summary) */
  silent?: boolean;
}

export function useApproveRegistration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: DecisionVars) => api.post<Registration>(`/api/manager/registrations/${id}/approve`),
    onMutate: async ({ id }) => {
      const snap = await snapshotDecisionViews(qc);
      patchSessions(qc, id, (s, reg) => {
        if (reg.status === "APPROVED") return s;
        const free = s.slots.find((sl) => !sl.team);
        if (!free) return s;
        const slotNumber = free.slotNumber;
        return {
          ...s,
          registrations: s.registrations.map((r) =>
            r.id === id ? { ...r, status: "APPROVED", slotNumber, decidedAt: new Date().toISOString() } : r,
          ),
          slots: s.slots.map((sl) =>
            sl.slotNumber === slotNumber
              ? { ...sl, team: { id: reg.team.id, name: reg.team.name, tag: reg.team.tag }, registrationId: id }
              : sl,
          ),
          counts: {
            pending: Math.max(0, s.counts.pending - (reg.status === "PENDING" ? 1 : 0)),
            approved: s.counts.approved + 1,
            slotsLeft: Math.max(0, s.counts.slotsLeft - 1),
          },
        };
      });
      patchRequestsRemove(qc, id, 1);
      return { snap };
    },
    onError: (err, vars, ctx) => {
      restore(qc, ctx?.snap);
      const msg = errorMessage(err);
      if (!vars.silent) {
        toast.error(err instanceof ApiError && err.code === "SLOTS_FULL" ? "All slots are taken" : `Couldn't approve ${vars.teamName}`, {
          description: msg,
        });
      }
    },
    onSuccess: (reg, vars) => {
      // reconcile the optimistic slot with the real one
      patchSessions(qc, reg.id, (s) => {
        const slots = s.slots.map((sl) =>
          sl.registrationId === reg.id && sl.slotNumber !== reg.slotNumber ? { ...sl, team: null, registrationId: null } : sl,
        );
        return {
          ...s,
          registrations: s.registrations.map((r) => (r.id === reg.id ? reg : r)),
          slots: slots.map((sl) =>
            sl.slotNumber === reg.slotNumber
              ? { ...sl, team: { id: reg.team.id, name: reg.team.name, tag: reg.team.tag }, registrationId: reg.id }
              : sl,
          ),
        };
      });
      if (!vars.silent) {
        toast.success(
          reg.slotNumber != null
            ? `Approved — ${reg.team.name} got Slot ${slotLabel(reg.slotNumber)}`
            : `Approved — ${reg.team.name}`,
        );
      }
    },
    onSettled: () => settleDecision(qc),
  });
}

interface RejectVars extends DecisionVars {
  reason?: string;
}

export function useRejectRegistration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: RejectVars) =>
      api.post<Registration>(`/api/manager/registrations/${id}/reject`, reason ? { reason } : {}),
    onMutate: async ({ id, reason }) => {
      const snap = await snapshotDecisionViews(qc);
      let wasApproved = false;
      patchSessions(qc, id, (s, reg) => {
        wasApproved = reg.status === "APPROVED";
        return {
          ...s,
          registrations: s.registrations.map((r) =>
            r.id === id
              ? { ...r, status: "REJECTED", slotNumber: null, rejectionReason: reason ?? null, decidedAt: new Date().toISOString() }
              : r,
          ),
          slots: s.slots.map((sl) => (sl.registrationId === id ? { ...sl, team: null, registrationId: null } : sl)),
          counts: {
            pending: Math.max(0, s.counts.pending - (reg.status === "PENDING" ? 1 : 0)),
            approved: Math.max(0, s.counts.approved - (wasApproved ? 1 : 0)),
            slotsLeft: s.counts.slotsLeft + (wasApproved ? 1 : 0),
          },
        };
      });
      patchRequestsRemove(qc, id, 0);
      return { snap, wasApproved };
    },
    onError: (err, vars, ctx) => {
      restore(qc, ctx?.snap);
      if (!vars.silent) toast.error(`Couldn't update ${vars.teamName}`, { description: errorMessage(err) });
    },
    onSuccess: (_reg, vars, ctx) => {
      if (vars.silent) return;
      toast.success(ctx?.wasApproved ? `Removed ${vars.teamName} — their slot is free again` : `Rejected ${vars.teamName}`);
    },
    onSettled: () => settleDecision(qc),
  });
}

/**
 * Approve registrations one after another. When a session runs out of slots, the rest
 * of that session's items (same `group`) are skipped; other sessions continue.
 */
export function useBulkApprove() {
  const approve = useApproveRegistration();
  const run = async (items: { id: string; teamName: string; group?: string }[]) => {
    let approved = 0;
    let failed = 0;
    const fullGroups = new Set<string>();
    for (const it of items) {
      const group = it.group ?? "_";
      if (fullGroups.has(group)) continue;
      try {
        await approve.mutateAsync({ id: it.id, teamName: it.teamName, silent: true });
        approved++;
      } catch (err) {
        if (err instanceof ApiError && err.code === "SLOTS_FULL") fullGroups.add(group);
        else failed++;
      }
    }
    const full = fullGroups.size > 0;
    if (approved) {
      toast.success(`Approved ${approved} team${approved === 1 ? "" : "s"}`, {
        description: full ? "Slots ran out — the rest are still waiting." : undefined,
      });
    } else if (full) {
      toast.error("All slots are taken", { description: "Remove a team or add slots to approve more." });
    }
    if (failed) toast.error(`${failed} request${failed === 1 ? "" : "s"} couldn't be approved`, { description: "Please try those again." });
    return { approved, full, failed };
  };
  return { run, isPending: approve.isPending };
}
