import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, ExternalLink, LayoutTemplate, Radio, Square, ListOrdered, Loader2, MonitorOff, Palette, Plus, Smartphone, Trophy, Unplug, WifiOff } from "lucide-react";
import { deviceLiveUrl, type DeviceCaptureResponse, type DeviceRow, type ScreenshotKind } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { Label } from "@7xen/ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@7xen/ui/components/ui/select";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { Switch } from "@7xen/ui/components/ui/switch";
import { cn } from "@7xen/ui/lib/utils";
import type { TourStep } from "@7xen/ui/tour";
import { api } from "@/lib/api";
import { errorMessage } from "@/features/manager/api";
import { deviceKeys, useDevices } from "@/features/devices/api";
import { matchKeys } from "@/features/matches/api";
import { DeviceStatusPill, DeviceStreamBadges } from "@/features/devices/components/DeviceCard";
import { HlsPlayer, LiveBadge } from "@/features/station/components/HlsPlayer";
import { ConfirmDialog } from "@/features/manager/components/ConfirmDialog";
import { LiveOverlay, useLayoutToggle } from "./LiveOverlay";

export const MATCH_DEVICE_TOUR: TourStep[] = [
  { element: '[data-tour="match-device-broadcast"]', title: "Broadcast to teams", description: "Only you see the stream until you press Start broadcast. Then the teams in this match get a Watch live card and see it with your layout. Stop broadcast hides it again.", side: "bottom" },
  { element: '[data-tour="match-device"]', title: "Stream from an iPhone", description: "Pick one of your iPhones for this match. Its live screen shows here with your layout, using this match's teams and points.", side: "bottom" },
  { element: '[data-tour="match-device-capture"]', title: "Capture screenshots", description: "When the team list or the results screen is showing on the phone, press the matching button. The screenshot is read automatically, just like an upload.", side: "top" },
];

