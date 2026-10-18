import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, type AppRelease, type ListResponse, type RecordingRow, type RoomDetails, type SaveRoomInput, type TeamRoomCard } from "@7xen/shared";
import { api } from "@/lib/api";
import { errorMessage } from "@/features/manager/api";

export const liveKeys = {
  room: (matchId: string) => ["manager", "live", "room", matchId] as const,
  recordings: (matchId: string) => ["manager", "live", "recordings", matchId] as const,
  release: ["app", "manager", "latest"] as const,
  teamRooms: ["team", "rooms"] as const,
};

/** Video / poster URLs (cookie-authenticated, same origin; the video supports HTTP Range so <video> can seek). */
export const recordingVideoUrl = (id: string) => `/api/manager/recordings/${id}/video`;
export const recordingPosterUrl = (id: string) => `/api/manager/recordings/${id}/poster`;
export const APP_DOWNLOAD_URL = "/api/app/manager/download";

/** A missing endpoint/resource (e.g. an older API) behaves like "nothing yet" instead of an error. */
async function orEmpty<T>(p: Promise<T>, empty: T): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405 || e.status === 501)) return empty;
    throw e;
  }
}

const isBusy = (r: RecordingRow) => r.status === "LIVE" || r.status === "STOPPED" || r.status === "UPLOADING" || r.status === "PROCESSING";

// ---------- manager: room ----------
export function useRoom(matchId: string) {
  return useQuery({
    queryKey: liveKeys.room(matchId),
    queryFn: () => orEmpty(api.get<RoomDetails | null>(`/api/manager/matches/${matchId}/room`), null).then((r) => r ?? null),
    // the phone app can fill the room in while this page is open
    refetchInterval: 20_000,
  });
}

export function useSaveRoom(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveRoomInput) => api.put<RoomDetails>(`/api/manager/matches/${matchId}/room`, input),
    onSuccess: (room) => {
      qc.setQueryData(liveKeys.room(matchId), room);
      toast.success("Room details saved", { description: room.revealAt ? undefined : "Teams in this match can see them now." });
    },
  });
}

export function useDeleteRoom(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del(`/api/manager/matches/${matchId}/room`),
    onSuccess: () => {
      qc.setQueryData(liveKeys.room(matchId), null);
      toast.success("Room details removed", { description: "Teams no longer see a room ID for this match." });
    },
    onError: (err) => toast.error("Couldn't remove the room", { description: errorMessage(err) }),
  });
}

// ---------- manager: recordings ----------
export function useRecordings(matchId: string) {
  return useQuery({
    queryKey: liveKeys.recordings(matchId),
    queryFn: async () => (await orEmpty(api.get<ListResponse<RecordingRow>>(`/api/manager/matches/${matchId}/recordings`), { items: [] })).items,
    // fast while something is recording / uploading / processing, slow otherwise (to notice a new live session)
    refetchInterval: (q) => (q.state.data?.some(isBusy) ? 4_000 : 20_000),
  });
}

// ---------- manager app release ----------
export function useAppRelease() {
  return useQuery({
    queryKey: liveKeys.release,
    queryFn: () => orEmpty(api.get<AppRelease | null>("/api/app/manager/latest"), null).then((r) => r ?? null),
    staleTime: 10 * 60_000,
    retry: 1,
  });
}

// ---------- team: rooms ----------
const SOON_MS = 2 * 60 * 60_000;

/** Upcoming matches of the team with their room once revealed. Polls every 30 s near start time. */
export function useTeamRooms() {
  return useQuery({
    queryKey: liveKeys.teamRooms,
    queryFn: async () => (await orEmpty(api.get<ListResponse<TeamRoomCard>>("/api/team/rooms"), { items: [] })).items,
    refetchInterval: (q) => {
      const now = Date.now();
      const soon = q.state.data?.some((c) => {
        const t = c.startsAt ? new Date(c.startsAt).getTime() : NaN;
        const r = c.revealAt ? new Date(c.revealAt).getTime() : NaN;
        return (Number.isFinite(t) && t - now < SOON_MS && t - now > -SOON_MS) || (!c.room && Number.isFinite(r) && r - now < SOON_MS);
      });
      return soon ? 30_000 : 5 * 60_000;
    },
  });
}
