import { useQuery } from "@tanstack/react-query";
import type { AdminStats } from "@7xen/shared";
import { api } from "@/lib/api";

export const statsKey = ["admin", "stats"] as const;

export function useAdminStats(opts: { refetchInterval?: number } = {}) {
  return useQuery({ queryKey: statsKey, queryFn: () => api.get<AdminStats>("/api/admin/stats"), refetchInterval: opts.refetchInterval });
}
