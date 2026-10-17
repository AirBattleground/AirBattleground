import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "./api";

/** Minimal data loader: initial load, pull-to-refresh, error text. */
export function useQuery<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  const run = useCallback(async (mode: "load" | "refresh" | "silent") => {
    if (mode === "load") setLoading(true);
    if (mode === "refresh") setRefreshing(true);
    try {
      const v = await fnRef.current();
      if (!alive.current) return;
      setData(v);
      setError(null);
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      if (alive.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void run("load");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, setData, error, loading, refreshing, refresh: () => run("refresh"), reload: () => run("silent") };
}

/** Re-renders every `ms` (for countdowns). */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