function useBroadcast(deviceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (on: boolean) => api.post<DeviceRow>(`/api/manager/devices/${deviceId}/broadcast/${on ? "start" : "stop"}`),
    onSuccess: (d) => {
      qc.setQueryData([...deviceKeys.all, deviceId], d);
      void qc.invalidateQueries({ queryKey: deviceKeys.all });
      toast.success(d.broadcastLive ? "You're live to the teams" : "Broadcast stopped", {
        description: d.broadcastLive ? "Teams in this match now see a Watch live card on their home screen." : "Teams can't see the stream any more. You still can.",
      });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

/** Start / stop showing this match's stream to its teams. */
function BroadcastBar({ device }: { device: DeviceRow }) {
  const b = useBroadcast(device.id);
  const [confirmStop, setConfirmStop] = useState(false);
  const live = device.broadcastLive;
  return (
    <div
      data-tour="match-device-broadcast"
      className={cn(
        "flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center",
        live ? "border-destructive/40 bg-destructive/10" : "bg-background/60",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
        {live ? (
          <>
            <LiveBadge startedAt={device.broadcastStartedAt} />
            <span className="font-semibold">Teams in this match can watch.</span>
          </>
        ) : (
          <>
            <Radio className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">{device.videoReady ? "Only you can see this stream. Start the broadcast to show it to the teams." : "Start streaming on the iPhone first."}</span>
          </>
        )}
      </div>
      {live ? (
        <Button variant="outline" size="lg" disabled={b.isPending} onClick={() => setConfirmStop(true)} className="border-destructive/50 text-destructive hover:bg-destructive/10">
          {b.isPending ? <Loader2 className="animate-spin" /> : <Square className="fill-current" />} Stop broadcast
        </Button>
      ) : (
        <Button size="lg" disabled={!device.videoReady || b.isPending} onClick={() => b.mutate(true)} className="shadow-glow">
          {b.isPending ? <Loader2 className="animate-spin" /> : <Radio />} Start broadcast to teams
        </Button>
      )}
      <ConfirmDialog
        open={confirmStop}
        onOpenChange={setConfirmStop}
        title="Stop the broadcast?"
        description="Teams stop seeing the stream right away. You keep watching here, and you can start it again any time."
        confirmLabel="Stop broadcast"
        destructive
        onConfirm={() => {
          setConfirmStop(false);
          b.mutate(false);
        }}
      />
    </div>
  );
}

/** Screenshot of the phone's screen into this match (team list → lineup, results → placements & points). */
function useCapture(matchId: string, deviceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kind: ScreenshotKind) => api.post<DeviceCaptureResponse>(`/api/manager/devices/${deviceId}/capture`, { matchId, kind }),
    onSuccess: (r, kind) => {
      void qc.invalidateQueries({ queryKey: matchKeys.detail(matchId) });
      toast.success(kind === "SLOT_LIST" ? "Team list captured" : "Results captured", {
        description: `${r.from === "PHONE" ? "Full-quality image from the iPhone." : "Taken from the live video."} It's being read now. Check it in the steps below.`,
      });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

function CaptureButtons({ matchId, device }: { matchId: string; device: DeviceRow }) {
  const cap = useCapture(matchId, device.id);
  const busy = cap.isPending ? cap.variables : null;
  const disabled = !device.videoReady || cap.isPending;
  return (
    <div data-tour="match-device-capture" className="flex flex-col gap-2 rounded-xl border bg-background/60 p-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
        <Camera className="size-4 shrink-0 text-primary" />
        <span className="text-muted-foreground">{device.videoReady ? "Open the screen on the phone, then capture it." : "Capturing works while the iPhone is streaming."}</span>
      </div>
      <Button disabled={disabled} onClick={() => cap.mutate("SLOT_LIST")} className="h-11">
        {busy === "SLOT_LIST" ? <Loader2 className="animate-spin" /> : <ListOrdered />} Capture team list
      </Button>
      <Button disabled={disabled} onClick={() => cap.mutate("RESULTS")} className="h-11">
        {busy === "RESULTS" ? <Loader2 className="animate-spin" /> : <Trophy />} Capture results
      </Button>
    </div>
  );
}

/** Point a device at a match (its layout then shows this match). Also frees any other device that showed this match. */
function useStreamToMatch(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ deviceId, others }: { deviceId: string | null; others: string[]; wasLive?: boolean }) => {
      await Promise.all(others.map((id) => api.put<DeviceRow>(`/api/manager/devices/${id}/match`, { matchId: null })));
      if (deviceId) await api.put<DeviceRow>(`/api/manager/devices/${deviceId}/match`, { matchId });
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: deviceKeys.all });
      toast.success(v.deviceId ? "This match now streams from that iPhone" : "iPhone removed from this match", {
        description: v.wasLive ? "The broadcast to teams was stopped. Start it again when you're ready." : undefined,
      });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

/** Match Center card: choose the iPhone that streams this match, and watch it with the layout. */
export function MatchDeviceStream({ matchId }: { matchId: string }) {
  const q = useDevices();
  const set = useStreamToMatch(matchId);
  const [picking, setPicking] = useState(false);
  const [choice, setChoice] = useState<string>("");
  const [showLayout, setShowLayout] = useLayoutToggle();

  const devices = q.data ?? [];
  const assigned = devices.filter((d) => d.match?.id === matchId);
  const current = assigned[0] ?? null;

  const assign = (deviceId: string) => {
    set.mutate({ deviceId, others: assigned.filter((d) => d.id !== deviceId).map((d) => d.id), wasLive: assigned.some((d) => d.broadcastLive) }, { onSuccess: () => setPicking(false) });
  };

  if (q.isPending) return <Skeleton data-tour="match-device" className="h-28 rounded-2xl" />;
  if (q.isError) return null; // devices are optional here; the Devices page shows the error

  // ---- choose a device
  if (!current || picking) {
    const chosen = devices.find((d) => d.id === choice);
    return (
      <section data-tour="match-device" className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Smartphone className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl leading-tight font-bold">Stream this match from an iPhone</h2>
            <p className="text-sm text-muted-foreground">Its screen shows here with your layout, using this match's teams and points.</p>
          </div>
        </div>

        {devices.length === 0 ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            You haven't added an iPhone yet.
            <Button asChild size="sm">
              <Link to="/manager/devices">
                <Plus /> Add iPhone
              </Link>
            </Button>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Select value={choice} onValueChange={setChoice}>
              <SelectTrigger className="h-11 w-full sm:w-80" aria-label="iPhone for this match">
                <SelectValue placeholder="Choose an iPhone" />
              </SelectTrigger>
              <SelectContent>
                {devices.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    <span className="flex items-center gap-2">
                      {d.name}
                      <span className="text-xs text-muted-foreground">· {d.status === "STREAMING" ? "streaming" : d.status === "ONLINE" ? "online" : "offline"}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="lg" disabled={!choice || set.isPending} onClick={() => assign(choice)} className="shadow-glow">
              {set.isPending ? <Loader2 className="animate-spin" /> : <Smartphone />} Stream this match
            </Button>
            {picking && (
              <Button variant="ghost" onClick={() => setPicking(false)}>
                Cancel
              </Button>
            )}
          </div>
        )}
        {chosen?.match && chosen.match.id !== matchId && (
          <p className="mt-2 text-xs text-muted-foreground">
            {chosen.name} is showing {chosen.match.title} · {chosen.match.subtitle}. It moves to this match.
          </p>
        )}
      </section>
    );
  }

  // ---- watching
  return (
    <section data-tour="match-device" className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Smartphone className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-xl leading-tight font-bold">{current.name}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <DeviceStreamBadges device={current} />
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 pr-1">
            <Switch id={`layout-${matchId}`} checked={showLayout} onCheckedChange={setShowLayout} />
            <Label htmlFor={`layout-${matchId}`} className="flex items-center gap-1 text-sm">
              <LayoutTemplate className="size-4 text-primary" /> Layout
            </Label>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to={`/manager/broadcast-layout?device=${current.id}`}>
              <Palette /> Edit layout
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPicking(true)}>
            Change iPhone
          </Button>
          <Button variant="ghost" size="sm" disabled={set.isPending} onClick={() => set.mutate({ deviceId: null, others: assigned.map((d) => d.id), wasLive: assigned.some((d) => d.broadcastLive) })}>
            <Unplug /> Stop using
          </Button>
        </div>
      </div>

      <BroadcastBar device={current} />

      {current.videoReady ? (
        <HlsPlayer src={deviceLiveUrl(current.id)} startedAt={current.streamingSince} label={`Live screen of ${current.name}`} showLiveBadge={!showLayout}>
          {showLayout && <LiveOverlay deviceId={current.id} />}
        </HlsPlayer>
      ) : (
        <NotStreaming device={current} />
      )}
      <CaptureButtons matchId={matchId} device={current} />
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {current.broadcastLive ? "Teams in this match are watching this stream with your layout." : "Only you can see this stream."}
        <Link to={`/manager/devices/${current.id}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
          Open the device page <ExternalLink className="size-3" />
        </Link>
      </p>
    </section>
  );
}

function NotStreaming({ device: d }: { device: DeviceRow }) {
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl border bg-muted/40 p-6 text-center">
      {d.status === "OFFLINE" ? <WifiOff className="size-8 text-muted-foreground" /> : <MonitorOff className="size-8 text-muted-foreground" />}
      <p className="font-display text-xl font-bold">{d.status === "OFFLINE" ? `${d.name} isn't connected` : "Connected, not streaming"}</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        On the iPhone, open 7XEN Stream and tap <strong className="text-foreground">Start streaming</strong>. The picture appears here by itself.
      </p>
      <DeviceStatusPill status={d.status} />
    </div>
  );
}
