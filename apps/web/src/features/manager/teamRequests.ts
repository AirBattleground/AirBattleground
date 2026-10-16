import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateTeamInput, ListResponse, TeamAvailability, TeamRequestRow } from "@7xen/shared";
import { api } from "@/lib/api";

export const teamRequestsKey = ["manager", "team-requests"] as const;

/** Own team requests, newest first. Polls so admin decisions show up without a refresh. */
export function useMyTeamRequests() {
  return useQuery({
    queryKey: teamRequestsKey,
    queryFn: async () => (await api.get<ListResponse<TeamRequestRow>>("/api/manager/team-requests")).items,
    refetchInterval: 30_000,
  });
}

export function useCreateTeamRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTeamInput) => api.post<TeamRequestRow>("/api/manager/team-requests", input),
    onSuccess: (row) => qc.setQueryData<TeamRequestRow[]>(teamRequestsKey, (list) => [row, ...(list ?? [])]),
    onSettled: () => qc.invalidateQueries({ queryKey: teamRequestsKey }),
  });
}

export function useWithdrawTeamRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/manager/team-requests/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: teamRequestsKey });
      const previous = qc.getQueryData<TeamRequestRow[]>(teamRequestsKey);
      qc.setQueryData<TeamRequestRow[]>(teamRequestsKey, (list) => list?.filter((r) => r.id !== id));
      return { previous };
    },
    onError: (_e, _id, ctx) => ctx?.previous && qc.setQueryData(teamRequestsKey, ctx.previous),
    onSettled: () => qc.invalidateQueries({ queryKey: teamRequestsKey }),
  });
}

function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Live "is this name free?" check while typing. */
export function useTeamAvailability(teamName: string, username: string) {
  const name = useDebounced(teamName.trim());
  const user = useDebounced(username.trim().toLowerCase());
  const enabled = name.length >= 2 || user.length >= 3;
  return useQuery({
    queryKey: ["manager", "availability", name, user],
    queryFn: () =>
      api.get<TeamAvailability>("/api/manager/teams/availability", {
        teamName: name.length >= 2 ? name : undefined,
        username: user.length >= 3 ? user : undefined,
      }),
    enabled,
    staleTime: 10_000,
  });
}

export function suggestUsername(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
}

export function generatePassword(length = 12): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}
