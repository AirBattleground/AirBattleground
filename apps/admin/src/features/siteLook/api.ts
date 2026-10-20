import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UiSkinResponse, UpdateUiSkinInput } from "@7xen/shared";
import { api } from "@/lib/api";

const key = ["admin", "site", "skin"] as const;

/** The web portal's look (public read, admin write). */
export function useSiteSkin() {
  return useQuery({ queryKey: key, queryFn: () => api.get<UiSkinResponse>("/api/site/skin") });
}

export function useSetSiteSkin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateUiSkinInput) => api.put<UiSkinResponse>("/api/admin/site/skin", input),
    onSuccess: (data) => qc.setQueryData(key, data),
  });
}
