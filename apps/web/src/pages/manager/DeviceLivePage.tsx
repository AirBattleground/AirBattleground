import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, KeyRound, LayoutTemplate, Loader2, MonitorOff, Palette, WifiOff } from "lucide-react";
import { deviceLiveUrl } from "@7xen/shared";
import { PageHeader } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Label } from "@7xen/ui/components/ui/label";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { Switch } from "@7xen/ui/components/ui/switch";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { QueryError } from "@/features/manager/components/QueryError";
import { HlsPlayer } from "@/features/station/components/HlsPlayer";
import { useDevice } from "@/features/devices/api";
import { DeviceHealthPanel, DeviceStreamBadges } from "@/features/devices/components/DeviceCard";
import { DeviceKeyDialog } from "@/features/devices/components/DeviceDialogs";
import { PairQr } from "@/features/devices/components/PairQr";
import { LiveOverlay, MatchPicker, useLayoutToggle } from "@/features/broadcast/LiveOverlay";
import { GoLivePanel } from "@/features/broadcast/GoLivePanel";
import { Zone } from "@/features/tournaments/manager/components/Zone";

const TOUR: TourStep[] = [
  { title: "Watching your phone", description: "This is the iPhone's screen, live. Only you can see it here. Nobody can control the phone from 7xen." },
  { element: '[data-tour="device-player"]', title: "The live picture", description: "It runs a few seconds behind the phone. Tap the speaker for sound, or the corner button for full screen.", side: "bottom" },
  { element: '[data-tour="device-layout"]', title: "Your broadcast layout", description: "Turn the layout on to see the stream with your title bar, team list and points table. Pick the match it shows, or open Edit layout to change colours and panels.", side: "bottom" },
  { element: '[data-tour="device-go-live"]', title: "Go live", description: "Broadcast the phone's video with your layout to AirBattleground, your own channels, and the site YouTube channel when it's connected.", side: "left" },
  { element: '[data-tour="device-health"]', title: "Phone health", description: "Battery, temperature and how hard the app is working. If the phone gets hot it lowers the quality by itself.", side: "left" },
];

export default function DeviceLivePage() {
  usePageTour("manager.deviceLive", TOUR);
  const { deviceId } = useParams();
  const q = useDevice(deviceId);
  const [showKey, setShowKey] = useState(false);
  const [showLayout, setShowLayout] = useLayoutToggle();
  const d = q.data;

  const back = (
    <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
      <Link to="/manager/devices">
        <ArrowLeft /> Devices
      </Link>
    </Button>
  );

  if (q.isError)
    return (
      <>
        {back}
        <QueryError error={q.error} onRetry={() => void q.refetch()} title="Couldn't load this device" />
      </>
    );
  if (!d)
    return (
      <>
        {back}
        <Skeleton className="mb-6 h-12 w-72" />
        <Skeleton className="aspect-video w-full rounded-xl" />
      </>
    );

  const live = d.status === "STREAMING";
  const waitingForVideo = live && !d.videoReady;

  return (
    <>
      {back}
      <PageHeader
        title={d.name}
        description={[d.model ?? "iPhone", d.osVersion && `iOS ${d.osVersion}`, d.appVersion && `app ${d.appVersion}`].filter(Boolean).join(" · ")}
        actions={
          <>
            <DeviceStreamBadges device={d} />
            <Button variant="outline" onClick={() => setShowKey(true)}>
              <KeyRound /> Key & QR
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-3">
          <div data-tour="device-layout" className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3 shadow-sm">
            <div className="flex items-center gap-2">
              <Switch id="show-layout" checked={showLayout} onCheckedChange={setShowLayout} />
              <Label htmlFor="show-layout" className="flex items-center gap-1.5 font-semibold">
                <LayoutTemplate className="size-4 text-primary" /> Show layout
              </Label>
            </div>
            <div className="min-w-0 flex-1 sm:flex-none">
              <MatchPicker deviceId={d.id} value={d.match?.id ?? null} />
            </div>
            <Button asChild variant="outline" size="sm" className="ml-auto">
              <Link to={`/manager/broadcast-layout?device=${d.id}`}>
                <Palette /> Edit layout
              </Link>
            </Button>
          </div>

          <div data-tour="device-player">
            {d.videoReady ? (
              <HlsPlayer src={deviceLiveUrl(d.id)} startedAt={d.streamingSince} label={`Live screen of ${d.name}`} showLiveBadge={!showLayout}>
                {showLayout && <LiveOverlay deviceId={d.id} />}
              </HlsPlayer>
            ) : (
              <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-xl border bg-muted/40 p-6 text-center">
                {waitingForVideo ? (
                  <>
                    <Loader2 className="size-8 animate-spin text-primary" />
                    <p className="font-display text-xl font-bold">Waiting for the video…</p>
                    <p className="max-w-sm text-sm text-muted-foreground">The picture appears in a few seconds.</p>
                  </>
                ) : d.status === "ONLINE" ? (
                  <>
                    <MonitorOff className="size-8 text-muted-foreground" />
                    <p className="font-display text-xl font-bold">Connected, not streaming</p>
                    <p className="max-w-sm text-sm text-muted-foreground">
                      On the iPhone tap <strong className="text-foreground">Start streaming</strong> → Start Broadcast.
                    </p>
                  </>
                ) : (
                  <>
                    <PairQr deviceId={d.id} size={140} hidden />
                    <p className="flex items-center gap-1.5 font-display text-xl font-bold">
                      <WifiOff className="size-5 text-muted-foreground" /> Phone not connected
                    </p>
                    <p className="max-w-sm text-sm text-muted-foreground">Scan this QR in 7XEN Stream on the iPhone.</p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <GoLivePanel deviceId={d.id} videoReady={d.videoReady} hasMatch={!!d.match} />
          <Zone label="Phone health" data-tour="device-health">
            {d.status === "OFFLINE" || !d.health ? (
              <p className="text-sm text-muted-foreground">Shows up once the phone connects.</p>
            ) : (
              <DeviceHealthPanel device={d} className="border-0 bg-transparent p-0 sm:grid-cols-1" />
            )}
            {live && (
              <p className="mt-3 border-t pt-3 text-xs text-muted-foreground" title="7xen never controls the phone, so streaming can only be stopped on the iPhone.">
                To stop: tap the red pill on the iPhone, or Stop in 7XEN Stream.
              </p>
            )}
          </Zone>
        </aside>
      </div>

      <DeviceKeyDialog device={showKey ? d : null} onOpenChange={(o) => !o && setShowKey(false)} />
    </>
  );
}

