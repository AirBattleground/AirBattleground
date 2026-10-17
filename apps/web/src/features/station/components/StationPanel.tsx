import { useCallback, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Camera, Check, CircleStop, Gamepad2, Loader2, MonitorOff, MonitorPlay, MousePointerClick, Play, RotateCcw, Trophy, Users } from "lucide-react";
import type { MatchLive, StationStatus } from "@7xen/shared";
import { Pill } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Label } from "@7xen/ui/components/ui/label";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { Switch } from "@7xen/ui/components/ui/switch";
import { cn } from "@7xen/ui/lib/utils";
import type { TourStep } from "@7xen/ui/tour";
import { ConfirmDialog } from "@/features/manager/components/ConfirmDialog";
import { useMatch } from "@/features/matches/api";
import { isActive, isPreparing, liveHlsUrl, useMatchLive, usePrepareStation, useStationCapture, useStationInput, useStationStatus, useStopStation } from "../api";
import { HlsPlayer } from "./HlsPlayer";
import { RemoteControlLayer, RemoteToolbar } from "./RemoteControl";

/** Tour steps for the Station panel — prepended to the match ops tour on both match centers. */
export const STATION_TOUR: TourStep[] = [
  { element: '[data-tour="station-panel"]', title: "7XEN Station", description: "A game phone that runs on the 7XEN PC. It opens BGMI for this match, records the whole game and streams it live to you and the teams playing.", side: "bottom" },
  { element: '[data-tour="station-status"]', title: "Is it ready?", description: "Ready means you can use it now. Busy means another match is using it; Offline means the Station PC isn't running.", side: "bottom" },
  { element: '[data-tour="station-action"]', title: "Prepare, then play", description: "Prepare starts the game phone, opens BGMI and starts recording. Once it's live you see the screen here — turn on Remote control to tap and swipe in the game.", side: "bottom" },
  { element: '[data-tour="station-remote"]', title: "Remote control", description: "Switch it on, then click to tap and drag to swipe on the game screen. Back, Home and a text box sit under the video. Press Esc to stop.", side: "bottom" },
  { element: '[data-tour="station-capture"]', title: "Screenshots in one click", description: "Open the team list or the results in the game, then capture — the screenshot lands in the steps below and 7xen reads it.", side: "top" },
  { element: '[data-tour="station-stop"]', title: "Stop when the match ends", description: "Stops recording and streaming. The full video is saved to Recordings.", side: "bottom" },
];

type View =
  | { kind: "loading" }
  | { kind: "offline" }
  | { kind: "busy"; otherMatchId: string | null }
  | { kind: "ready" }
  | { kind: "preparing"; s: StationStatus }
  | { kind: "live"; s: StationStatus }
  | { kind: "stopping" }
  | { kind: "error"; message: string };

function viewFor(matchId: string, status: StationStatus | undefined, live: MatchLive | null | undefined, preparing: boolean): View {
  // the match's own live state is the freshest source while it holds the station
  const s = live?.station.matchId === matchId ? live.station : status;
  if (!s) return preparing ? { kind: "loading" } : { kind: "loading" };
  if (!s.online) return { kind: "offline" };
  const mine = s.matchId === matchId;
  if (s.matchId && !mine && isActive(s.phase)) return { kind: "busy", otherMatchId: s.matchId };
  if (mine && s.phase === "LIVE") return { kind: "live", s };
  if (mine && isPreparing(s.phase)) return { kind: "preparing", s };
  if (mine && s.phase === "STOPPING") return { kind: "stopping" };
  if (preparing) return { kind: "preparing", s: { ...s, phase: "STARTING_EMULATOR" } };
  if (s.phase === "ERROR" && (mine || !s.matchId)) return { kind: "error", message: s.error ?? "Something went wrong on the station." };
  if (s.matchId && !mine && s.phase !== "IDLE") return { kind: "busy", otherMatchId: s.matchId };
  return { kind: "ready" };
}

/** "Starting emulator → Opening BGMI → Recording & streaming" */
const STEPS = [
  { key: "STARTING_EMULATOR", label: "Starting emulator", hint: "Booting the game phone — up to a minute the first time." },
  { key: "LAUNCHING_BGMI", label: "Opening BGMI", hint: "Launching the game." },
  { key: "LIVE", label: "Recording & streaming", hint: "Starting the recording and the live stream." },
] as const;

