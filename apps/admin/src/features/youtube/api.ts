import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UpdateYoutubeInput, YoutubeStatus } from "@7xen/shared";
import { api } from "@/lib/api";

const key = ["admin", "youtube"] as const;

/** The site YouTube channel: connection + streaming settings. */
export function useYoutube() {
  return useQuery({ queryKey: key, queryFn: () => api.get<YoutubeStatus>("/api/admin/youtube") });
}

export function useUpdateYoutube() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateYoutubeInput) => api.patch<YoutubeStatus>("/api/admin/youtube", input),
    onSuccess: (data) => qc.setQueryData(key, data),
  });
}

/** Asks for the Google consent URL; the caller sends the browser there. */
export function useConnectYoutube() {
  return useMutation({ mutationFn: () => api.post<{ url: string }>("/api/admin/youtube/connect") });
}

export function useDisconnectYoutube() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del<YoutubeStatus>("/api/admin/youtube"),
    onSuccess: (data) => qc.setQueryData(key, data),
  });
}
