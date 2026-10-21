/**
 * Phase 8c — Studio Box mode. The same web build is served by AWS (the normal website) and by a Studio Box on the
 * venue LAN (http://<box-ip>:4300), which adds /box/* endpoints. We're "in box mode" only when GET /box/info answers
 * JSON with a `lanUrl` — on AWS the SPA fallback answers HTML, and a network error also means "not a box".
 */
import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { deviceLiveUrl, type BoxDevice, type BoxDeviceNameInput, type BoxInfo, type BoxRecordings, type StudioWorkerRow } from "@7xen/shared";
import { api } from "@/lib/api";
import { errorMessage } from "@/features/manager/api";
import type { StudioMixer } from "./engine/mixer";

export const boxKeys = {
  info: ["box", "info"] as const,
  devices: ["box", "devices"] as const,
  recordings: ["box", "recordings"] as const,
};

async function fetchBoxInfo(): Promise<BoxInfo | null> {
  try {
    const res = await fetch("/box/info", { credentials: "include", headers: { Accept: "application/json" } });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return null;
    const data = (await res.json().catch(() => null)) as Partial<BoxInfo> | null;
    return data && typeof data.lanUrl === "string" && data.lanUrl ? (data as BoxInfo) : null;
  } catch {
    return null;
  }
}

/**
 * Box info once per page load. `isBox` is false until the check finished; `ready` says it finished (pages that pick a
 * data source by mode wait for it, so they never start on the wrong one).
 */
export function useBox() {
  const q = useQuery({ queryKey: boxKeys.info, queryFn: fetchBoxInfo, staleTime: Infinity, gcTime: Infinity, retry: false, refetchOnWindowFocus: false });
  const info = q.data ?? null;
  return { info, isBox: !!info, ready: !q.isPending };
}

/** Same-origin HLS of a box phone (fallback when the device list isn't loaded yet). */
export const boxDeviceHlsUrl = (id: string) => `/box/devices/${encodeURIComponent(id)}/live/index.m3u8`;

/** Is this worker the box we're on? (its lanUrl matches this page's origin) */
export function isThisBox(w: StudioWorkerRow): boolean {
  const lan = w.box?.lanUrl;
  if (!lan) return false;
  try {
    return new URL(lan).origin === window.location.origin;
  } catch {
    return false;
  }
}

/** Phones paired on this box. Polls every 3 s so Online / Streaming changes show up quickly. */
export function useBoxDevices(enabled = true) {
  return useQuery({
    queryKey: boxKeys.devices,
    queryFn: async () => (await api.get<{ items: BoxDevice[] }>("/box/devices")).items,
    enabled,
    refetchInterval: 3_000,
  });
}

export function useCreateBoxDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BoxDeviceNameInput) => api.post<{ device: BoxDevice; key: string; pairUrl: string }>("/box/devices", input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: boxKeys.devices }),
  });
}

export function useRenameBoxDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.patch<BoxDevice>(`/box/devices/${encodeURIComponent(id)}`, { name }),
    onSuccess: () => {
      toast.success("Phone renamed");
      void qc.invalidateQueries({ queryKey: boxKeys.devices });
    },
  });
}

export function useDeleteBoxDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/box/devices/${encodeURIComponent(id)}`),
    onSuccess: () => {
      toast.success("Phone removed");
      void qc.invalidateQueries({ queryKey: boxKeys.devices });
    },
    onError: (e) => toast.error("Couldn't remove the phone", { description: errorMessage(e) }),
  });
}

/**
 * Points the mixer's device sources at the box's same-origin phone feeds when we're on a box (else the AWS feed).
 * Assigned during render so it's in place before any effect prepares a source.
 */
export function useMixerDeviceUrls(mixer: StudioMixer, isBox: boolean, devices: BoxDevice[] | undefined) {
  const byId = useRef(new Map<string, string>());
  byId.current = new Map((devices ?? []).map((d) => [d.id, d.hlsUrl]));
  if (isBox) mixer.deviceUrl = (id) => byId.current.get(id) ?? boxDeviceHlsUrl(id);
  else mixer.deviceUrl = deviceLiveUrl;
}

// ---------------------------------------------------------------- recordings ("Record on this box")

export const boxRecordingUrl = (file: string, download = false) => `/box/recordings/${encodeURIComponent(file)}${download ? "?download=1" : ""}`;

export function useBoxRecordings(enabled = true) {
  return useQuery({ queryKey: boxKeys.recordings, queryFn: () => api.get<BoxRecordings>("/box/recordings"), enabled, refetchInterval: 5_000 });
}

export function useDeleteBoxRecording() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: string) => api.del(`/box/recordings/${encodeURIComponent(file)}`),
    onSuccess: () => {
      toast.success("Recording deleted");
      void qc.invalidateQueries({ queryKey: boxKeys.recordings });
    },
    onError: (e) => toast.error("Couldn't delete the recording", { description: errorMessage(e) }),
  });
}
