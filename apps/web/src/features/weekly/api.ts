import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { FinalsSlot, FinalsTarget, GiveFinalsSlotInput, ListResponse, WeeklyBoard } from "@7xen/shared";
import { api } from "@/lib/api";
import { errorMessage } from "@/features/manager/api";

const keys = {
  board: (area: "team" | "manager", scrimId: string, week: string) => [area, "weekly", scrimId, week] as const,
  slots: ["team", "finals-slots"] as const,
  targets: ["manager", "finals-targets"] as const,
};

const qs = (week: string) => (week ? `?week=${week}` : "");

/** A scrim's Weekly Board; week = any day of it ("" = this week). */
export function useTeamWeekly(scrimId: string, week: string) {
  return useQuery({
    queryKey: keys.board("team", scrimId, week),
    queryFn: () => api.get<WeeklyBoard>(`/api/team/scrims/${scrimId}/weekly${qs(week)}`),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
}

export function useManagerWeekly(scrimId: string, week: string) {
  return useQuery({
    queryKey: keys.board("manager", scrimId, week),
    queryFn: () => api.get<WeeklyBoard>(`/api/manager/scrims/${scrimId}/weekly${qs(week)}`),
    placeholderData: keepPreviousData,
  });
}

/** My team's Finals Slots (upcoming finals it was invited straight into). */
export function useFinalsSlots(enabled = true) {
  return useQuery({
    queryKey: keys.slots,
    queryFn: async () => (await api.get<ListResponse<FinalsSlot>>("/api/team/finals-slots")).items,
    enabled,
    staleTime: 60_000,
  });
}

/** The manager's tournaments whose final can take a Finals Slot. */
export function useFinalsTargets(enabled: boolean) {
  return useQuery({
    queryKey: keys.targets,
    queryFn: async () => (await api.get<ListResponse<FinalsTarget>>("/api/manager/finals-targets")).items,
    enabled,
  });
}

export function useGiveFinalsSlot(scrimId: string, week: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GiveFinalsSlotInput) => api.post<WeeklyBoard>(`/api/manager/scrims/${scrimId}/weekly/finals-slot`, input),
    onSuccess: (board) => {
      qc.setQueryData(keys.board("manager", scrimId, week), board);
      void qc.invalidateQueries({ queryKey: keys.targets });
      const winner = board.rows[0]?.team.name ?? "The winner";
      toast.success("Finals Slot given", { description: `${winner} is now in the ${board.finalsSlot?.stageName ?? "final"} of ${board.finalsSlot?.tournament.title ?? "the tournament"}.` });
    },
    onError: (e) => toast.error("Couldn't give the Finals Slot", { description: errorMessage(e) }),
  });
}
