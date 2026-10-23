import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ApiError,
  type CreateScrimInput,
  type ListResponse,
  type ManagerDashboard,
  type Registration,
  type Scrim,
  type ScrimOnDate,
  type SessionDetail,
  type UpdateScrimInput,
} from "@7xen/shared";
import { api } from "@/lib/api";

const managerKeys = {
  all: ["manager"] as const,
  dashboard: ["manager", "dashboard"] as const,
  scrims: ["manager", "scrims"] as const,
  scrim: (id: string) => ["manager", "scrim", id] as const,
  scheduleAll: ["manager", "schedule"] as const,
  schedule: (date: string) => ["manager", "schedule", date] as const,
  sessionAll: ["manager", "session"] as const,
  session: (scrimId: string, date: string) => ["manager", "session", scrimId, date] as const,
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

// ---------- scrim mutations ----------
function invalidateScrimViews(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: managerKeys.scrims });
  void qc.invalidateQueries({ queryKey: managerKeys.dashboard });
  void qc.invalidateQueries({ queryKey: managerKeys.scheduleAll });
  void qc.invalidateQueries({ queryKey: managerKeys.sessionAll });
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

// ---------- removing a team from a session (optimistic) ----------
type Snapshot = [readonly unknown[], unknown][];

async function snapshotDecisionViews(qc: QueryClient): Promise<Snapshot> {
  await qc.cancelQueries({ queryKey: managerKeys.sessionAll });
  return qc.getQueriesData({ queryKey: managerKeys.sessionAll });
}

function restore(qc: QueryClient, snap: Snapshot | undefined) {
  snap?.forEach(([key, data]) => qc.setQueryData(key, data));
}

function settleDecision(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: managerKeys.dashboard });
  void qc.invalidateQueries({ queryKey: managerKeys.scheduleAll });
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

interface RemoveVars {
  id: string;
  teamName: string;
  reason?: string;
}

export function useRejectRegistration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: RemoveVars) =>
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
      return { snap, wasApproved };
    },
    onError: (err, vars, ctx) => {
      restore(qc, ctx?.snap);
      toast.error(`Couldn't remove ${vars.teamName}`, { description: errorMessage(err) });
    },
    onSuccess: (_reg, vars, ctx) => {
      toast.success(ctx?.wasApproved ? `Removed ${vars.teamName} — their slot is free again` : `Removed ${vars.teamName}`);
    },
    onSettled: () => settleDecision(qc),
  });
}

