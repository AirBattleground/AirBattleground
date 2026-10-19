import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "@7xen/shared";

/**
 * Phase 5: a player's team / role can change under them (removed from the team, leadership moved).
 * When the API says NO_TEAM or LEADER_ONLY, re-read the session so the UI switches to the right state.
 */
let lastSessionRefresh = 0;
function onTeamAccessError(err: unknown) {
  if (!(err instanceof ApiError) || (err.code !== "NO_TEAM" && err.code !== "LEADER_ONLY")) return;
  const now = Date.now();
  if (now - lastSessionRefresh < 5_000) return;
  lastSessionRefresh = now;
  void queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
  void queryClient.invalidateQueries({ queryKey: ["player"] });
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onTeamAccessError }),
  mutationCache: new MutationCache({ onError: onTeamAccessError }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});