function PrepareStepper({ s }: { s: StationStatus }) {
  const current = s.phase === "LAUNCHING_BGMI" ? 1 : s.phase === "LIVE" ? 2 : 0;
  return (
    <ol className="grid gap-2 sm:grid-cols-3" aria-label="Getting the station ready">
      {STEPS.map((step, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <li
            key={step.key}
            aria-current={now ? "step" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-xl border p-3 transition-colors",
              now ? "border-primary/50 bg-primary/10" : done ? "border-success/40 bg-success/5" : "bg-background/60 text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full border font-display text-sm font-bold",
                now ? "border-primary bg-primary text-primary-foreground shadow-glow" : done ? "border-success bg-success text-success-foreground" : "bg-muted",
              )}
            >
              {done ? <Check className="size-4" /> : now ? <Loader2 className="size-4 animate-spin" /> : i + 1}
            </span>
            <span className="min-w-0">
              <span className={cn("block text-sm font-semibold", (now || done) && "text-foreground")}>{step.label}</span>
              {now && <span className="block text-xs text-muted-foreground">{step.hint}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Link to the match currently using the station (when this manager owns it), otherwise plain text. */
function OtherMatchLink({ matchId }: { matchId: string }) {
  const q = useMatch(matchId);
  const m = q.data;
  if (!m) return <span className="text-muted-foreground">Another match is using it right now.</span>;
  const href = m.tournament
    ? `/manager/tournaments/${m.tournament.id}/stages/${m.tournament.stageId}/matches/${m.match.id}`
    : `/manager/scrims/${m.scrim.id}/${m.date}/matches/${m.match.id}`;
  return (
    <span className="text-muted-foreground">
      In use by{" "}
      <Link to={href} className="font-medium text-primary underline-offset-4 hover:underline">
        {m.tournament?.title ?? m.scrim.title} · Match {m.match.number}
      </Link>
    </span>
  );
}

function StatusChip({ view }: { view: View }) {
  const chip = (() => {
    switch (view.kind) {
      case "loading":
        return <Skeleton className="h-6 w-20 rounded-full" />;
      case "offline":
        return (
          <Pill tone="neutral" icon={<MonitorOff className="size-3.5" />}>
            Offline
          </Pill>
        );
      case "busy":
        return <Pill tone="warning" icon={<span className="size-2 rounded-full bg-warning" />}>Busy</Pill>;
      case "ready":
        return <Pill tone="success" icon={<span className="size-2 rounded-full bg-success" />}>Ready</Pill>;
      case "preparing":
        return <Pill tone="info" icon={<Loader2 className="size-3.5 animate-spin" />}>Getting ready</Pill>;
      case "live":
        return <Pill tone="danger" icon={<span className="size-2 animate-pulse rounded-full bg-destructive" />}>Live for this match</Pill>;
      case "stopping":
        return <Pill tone="neutral" icon={<Loader2 className="size-3.5 animate-spin" />}>Saving video</Pill>;
      case "error":
        return <Pill tone="danger" icon={<AlertTriangle className="size-3.5" />}>Problem</Pill>;
    }
  })();
  return (
    <span data-tour="station-status" role="status" aria-live="polite">
      {chip}
    </span>
  );
}

function Shell({ live, children, header }: { live?: boolean; children?: ReactNode; header: ReactNode }) {
  return (
    <section
      data-tour="station-panel"
      aria-labelledby="station-title"
      className={cn(
        "relative overflow-hidden rounded-xl border bg-card p-4 shadow-sm sm:p-5",
        // phones: the live card bleeds to the screen edges so the picture gets the full width
        live && "-mx-4 rounded-none border-x-0 border-destructive/40 sm:mx-0 sm:rounded-xl sm:border-x",
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-30 [mask-image:linear-gradient(to_bottom,black,transparent_60%)]" />
      <div className="relative space-y-4">
        {header}
        {children}
      </div>
    </section>
  );
}

/**
 * 7XEN Station for one match: status, Prepare → progress, then the live picture with remote control,
 * screenshot captures and Stop.
 */
export function StationPanel({ matchId }: { matchId: string }) {
  const status = useStationStatus();
  const live = useMatchLive(matchId);
  const prepare = usePrepareStation(matchId);
  const stop = useStopStation(matchId);
  const capture = useStationCapture(matchId);
  const send = useStationInput(matchId);
  const [control, setControl] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const exitControl = useCallback(() => setControl(false), []);

  const view = viewFor(matchId, status.data, live.data, prepare.isPending);
  const s = live.data?.station.matchId === matchId ? live.data.station : status.data;
  const isLive = view.kind === "live";
  const showBgmiWarning = !!s?.online && !s.bgmiInstalled && (view.kind === "preparing" || view.kind === "live" || view.kind === "ready");

  const description: ReactNode = (() => {
    switch (view.kind) {
      case "loading":
        return "Checking the station…";
      case "offline":
        return "The 7XEN Station PC isn't running. Ask your admin to start it — you can still upload screenshots by hand.";
      case "busy":
        return view.otherMatchId ? <OtherMatchLink matchId={view.otherMatchId} /> : "Another match is using it right now.";
      case "ready":
        return "Opens BGMI on the game phone, records the whole match and streams it live to you and the teams.";
      case "preparing":
        return "Getting the game phone ready — keep this page open.";
      case "live":
        return "Recording and streaming this match.";
      case "stopping":
        return "Stopping the recording and saving the video to Recordings…";
      case "error":
        return view.message;
    }
  })();

  const action = (() => {
    if (view.kind === "ready" || view.kind === "error")
      return (
        <Button size="lg" className="h-11 w-full sm:w-auto" onClick={() => prepare.mutate()} disabled={prepare.isPending} data-tour="station-action">
          {view.kind === "error" ? <RotateCcw /> : <Play className="fill-current" />}
          {view.kind === "error" ? "Try again" : "Prepare"}
        </Button>
      );
    if (view.kind === "offline" || view.kind === "busy" || view.kind === "loading")
      return (
        <Button size="lg" className="h-11 w-full sm:w-auto" disabled data-tour="station-action">
          <Play /> Prepare
        </Button>
      );
    if (isLive)
      return (
        <Button variant="outline" className="h-10 w-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive sm:w-auto" onClick={() => setConfirmStop(true)} disabled={stop.isPending} data-tour="station-stop">
          {stop.isPending ? <Loader2 className="animate-spin" /> : <CircleStop />} Stop
        </Button>
      );
    return null;
  })();

  const header = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", isLive ? "bg-destructive/10 text-destructive" : view.kind === "offline" ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary")}>
          <MonitorPlay className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="station-title" className="font-display text-xl font-bold">
              7XEN Station
            </h2>
            <StatusChip view={view} />
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );

  return (
    <Shell live={isLive} header={header}>
      {showBgmiWarning && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-foreground dark:text-warning" />
          <span>BGMI isn't installed on the station yet — recording the home screen.</span>
        </div>
      )}

      {view.kind === "preparing" && <PrepareStepper s={view.s} />}

      {isLive && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2" data-tour="station-remote">
            <div className="flex items-center gap-2">
              <Switch id={`remote-${matchId}`} checked={control} onCheckedChange={setControl} />
              <Label htmlFor={`remote-${matchId}`} className="flex cursor-pointer items-center gap-1.5 font-semibold">
                <MousePointerClick className="size-4 text-primary" /> Remote control
              </Label>
            </div>
            {control && <span className="text-xs text-muted-foreground">Tap = tap · drag = swipe · hold = long press · Esc to exit</span>}
          </div>

          <HlsPlayer
            className="-mx-4 sm:mx-0"
            key={view.s.recordingId ?? view.s.startedAt ?? "live"}
            src={live.data?.hlsUrl ?? liveHlsUrl(matchId)}
            startedAt={live.data?.startedAt ?? view.s.startedAt}
            videoRef={videoRef}
            label="Station live stream"
            frameClassName={cn("rounded-none border-x-0 sm:rounded-xl sm:border-x", control && "ring-2 ring-primary sm:ring-offset-2 sm:ring-offset-card")}
            endedSlot={<p className="rounded-lg bg-background/85 px-3 py-2 text-sm font-medium shadow-sm">The stream has stopped.</p>}
          >
            {control && <RemoteControlLayer videoRef={videoRef} send={send} />}
          </HlsPlayer>

          {control && <RemoteToolbar send={send} onExit={exitControl} />}

          <p className="text-xs text-muted-foreground">
            The picture is about 5–10 seconds behind the game. Taps act on the station right away — wait a moment to see the result.
          </p>

          <div className="flex flex-wrap gap-2" data-tour="station-capture">
            <Button variant="outline" onClick={() => capture.mutate("SLOT_LIST")} disabled={capture.isPending} className="flex-1 sm:flex-none">
              {capture.isPending && capture.variables === "SLOT_LIST" ? <Loader2 className="animate-spin" /> : <Users />} Capture team list
            </Button>
            <Button variant="outline" onClick={() => capture.mutate("RESULTS")} disabled={capture.isPending} className="flex-1 sm:flex-none">
              {capture.isPending && capture.variables === "RESULTS" ? <Loader2 className="animate-spin" /> : <Trophy />} Capture results
            </Button>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Camera className="size-3.5" /> Screenshots go straight into the steps below.
            </span>
          </div>
        </div>
      )}

      {view.kind === "offline" && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Gamepad2 className="size-3.5" /> No station? Record with the 7XEN Manager app on your phone instead.
        </p>
      )}

      <ConfirmDialog
        open={confirmStop}
        onOpenChange={setConfirmStop}
        title="Stop the station?"
        description="This stops the recording and the live stream. The video is saved to Recordings for this match."
        confirmLabel="Stop recording"
        destructive
        onConfirm={() => {
          setControl(false);
          stop.mutate();
        }}
      />
    </Shell>
  );
}
