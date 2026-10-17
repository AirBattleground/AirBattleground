import { useCallback, useEffect, useState } from "react";
import type { ListResponse, LiveMatchCard } from "@7xen/shared";
import { errorMessage } from "./api";
import { useAuth } from "./auth";
import { matchCache } from "./matchCache";

/** One match card (from the Today cache, refreshed from GET /api/manager/live/today). */
export function useMatch(id: string) {
  const { api } = useAuth();
  const [card, setCard] = useState<LiveMatchCard | null>(() => matchCache.get(id));
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await api.get<ListResponse<LiveMatchCard>>("/api/manager/live/today", { days: 7 });
      matchCache.setAll(res.items);
      const c = res.items.find((x) => x.matchId === id) ?? null;
      if (c) setCard(c);
      setError(c || matchCache.get(id) ? null : "This match isn't in your upcoming list any more.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRefreshing(false);
    }
  }, [api, id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const patch = useCallback((p: Partial<LiveMatchCard>) => {
    setCard((c) => {
      if (!c) return c;
      const next = { ...c, ...p };
      matchCache.set(next);
      return next;
    });
  }, []);

  return { card, error, refreshing, refresh, patch };
}
