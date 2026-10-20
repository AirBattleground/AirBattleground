import { useQuery } from "@tanstack/react-query";
import type { ListResponse, LiveBroadcastCard } from "@7xen/shared";
import { api } from "@/lib/api";

/** Every iPhone broadcast on right now (public — no sign-in). Polled for the sidebar count, the Live pages and /watch. */
export function useLiveBroadcasts() {
  return useQuery({
    queryKey: ["live", "broadcasts"],
    // trailing slash: prod nginx has `location /api/live/` and would 301 the bare path to its internal port
    queryFn: async () => (await api.get<ListResponse<LiveBroadcastCard>>("/api/live/")).items,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
}
