import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Camera,
  CameraOff,
  Check,
  Clapperboard,
  Copy,
  ExternalLink,
  Film,
  Headphones,
  Layers,
  ListOrdered,
  Loader2,
  Mic,
  MicOff,
  Monitor,
  Pencil,
  Plus,
  Radio,
  Server,
  Smartphone,
  Square,
  Trash2,
  Trophy,
  Upload,
  Youtube,
} from "lucide-react";
import { toast } from "sonner";
import { STUDIO_FPS, STUDIO_HEIGHT, STUDIO_WIDTH, type BoxDevice, type BoxInfo, type MatchDetail, type StudioShow, type StudioStatus, type StudioWorkerRow } from "@7xen/shared";
import { Tooltip, TooltipContent, TooltipTrigger } from "@7xen/ui/components/ui/tooltip";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { Input } from "@7xen/ui/components/ui/input";
import { Label } from "@7xen/ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@7xen/ui/components/ui/select";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { Switch } from "@7xen/ui/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@7xen/ui/components/ui/toggle-group";
import { cn } from "@7xen/ui/lib/utils";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { useAuth } from "@/lib/auth";
import { useDevices } from "@/features/devices/api";
import { isThisBox, useBox, useBoxDevices, useMixerDeviceUrls } from "@/features/studio/box";
import { BoxPhonesList } from "@/features/studio/components/BoxPhones";
import { useUpcomingMatches } from "@/features/broadcast/api";
import { ConfirmDialog } from "@/features/manager/components/ConfirmDialog";
import { errorMessage } from "@/features/manager/api";
import { useDeleteDestination } from "@/features/broadcast/output";
import { StreamKeyDialog } from "@/features/studio/components/StreamKeyDialog";
import { QueryError } from "@/features/manager/components/QueryError";
import { useMatch } from "@/features/matches/api";
import { useShow, useShowControl, useShowStatus, useStartWorker, useStopShow, useStudioOutputs, useUpdateControl, useUpdateShow, useWorkers } from "@/features/studio/api";
import { asConfig, defaultConfig, fadeMsOf, resolveScene, sid } from "@/features/studio/config";
import { useOverlayImage } from "@/features/studio/overlayImage";
import { LAYOUTS } from "@/features/studio/engine/layouts";
import { StudioMixer, type MixerStatus } from "@/features/studio/engine/mixer";
import { addProp, listProps, removeProp, type PropMeta } from "@/features/studio/engine/props";
import { sourceKey, type LayoutKind, type Scene, type SourceRef, type StudioConfigV1 } from "@/features/studio/engine/types";

const TOUR: TourStep[] = [
  { title: "Studio console", description: "Build your show from scenes. The big screen is what viewers see; the small one is what's next." },
  { element: '[data-tour="studio-program"]', title: "Program (on air)", description: "Exactly what goes out to AirBattleground and YouTube.", side: "bottom" },
  { element: '[data-tour="studio-scenes"]', title: "Scenes", description: "Click a scene to preview it, then TAKE to put it on air (or double-click / press 1–9). Edit a scene to change its frame and sources.", side: "top" },
  { element: '[data-tour="studio-sources-panel"]', title: "Sources", description: "Phones, your webcam and mic, and prop videos (intro, break, outro) saved in this browser.", side: "right" },
  { element: '[data-tour="studio-capture"]', title: "Capture for the match", description: "With a match selected: put the team list or results screen on air, then tap Team list / Results. The screenshot goes to the match center and is read automatically.", side: "bottom" },
  { element: '[data-tour="studio-runs-on"]', title: "Runs on", description: "Run the show in this browser, or on one of your Studio boxes (a PC that renders and sends the show). On a box the show keeps going even if you close this tab.", side: "bottom" },
  { element: '[data-tour="studio-mode"]', title: "Stream or record", description: "On a Studio box: Stream sends the show to YouTube and your channels; Record on this box only saves it to this PC — nothing is sent anywhere.", side: "left" },
  { element: '[data-tour="studio-golive"]', title: "Go live", description: "Starts the broadcast. In this browser, keep the tab open while you're live; your intro scene is a good place to start.", side: "bottom" },
];

const NO_MATCH = "none";
const RUN_BROWSER = "browser";
const RUN_ON_KEY = "7xen.studio.runOn";

function savedRunOn(): string | null {
  try {
    return window.localStorage.getItem(RUN_ON_KEY);
  } catch {
    return null;
  }
}
function saveRunOn(v: string) {
  try {
    window.localStorage.setItem(RUN_ON_KEY, v);
  } catch {
    /* private mode etc. */
  }
}
/** A phone the console can use as a source: an AWS device, or (on a Studio Box) a phone paired on the box. */
type StudioDevice = { id: string; name: string; videoReady: boolean };
type BoxCtx = { info: BoxInfo; devices: BoxDevice[] } | null;

export default function ShowConsolePage() {
  const { showId } = useParams();
  const q = useShow(showId);
  // on a Studio Box the phones come from the box (polled every 3 s), else from the website
  const box = useBox();
  const awsDevices = useDevices(box.ready && !box.isBox);
  const boxDevices = useBoxDevices(box.isBox);
  const devices = box.isBox ? boxDevices : awsDevices;
  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} title="We couldn't load this show" />;
  if (devices.isError && !devices.data) return <QueryError error={devices.error} onRetry={() => void devices.refetch()} title="We couldn't load your phones" />;
  if (!q.data || !box.ready || !devices.data) return <Skeleton className="aspect-video w-full rounded-xl" />;
  const boxCtx: BoxCtx = box.info ? { info: box.info, devices: boxDevices.data ?? [] } : null;
  return <WithMixer key={q.data.id} show={q.data} devices={devices.data} box={boxCtx} />;
}

/** One mixer per mount (created in the effect so React's dev double-mount gets a fresh, working one). */
function WithMixer({ show, devices, box }: { show: StudioShow; devices: StudioDevice[]; box: BoxCtx }) {
  const [mixer, setMixer] = useState<StudioMixer | null>(null);
  useEffect(() => {
    const m = new StudioMixer();
    setMixer(m);
    return () => m.dispose();
  }, []);
  if (!mixer) return <Skeleton className="aspect-video w-full rounded-xl" />;
  return <Console key={mixer.id} show={show} devices={devices} mixer={mixer} box={box} />;
}

function Console({ show, devices, mixer, box }: { show: StudioShow; devices: StudioDevice[]; mixer: StudioMixer; box: BoxCtx }) {
  usePageTour("manager.studioConsole", TOUR);
  // device sources play from the box itself when the console is opened on a Studio Box
  useMixerDeviceUrls(mixer, !!box, box?.devices);
  const { user } = useAuth();
  const update = useUpdateShow(show.id);
  const [config, setConfig] = useState<StudioConfigV1>(() => asConfig(show.config) ?? defaultConfig(devices));
  const [title, setTitle] = useState(show.title);
  const [matchId, setMatchId] = useState<string | null>(show.match?.id ?? null);
  const [previewId, setPreviewId] = useState<string | null>(config.scenes[1]?.id ?? config.scenes[0]?.id ?? null);
  const [programId, setProgramId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Scene | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  /** "Record on this box" (box only): the show is saved on the box and sent nowhere */
  const [recordLocal, setRecordLocal] = useState(show.recordLocal);
  const [mixStatus, setMixStatus] = useState<MixerStatus | null>(null);
  const [props, setProps] = useState<PropMeta[]>([]);

  useEffect(() => {
    mixer.onStatus = setMixStatus;
    return () => {
      mixer.onStatus = null;
    };
  }, [mixer]);
  // warn before closing the tab while live
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (mixer.status.live) e.preventDefault();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [mixer]);

  // where the show runs: this browser, or a Studio worker (phase 8b)
  const workers = useWorkers();
  const workerList = workers.data ?? [];
  // what the manager picked on this page (null = automatic: an online Studio worker if there is one — a show in this
  // browser stops when the tab does, and with the media server on the studio PC it also crosses the home link twice)
  const [choice, setChoice] = useState<string | null>(() => (show.runOn === "worker" && show.workerId ? show.workerId : null));
  const setRunOn = (v: string) => {
    setChoice(v);
    saveRunOn(v);
  };
  const autoRunOn = useMemo(() => {
    const online = workerList.filter((w) => w.online);
    // on a Studio Box the show runs on the box itself by default
    const self = box ? online.find(isThisBox) : undefined;
    if (self) return self.id;
    const saved = savedRunOn();
    return (online.find((w) => w.id === saved) ?? online[0])?.id ?? RUN_BROWSER;
  }, [workerList, box]);
  const runOn = choice ?? autoRunOn;
  const selectedWorker = runOn === RUN_BROWSER ? null : (workerList.find((w) => w.id === runOn) ?? null);
  const [workerLiveHint, setWorkerLiveHint] = useState(show.runOn === "worker" && show.state === "LIVE");
  const status = useShowStatus(show.id, !!mixStatus?.live || workerLiveHint);
  const st = status.data ?? null;
  const workerLive = st ? st.runOn === "worker" && st.state === "LIVE" : workerLiveHint;
  useEffect(() => setWorkerLiveHint(workerLive), [workerLive]);
  const browserLive = !!mixStatus?.live;
  const live = browserLive || workerLive;
  /** takes go to the worker while it runs the show (or is picked to run it) */
  const mirror = workerLive || (!!selectedWorker && !browserLive);
  const control = useShowControl(show.id);
  const updateControl = useUpdateControl(show.id);
  const startWorker = useStartWorker(show.id);
  const stopShow = useStopShow(show.id);
  const takeSeq = useRef(0);
  useEffect(() => {
    if (control.data) takeSeq.current = Math.max(takeSeq.current, control.data.takeSeq);
  }, [control.data]);
  // LIVE bug on the local program while a worker runs the show (so it matches what goes out)
  useEffect(() => {
    mixer.setLiveClock(workerLive ? (st?.liveSince ? Date.parse(st.liveSince) : Date.now()) : null);
  }, [mixer, workerLive, st?.liveSince]);

  // save config/title/match (debounced)
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      if (!asConfig(show.config)) update.mutate({ config: config as unknown as Record<string, unknown> });
      return;
    }
    const t = window.setTimeout(() => update.mutate({ config: config as unknown as Record<string, unknown> }), workerLive ? 300 : 800);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  // overlays + match data → mixer
  useEffect(() => {
    mixer.overlays = config.overlays;
  }, [config.overlays, mixer]);
  const match = useMatch(matchId ?? undefined);
  useEffect(() => {
    mixer.setMatch(match.data ?? null, user?.displayName ?? "");
  }, [match.data, mixer, user?.displayName]);
  // keep the scorecard fresh while live
  useEffect(() => {
    if (!matchId) return;
    const t = window.setInterval(() => void match.refetch(), 10_000);
    return () => window.clearInterval(t);
  }, [matchId, match]);
  useOverlayImage(mixer, config.overlays.layout, matchId);

  useEffect(() => {
    void listProps().then(setProps).catch(() => setProps([]));
  }, []);

  const scenes = config.scenes;
  const preview = scenes.find((s) => s.id === previewId) ?? null;
  const program = scenes.find((s) => s.id === programId) ?? null;
  // the "Starting soon" slate plays the intro prop when one is picked
  const resolve = useCallback((s: Scene): Scene => resolveScene(s, config.introPropId), [config.introPropId]);

  const mirrorRef = useRef(mirror);
  mirrorRef.current = mirror;
  const workerLiveRef = useRef(workerLive);
  workerLiveRef.current = workerLive;
  const mutateControl = updateControl.mutate;
  const sendTake = useCallback(
    (input: { programId: string; takeSeq: number }) =>
      mutateControl(input, {
        // before the show starts a missed mirror doesn't matter (Go live sends the scene again)
        onError: (e) => workerLiveRef.current && toast.error("The worker didn't get that scene change", { description: errorMessage(e) }),
      }),
    [mutateControl],
  );
  const take = useCallback(
    async (scene: Scene | null, opts?: { local?: boolean }) => {
      if (!scene) return;
      // the worker cuts at the same moment as this preview
      if (!opts?.local && mirrorRef.current) sendTake({ programId: scene.id, takeSeq: ++takeSeq.current });
      await mixer.take(resolve(scene), fadeMsOf(config));
      setProgramId(scene.id);
    },
    [config, mixer, resolve, sendTake],
  );

  // keyboard: 1–9 takes scene n
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.ctrlKey || e.metaKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 9 && scenes[n - 1]) {
        setPreviewId(scenes[n - 1]!.id);
        void take(scenes[n - 1]!);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scenes, take]);

  // start on the first scene so the program isn't empty (local only: never cut a show a worker is running)
  useEffect(() => {
    if (!programId && scenes[0]) void take(scenes[0], { local: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // reopened while a worker runs the show: show what's on air there
  const synced = useRef(false);
  useEffect(() => {
    // not on a worker when the console opened → nothing to pick up (a show started from here is already in step)
    if (st && !workerLive) synced.current = true;
    if (synced.current || !workerLive || !control.data) return;
    synced.current = true;
    const onAir = scenes.find((s) => s.id === control.data.programId);
    if (onAir) void take(onAir, { local: true });
  }, [st, workerLive, control.data, scenes, take]);

  const goLive = () => {
    if (selectedWorker) {
      startWorker.mutate(selectedWorker.id, {
        onSuccess: () => {
          synced.current = true;
          setWorkerLiveHint(true);
          // make sure the worker starts on what's on air here
          if (programId) sendTake({ programId, takeSeq: ++takeSeq.current });
          void status.refetch();
        },
      });
      return;
    }
    // no toast: it would cover the top-bar controls; the LIVE badge + red program frame say it
    mixer.goLive(show.id);
  };
  const endLive = async () => {
    setConfirmEnd(false);
    if (workerLive && !browserLive) {
      stopShow.mutate(undefined, {
        onSuccess: () => {
          setWorkerLiveHint(false);
          toast.success("Show ended");
          void status.refetch();
        },
      });
      return;
    }
    await mixer.endLive();
    toast.success("Show ended");
    void status.refetch();
  };

  const saveMeta = (patch: { title?: string; matchId?: string | null }) => update.mutate(patch);

  return (
    <div className="-mx-4 -mt-4 flex min-h-[calc(100dvh-var(--shell-top))] flex-col bg-background sm:-mx-5 sm:-mt-5 lg:-mx-6 lg:-mt-6">
      {/* top bar */}
      <div className="flex flex-wrap items-center gap-3 border-b bg-card/70 px-4 py-2.5 backdrop-blur">
        <Button asChild variant="ghost" size="icon-sm" aria-label="Back to Studio">
          <Link to="/manager/studio">
            <ArrowLeft />
          </Link>
        </Button>
        <Clapperboard className="size-5 text-primary" />
        <Input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim().length >= 2 && title !== show.title && saveMeta({ title: title.trim() })} className="h-9 w-56 font-display text-lg font-bold" aria-label="Show name" />
        {box && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary" title={box.info.lanUrl}>
            <Server className="size-3.5" /> Studio box: {box.info.name}
          </span>
        )}
        <MatchPicker value={matchId} onChange={(m) => (setMatchId(m), saveMeta({ matchId: m }))} disabled={live} />
        <ToggleGroup type="single" variant="outline" size="sm" value={config.transition} onValueChange={(v) => v && setConfig((c) => ({ ...c, transition: v as "cut" | "fade" }))}>
          <ToggleGroupItem value="cut" className="px-3">
            Cut
          </ToggleGroupItem>
          <ToggleGroupItem value="fade" className="px-3">
            Fade
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="ml-auto flex items-center gap-2">
          <LiveHealth mix={mixStatus} status={st} workerLive={workerLive && !browserLive} />
          {live && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void navigator.clipboard.writeText(`${window.location.origin}${show.watchPath}`).then(() => toast.success("Watch link copied"))}
            >
              <Copy /> Watch link
            </Button>
          )}
          {live && (
            <Button asChild variant="outline" size="sm" title="The real output as viewers get it (about 5–10 s behind)">
              <a href={show.watchPath} target="_blank" rel="noreferrer">
                <ExternalLink /> Open viewer
              </a>
            </Button>
          )}
          {live ? (
            <Button variant="destructive" data-tour="studio-golive" onClick={() => setConfirmEnd(true)}>
              <Square className="fill-current" /> {recordLocal && box ? "Stop recording" : "End show"}
            </Button>
          ) : (
            <>
              {workerList.length > 0 && <RunsOnPicker value={selectedWorker ? selectedWorker.id : RUN_BROWSER} workers={workerList} showId={show.id} onChange={setRunOn} />}
              <Button data-tour="studio-golive" className="shadow-glow" onClick={goLive} disabled={startWorker.isPending}>
                {startWorker.isPending ? <Loader2 className="animate-spin" /> : <Radio />} {recordLocal && box ? "Start recording" : matchId ? "Start match broadcast" : "Go live"}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid flex-1 gap-4 p-4 xl:grid-cols-[18rem_minmax(0,1fr)_17rem]">
        <SourcesPanel mixer={mixer} devices={devices} box={box} props={props} setProps={setProps} config={config} setConfig={setConfig} />

        {/* monitors + scenes */}
        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
            <div data-tour="studio-program">
              <MonitorLabel tone={live ? "live" : "program"} text={live ? "On air" : "Program"} sub={program?.name} />
              <ProgramMonitor mixer={mixer} live={live} />
              {matchId && <MatchBar mixer={mixer} matchId={matchId} detail={match.data ?? null} onCaptured={() => void match.refetch()} />}
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <MonitorLabel tone="preview" text="Preview" sub={preview?.name} />
                <PreviewMonitor mixer={mixer} scene={preview ? resolve(preview) : null} />
              </div>
              <Button size="lg" className="h-14 text-lg font-bold tracking-wider" disabled={!preview || preview.id === programId} onClick={() => void take(preview)}>
                TAKE {config.transition === "fade" ? "· FADE" : "· CUT"}
              </Button>
              <p className="text-xs text-muted-foreground">Tip: press 1–9 to put a scene straight on air.</p>
            </div>
          </div>

          <section data-tour="studio-scenes" className="rounded-xl border bg-card p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-display text-lg font-bold">
                <Layers className="size-4 text-primary" /> Scenes
              </h2>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const s: Scene = { id: sid(), name: `Scene ${scenes.length + 1}`, layout: "full", slots: [null] };
                  setConfig((c) => ({ ...c, scenes: [...c.scenes, s] }));
                  setEditing(s);
                }}
              >
                <Plus /> Scene
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
              {scenes.map((s, i) => (
                <SceneCard
                  key={s.id}
                  scene={s}
                  index={i}
                  devices={devices}
                  props={props}
                  onAir={s.id === programId}
                  selected={s.id === previewId}
                  onSelect={() => setPreviewId(s.id)}
                  onTake={() => (setPreviewId(s.id), void take(s))}
                  onEdit={() => setEditing(s)}
                />
              ))}
            </div>
          </section>
        </div>

        <aside className="flex flex-col gap-3">
          <OutputsPanel show={show} live={live} isBox={!!box} recordLocal={recordLocal} onRecordLocal={setRecordLocal} />
          <OverlaysPanel config={config} setConfig={setConfig} />
        </aside>
      </div>

      <SceneEditor
        scene={editing}
        devices={devices}
        props={props}
        onClose={() => setEditing(null)}
        onSave={(s) => {
          setConfig((c) => ({ ...c, scenes: c.scenes.map((x) => (x.id === s.id ? s : x)) }));
          if (s.id === programId) void mixer.take(resolve(s), 0);
          setEditing(null);
        }}
        onDelete={(s) => {
          setConfig((c) => ({ ...c, scenes: c.scenes.filter((x) => x.id !== s.id) }));
          if (previewId === s.id) setPreviewId(null);
          setEditing(null);
        }}
      />
      <ConfirmDialog
        open={confirmEnd}
        onOpenChange={setConfirmEnd}
        title={recordLocal && box ? "Stop recording?" : "End the show?"}
        description={recordLocal && box ? "The recording is saved on this PC — find it under Recordings on the Studio page." : "The broadcast stops for everyone watching (AirBattleground and YouTube). You can go live again any time."}
        confirmLabel={recordLocal && box ? "Stop recording" : "End show"}
        destructive
        onConfirm={() => void endLive()}
      />
    </div>
  );
}

// ---------------------------------------------------------------- monitors

function MonitorLabel({ tone, text, sub }: { tone: "live" | "program" | "preview"; text: string; sub?: string }) {
  return (
    <p className="mb-1.5 flex items-center gap-2 text-xs font-bold tracking-[0.2em] uppercase">
      <span className={cn("rounded px-1.5 py-0.5", tone === "live" ? "bg-destructive text-white" : tone === "program" ? "bg-primary/15 text-primary" : "bg-warning/15 text-warning-foreground dark:text-warning")}>{text}</span>
      {sub && <span className="truncate font-semibold tracking-normal text-muted-foreground normal-case">{sub}</span>}
    </p>
  );
}

function ProgramMonitor({ mixer, live }: { mixer: StudioMixer; live: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    mixer.canvas.className = "block h-auto w-full";
    el.appendChild(mixer.canvas);
    return () => {
      if (mixer.canvas.parentElement === el) el.removeChild(mixer.canvas);
    };
  }, [mixer]);
  return <div ref={host} className={cn("overflow-hidden rounded-lg border-2 bg-black", live ? "border-destructive shadow-[0_0_30px_-6px_var(--destructive)]" : "border-primary/40")} style={{ aspectRatio: `${STUDIO_WIDTH}/${STUDIO_HEIGHT}` }} />;
}

function PreviewMonitor({ mixer, scene }: { mixer: StudioMixer; scene: Scene | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (scene) void mixer.prepare(scene.slots);
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const t = window.setInterval(() => {
      ctx.setTransform(c.width / STUDIO_WIDTH, 0, 0, c.height / STUDIO_HEIGHT, 0, 0);
      mixer.drawScene(ctx, scene);
    }, 125);
    return () => window.clearInterval(t);
  }, [mixer, scene]);
  return <canvas ref={ref} width={480} height={270} className="block aspect-video w-full rounded-lg border-2 border-warning/50 bg-black" />;
}

// ---------------------------------------------------------------- match bar (capture)

type Kind = "SLOT_LIST" | "RESULTS";

/** Link of a match's match center (scrim or tournament). */
function matchCenterHref(d: MatchDetail): string {
  return d.tournament
    ? `/manager/tournaments/${d.tournament.id}/stages/${d.tournament.stageId}/matches/${d.match.id}`
    : `/manager/scrims/${d.scrim.id}/${d.date}/matches/${d.match.id}`;
}

/**
 * Under the program monitor while a match is selected: capture what's ON AIR as the match's team-list or results
 * screenshot (put the scoreboard on screen first), plus a link to the match center to check what was read.
 */
function MatchBar({ mixer, matchId, detail, onCaptured }: { mixer: StudioMixer; matchId: string; detail: MatchDetail | null; onCaptured: () => void }) {
  const [busy, setBusy] = useState<Kind | null>(null);
  const counts = detail?.match.screenshotCounts;
  const capture = async (kind: Kind) => {
    setBusy(kind);
    try {
      const png = await mixer.snapshot();
      const form = new FormData();
      form.append("kind", kind);
      form.append("source", "WEB");
      form.append("files", new File([png], `studio-${kind.toLowerCase()}-${Date.now()}.png`, { type: "image/png" }));
      const res = await fetch(`/api/manager/matches/${matchId}/screenshots`, { method: "POST", credentials: "include", body: form });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "Upload failed");
      }
      toast.success(kind === "SLOT_LIST" ? "Team list captured" : "Results captured", {
        description: "It's being read now — check it in the match center.",
        action: detail ? { label: "Open", onClick: () => window.open(matchCenterHref(detail), "_blank") } : undefined,
      });
      onCaptured();
    } catch (e) {
      toast.error("Couldn't capture", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  };
  const btn = (kind: Kind, icon: React.ReactNode, label: string, n?: number) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="sm" disabled={!!busy} onClick={() => void capture(kind)} aria-label={`Capture ${label} from the screen`} className="gap-1.5">
          {busy === kind ? <Loader2 className="animate-spin" /> : icon}
          {label}
          {n ? <span className="rounded-full bg-muted px-1.5 text-[10px] font-bold">{n}</span> : null}
        </Button>
      </TooltipTrigger>
      <TooltipContent>Show the {label.toLowerCase()} on air, then capture</TooltipContent>
    </Tooltip>
  );
  return (
    <div data-tour="studio-capture" className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2">
      <Camera className="size-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 truncate text-sm">
        <span className="font-semibold">{detail ? `${detail.scrim.title} · Match ${detail.match.number}` : "Match"}</span>
        <span className="text-muted-foreground"> · capture what's on air</span>
      </span>
      {btn("SLOT_LIST", <ListOrdered />, "Team list", counts?.slotList)}
      {btn("RESULTS", <Trophy />, "Results", counts?.results)}
      {detail && (
        <Button asChild variant="ghost" size="sm">
          <Link to={matchCenterHref(detail)} target="_blank">
            Match center <ExternalLink />
          </Link>
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- health

function LiveHealth({ mix, status, workerLive }: { mix: MixerStatus | null; status: StudioStatus | null; workerLive: boolean }) {
  if (workerLive) return <WorkerHealth status={status} />;
  if (!mix?.live) return null;
  const secs = mix.liveSince ? Math.floor((Date.now() - mix.liveSince) / 1000) : 0;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded bg-destructive px-2 py-1 font-bold text-white">● LIVE {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</span>
      <span className={cn("rounded px-2 py-1 font-semibold", mix.backlog > 3 ? "bg-warning/20 text-warning-foreground dark:text-warning" : "bg-success/15 text-success")}>
        {mix.backlog > 3 ? `Slow upload · ${mix.backlog}s behind` : `Upload ${(mix.uploadKbps / 1000).toFixed(1)} Mbps`}
      </span>
      <span className={cn("rounded px-2 py-1 font-semibold tabular-nums", mix.fps && mix.fps < STUDIO_FPS * 0.85 ? "bg-warning/20 text-warning-foreground dark:text-warning" : "bg-muted")} title={mix.fps && mix.fps < STUDIO_FPS * 0.85 ? "This computer can't keep up with 60 frames a second. Close other tabs and apps, or keep this tab in front." : "Frames per second the Studio is drawing"}>
        {mix.fps} fps
      </span>
      {mix.bitrateKbps < 6000 && (
        <span className="rounded bg-muted px-2 py-1" title="Your internet upload couldn't keep up, so the Studio lowered the video quality to stay live. Close other uploads (or move the phone to mobile data) and go live again for full quality.">
          Quality lowered to keep up · {(mix.bitrateKbps / 1000).toFixed(1)} Mbps
        </span>
      )}
      {mix.error && <span className="rounded bg-destructive/15 px-2 py-1 font-semibold text-destructive">{mix.error}</span>}
      <OutputChips status={status} />
    </div>
  );
}

/** While a Studio worker runs the show: its name, frame rate, encoder and send rate instead of the upload chip. */
function WorkerHealth({ status }: { status: StudioStatus | null }) {
  // tick the clock every second (the mixer here isn't live, so nothing else re-renders)
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  const since = status?.liveSince ? Date.parse(status.liveSince) : null;
  const secs = since ? Math.max(0, Math.floor((Date.now() - since) / 1000)) : 0;
  const w = status?.worker ?? null;
  const slow = w?.fps != null && w.fps < STUDIO_FPS * 0.85;
  const gpu = !!w?.encoder && w.encoder !== "libx264";
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded bg-destructive px-2 py-1 font-bold text-white">● LIVE {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</span>
      {w && (
        <span className={cn("flex items-center gap-1.5 rounded px-2 py-1 font-semibold", w.online ? "bg-success/15 text-success" : "bg-warning/20 text-warning-foreground dark:text-warning")} title="This show runs on a Studio worker — closing this tab doesn't stop it">
          <Server className="size-3.5" /> {w.name}
          {!w.online && " · not responding"}
        </span>
      )}
      {w?.fps != null && (
        <span className={cn("rounded px-2 py-1 font-semibold tabular-nums", slow ? "bg-warning/20 text-warning-foreground dark:text-warning" : "bg-muted")} title={slow ? "The worker can't keep up with 60 frames a second. Close other apps on it." : "Frames per second the worker is drawing"}>
          {w.fps} fps
        </span>
      )}
      {w?.encoder && (
        <span className="flex items-center gap-1 rounded bg-muted px-2 py-1" title={`Encoder: ${w.encoder}`}>
          {gpu && <span className="rounded bg-primary px-1 text-[9px] font-bold text-primary-foreground">GPU</span>}
          {gpu ? w.encoder.replace(/^h264_/, "").toUpperCase() : "CPU"}
        </span>
      )}
      {w?.bitrateKbps != null && <span className="rounded bg-muted px-2 py-1 tabular-nums">Sending {(w.bitrateKbps / 1000).toFixed(1)} Mbps</span>}
      {w?.error && <span className="rounded bg-destructive/15 px-2 py-1 font-semibold text-destructive">{w.error}</span>}
      <OutputChips status={status} />
    </div>
  );
}

function OutputChips({ status }: { status: StudioStatus | null }) {
  return (
    <>
      {status?.destinations.map((d) => (
        <span key={d.id} className="flex items-center gap-1 rounded bg-muted px-2 py-1">
          <span className={cn("size-1.5 rounded-full", d.ok ? "bg-success" : "bg-warning")} /> {d.name}
        </span>
      ))}
      {status?.youtube &&
        (status.youtube.watchUrl ? (
          <a href={status.youtube.watchUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded bg-muted px-2 py-1 hover:text-primary">
            <Youtube className="size-3.5 text-destructive" /> YouTube <ExternalLink className="size-3" />
          </a>
        ) : (
          <span className="rounded bg-destructive/15 px-2 py-1 text-destructive" title={status.youtube.error ?? undefined}>
            YouTube: {status.youtube.error}
          </span>
        ))}
    </>
  );
}

// ---------------------------------------------------------------- runs on (browser / Studio worker)

function RunsOnPicker({ value, workers, showId, onChange }: { value: string; workers: StudioWorkerRow[]; showId: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger data-tour="studio-runs-on" size="sm" className="h-9 w-48 text-xs" aria-label="Where the show runs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={RUN_BROWSER}>
          <Monitor className="size-3.5" /> This browser
        </SelectItem>
        {workers.map((w) => {
          const busy = !!w.showId && w.showId !== showId;
          return (
            <SelectItem key={w.id} value={w.id} disabled={!w.online}>
              <span className={cn("size-2 shrink-0 rounded-full", w.online ? "bg-success" : "bg-muted-foreground/40")} />
              <span className="truncate">{w.name}</span>
              <span className="text-muted-foreground">{!w.online ? "· offline" : busy ? "· busy" : isThisBox(w) ? "· this box" : ""}</span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------- scenes

function sourceLabel(ref: SourceRef | null, devices: StudioDevice[], props: PropMeta[]): string {
  if (!ref) return "Empty";
  switch (ref.kind) {
    case "device":
      return devices.find((d) => d.id === ref.id)?.name ?? "Device";
    case "prop":
      return props.find((p) => p.id === ref.id)?.name ?? "Prop video";
    case "camera":
      return "Webcam";
    case "scorecard":
      return "Scorecard";
    case "mvp":
      return "MVP card";
    case "slate":
      return "Starting soon";
  }
}

function LayoutIcon({ layout, className }: { layout: LayoutKind; className?: string }) {
  const { rects } = LAYOUTS[layout];
  return (
    <svg viewBox={`0 0 ${STUDIO_WIDTH} ${STUDIO_HEIGHT}`} className={cn("rounded-sm bg-black/60", className)} aria-hidden>
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx={r.framed ? 24 : 0} className={i === 0 ? "fill-primary/60" : "fill-warning/70"} />
      ))}
    </svg>
  );
}

function SceneCard(props: { scene: Scene; index: number; devices: StudioDevice[]; props: PropMeta[]; onAir: boolean; selected: boolean; onSelect: () => void; onTake: () => void; onEdit: () => void }) {
  const { scene, index, onAir, selected } = props;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={props.onSelect}
      onDoubleClick={props.onTake}
      onKeyDown={(e) => e.key === "Enter" && props.onTake()}
      className={cn(
        "group relative cursor-pointer rounded-lg border bg-background/60 p-2 transition-all outline-none hover:border-primary/50 focus-visible:ring-[3px] focus-visible:ring-ring/50",
        selected && "border-warning ring-1 ring-warning/50",
        onAir && "border-destructive ring-2 ring-destructive/60",
      )}
    >
      <LayoutIcon layout={scene.layout} className="aspect-video w-full" />
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="rounded bg-muted px-1 font-mono text-[10px] font-bold">{index + 1}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{scene.name}</span>
        {onAir && <span className="rounded bg-destructive px-1 text-[9px] font-bold text-white">AIR</span>}
      </div>
      <p className="truncate text-[11px] text-muted-foreground">{scene.slots.map((s) => sourceLabel(s, props.devices, props.props)).join(" · ")}</p>
      <button
        type="button"
        aria-label={`Edit ${scene.name}`}
        onClick={(e) => (e.stopPropagation(), props.onEdit())}
        className="absolute top-3 right-3 rounded bg-background/80 p-1 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
      >
        <Pencil className="size-3.5" />
      </button>
    </div>
  );
}

const SLOT_NONE = "none";

function refToValue(r: SourceRef | null) {
  return r ? sourceKey(r) : SLOT_NONE;
}
function valueToRef(v: string): SourceRef | null {
  if (v === SLOT_NONE) return null;
  const [kind, id] = v.split(":") as [SourceRef["kind"], string];
  return kind === "device" || kind === "prop" ? ({ kind, id } as SourceRef) : ({ kind } as SourceRef);
}

function SceneEditor({ scene, devices, props, onClose, onSave, onDelete }: { scene: Scene | null; devices: StudioDevice[]; props: PropMeta[]; onClose: () => void; onSave: (s: Scene) => void; onDelete: (s: Scene) => void }) {
  const [draft, setDraft] = useState<Scene | null>(scene);
  useEffect(() => setDraft(scene), [scene]);
  if (!draft) return null;
  const lay = LAYOUTS[draft.layout];
  const options: { value: string; label: string }[] = [
    { value: SLOT_NONE, label: "Empty" },
    ...devices.map((d) => ({ value: `device:${d.id}`, label: `📱 ${d.name}` })),
    { value: "camera:", label: "🎥 Webcam" },
    ...props.map((p) => ({ value: `prop:${p.id}`, label: `🎞 ${p.name}` })),
    { value: "scorecard:", label: "📊 Scorecard" },
    { value: "mvp:", label: "⭐ MVP card" },
    { value: "slate:", label: "⏳ Starting soon (intro)" },
  ];
  return (
    <Dialog open={!!scene} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit scene</DialogTitle>
          <DialogDescription>Pick a frame, then what goes in each part of it.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="scene-name">Scene name</Label>
            <Input id="scene-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label>Frame</Label>
            <div className="grid grid-cols-5 gap-2">
              {(Object.keys(LAYOUTS) as LayoutKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setDraft({ ...draft, layout: k, slots: Array.from({ length: LAYOUTS[k].slots }, (_, i) => draft.slots[i] ?? null) })}
                  className={cn("rounded-md border p-1 text-[10px] font-semibold", draft.layout === k ? "border-primary ring-1 ring-primary" : "hover:border-primary/50")}
                  title={LAYOUTS[k].label}
                >
                  <LayoutIcon layout={k} className="aspect-video w-full" />
                  <span className="mt-1 block truncate">{LAYOUTS[k].label}</span>
                </button>
              ))}
            </div>
          </div>
          {lay.slotNames.map((name, i) => (
            <div key={name} className="grid gap-1.5">
              <Label>{name}</Label>
              <Select value={refToValue(draft.slots[i] ?? null)} onValueChange={(v) => setDraft({ ...draft, slots: draft.slots.map((s, j) => (j === i ? valueToRef(v) : s)) })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" className="text-destructive" onClick={() => onDelete(draft)}>
            <Trash2 /> Delete scene
          </Button>
          <Button onClick={() => onSave({ ...draft, name: draft.name.trim() || "Scene" })}>
            <Check /> Save scene
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- sources

function SourcesPanel({
  mixer,
  devices,
  box,
  props,
  setProps,
  config,
  setConfig,
}: {
  mixer: StudioMixer;
  devices: StudioDevice[];
  box: BoxCtx;
  props: PropMeta[];
  setProps: (p: PropMeta[]) => void;
  config: StudioConfigV1;
  setConfig: React.Dispatch<React.SetStateAction<StudioConfigV1>>;
}) {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [monitor, setMonitor] = useState(false);
  const [level, setLevel] = useState(0);
  const [camOn, setCamOn] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = window.setInterval(() => setLevel(mixer.micLevel()), 100);
    return () => window.clearInterval(t);
  }, [mixer]);

  const enableMic = async (id: string) => {
    try {
      await mixer.setMic(id);
      setMicId(id);
      const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
      setMics(list);
    } catch {
      toast.error("Couldn't open the microphone", { description: "Allow microphone access in the browser and try again." });
    }
  };

  return (
    <aside data-tour="studio-sources-panel" className="flex flex-col gap-3">
      {box ? (
        <Panel title="Phones" icon={<Smartphone />}>
          <BoxPhonesList devices={box.devices} />
        </Panel>
      ) : (
      <Panel title="Phones" icon={<Smartphone />}>
        {devices.length === 0 && <p className="text-xs text-muted-foreground">No devices yet.</p>}
        <ul className="space-y-1.5">
          {devices.map((d) => (
            <li key={d.id} className="flex items-center gap-2 text-sm">
              <span className={cn("size-2 rounded-full", d.videoReady ? "bg-success" : "bg-muted-foreground/40")} />
              <span className="min-w-0 flex-1 truncate">{d.name}</span>
              <span className="text-[11px] text-muted-foreground">{d.videoReady ? "live" : "off"}</span>
            </li>
          ))}
        </ul>
      </Panel>
      )}

      <Panel title="Host" icon={<Mic />}>
        <div className="space-y-2">
          <Select value={micId ?? ""} onValueChange={(v) => void enableMic(v)}>
            <SelectTrigger className="h-9 w-full text-xs">
              <SelectValue placeholder="Turn on microphone" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default microphone</SelectItem>
              {mics.filter((m) => m.deviceId && m.deviceId !== "default").map((m) => (
                <SelectItem key={m.deviceId} value={m.deviceId}>
                  {m.label || "Microphone"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {micId && (
            <div className="flex items-center gap-2">
              <Button size="icon-sm" variant={muted ? "destructive" : "outline"} aria-label={muted ? "Unmute" : "Mute"} onClick={() => (mixer.setMicMuted(!muted), setMuted(!muted))}>
                {muted ? <MicOff /> : <Mic />}
              </Button>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div className={cn("h-full transition-[width] duration-100", level > 0.85 ? "bg-destructive" : "bg-success")} style={{ width: `${muted ? 0 : level * 100}%` }} />
              </div>
            </div>
          )}
          <label className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5">
              <Headphones className="size-3.5" /> Hear the mix (headphones)
            </span>
            <Switch checked={monitor} onCheckedChange={(on) => (mixer.setMonitor(on), setMonitor(on))} />
          </label>
          <label className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5">{camOn ? <Camera className="size-3.5" /> : <CameraOff className="size-3.5" />} Webcam</span>
            <Switch
              checked={camOn}
              onCheckedChange={(on) => {
                setCamOn(on);
                if (on) void mixer.prepare([{ kind: "camera" }]);
              }}
            />
          </label>
          <p className="text-[11px] text-muted-foreground">Put the webcam in a scene (e.g. “Game + host”) to show it.</p>
        </div>
      </Panel>

      <Panel title="Prop videos" icon={<Film />}>
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              await addProp(f);
              setProps(await listProps());
              toast.success("Prop added", { description: "Saved in this browser. Use it in any scene." });
            } catch {
              toast.error("Couldn't save the video in this browser");
            }
          }}
        />
        <Button size="sm" variant="outline" className="w-full" onClick={() => fileRef.current?.click()}>
          <Upload /> Add video (intro, break…)
        </Button>
        <ul className="mt-2 space-y-1.5">
          {props.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-sm">
              <Film className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <button
                type="button"
                title="Play on the Starting soon scene"
                onClick={() => setConfig((c) => ({ ...c, introPropId: c.introPropId === p.id ? null : p.id }))}
                className={cn("rounded px-1.5 text-[10px] font-bold", config.introPropId === p.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}
              >
                INTRO
              </button>
              <button
                type="button"
                aria-label={`Remove ${p.name}`}
                onClick={async () => {
                  await removeProp(p.id);
                  setProps(await listProps());
                }}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-muted-foreground">Tag one as INTRO: it loops on “Starting soon” until you switch scenes.</p>
      </Panel>
    </aside>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-3">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-bold [&_svg]:size-4 [&_svg]:text-primary">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------- overlays

/** Where the show goes: public Live page, the site YouTube channel (if connected), own stream-key channels. */
function OutputsPanel({ show, live, isBox, recordLocal, onRecordLocal }: { show: StudioShow; live: boolean; isBox: boolean; recordLocal: boolean; onRecordLocal: (v: boolean) => void }) {
  const outputs = useStudioOutputs();
  const qcOutputs = () => outputs.refetch();
  const update = useUpdateShow(show.id);
  const [pub, setPub] = useState(show.publicListing);
  const [yt, setYt] = useState(show.siteYoutube);
  const [dests, setDests] = useState<string[]>(show.destinationIds);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const del = useDeleteDestination();
  const o = outputs.data;
  const save = (patch: { publicListing?: boolean; siteYoutube?: boolean; destinationIds?: string[]; recordLocal?: boolean }) => update.mutate(patch);
  return (
    <Panel title="Where it goes" icon={<Radio />}>
      <div className="space-y-2.5 text-sm">
        {isBox && (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            className="w-full"
            data-tour="studio-mode"
            value={recordLocal ? "record" : "stream"}
            disabled={live}
            onValueChange={(v) => {
              if (!v) return;
              const rec = v === "record";
              onRecordLocal(rec);
              save({ recordLocal: rec });
            }}
          >
            <ToggleGroupItem value="stream" className="flex-1">
              <Radio /> Stream
            </ToggleGroupItem>
            <ToggleGroupItem value="record" className="flex-1">
              <Film /> Record on this box
            </ToggleGroupItem>
          </ToggleGroup>
        )}
        {recordLocal ? (
          <p className="rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">
            The show is saved on this PC only — nothing is sent to YouTube, AirBattleground or any other platform. Find it under Recordings on the Studio page.
          </p>
        ) : (
        <>
        <Row label="AirBattleground Live page" checked={pub} disabled={live} onChange={(v) => (setPub(v), save({ publicListing: v }))} />
        {!pub && <p className="-mt-1 text-[11px] text-muted-foreground">Private: only you can watch (a test stream).</p>}
        {o?.siteYoutube ? (
          <Row
            label={
              <span className="flex items-center gap-1.5">
                <Youtube className="size-4 text-destructive" /> {o.siteYoutube.channelTitle}
              </span>
            }
            checked={yt}
            disabled={live}
            onChange={(v) => (setYt(v), save({ siteYoutube: v }))}
          />
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Youtube className="size-4" /> Site YouTube channel isn't connected
          </p>
        )}
        {(o?.destinations ?? []).map((d) => (
          <div key={d.id} className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <Row
                label={
                  <span className="flex items-center gap-1.5">
                    {d.kind === "YOUTUBE" && <Youtube className="size-4 text-destructive" />} {d.name}
                  </span>
                }
                checked={dests.includes(d.id)}
                disabled={live}
                onChange={(v) => {
                  const next = v ? [...dests, d.id] : dests.filter((x) => x !== d.id);
                  setDests(next);
                  save({ destinationIds: next });
                }}
              />
            </div>
            {!live && (
              <Button size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-destructive" aria-label={`Remove ${d.name}`} onClick={() => setRemoving(d)}>
                <Trash2 />
              </Button>
            )}
          </div>
        ))}
        {!live && (
          <Button size="sm" variant="outline" className="w-full" onClick={() => setAdding(true)}>
            <Plus /> Add stream key (YouTube, Facebook…)
          </Button>
        )}
        <StreamKeyDialog
          open={adding}
          onOpenChange={setAdding}
          onAdded={(id) => {
            const next = [...dests, id];
            setDests(next);
            save({ destinationIds: next });
          }}
        />
        <ConfirmDialog
          open={!!removing}
          onOpenChange={(v) => !v && setRemoving(null)}
          title={`Remove ${removing?.name ?? "this stream key"}?`}
          description="The Studio stops sending shows there. You can add the key again any time."
          confirmLabel="Remove"
          destructive
          onConfirm={() => {
            if (!removing) return;
            const id = removing.id;
            del.mutate(id, {
              onSuccess: () => {
                const next = dests.filter((x) => x !== id);
                setDests(next);
                save({ destinationIds: next });
                void qcOutputs();
              },
            });
          }}
        />
        </>
        )}
        {live && <p className="text-[11px] text-muted-foreground">Change these before going live.</p>}
      </div>
    </Panel>
  );
}

function OverlaysPanel({ config, setConfig }: { config: StudioConfigV1; setConfig: React.Dispatch<React.SetStateAction<StudioConfigV1>> }) {
  const o = config.overlays;
  const set = (patch: Partial<StudioConfigV1["overlays"]>) => setConfig((c) => ({ ...c, overlays: { ...c.overlays, ...patch } }));
  return (
    <>
      <Panel title="Overlays" icon={<Layers />}>
        <div className="space-y-2.5 text-sm">
          <Row label="LIVE bug + clock" checked={o.liveBug} onChange={(v) => set({ liveBug: v })} />
          <Row label="Broadcast layout (teams, points)" checked={o.layout} onChange={(v) => set({ layout: v })} />
          <Row label="Lower third (host name)" checked={o.lowerThird} onChange={(v) => set({ lowerThird: v })} />
          {o.lowerThird && (
            <div className="grid gap-1.5 pl-1">
              <Input value={o.lowerTitle} onChange={(e) => set({ lowerTitle: e.target.value })} placeholder="Host name" className="h-8 text-sm" />
              <Input value={o.lowerSubtitle} onChange={(e) => set({ lowerSubtitle: e.target.value })} placeholder="Role, e.g. Caster" className="h-8 text-sm" />
            </div>
          )}
          <Row label="Ticker" checked={o.ticker} onChange={(v) => set({ ticker: v })} />
          {o.ticker && <Input value={o.tickerText} onChange={(e) => set({ tickerText: e.target.value })} placeholder="e.g. Next match at 9 PM · Follow us on Instagram" className="h-8 text-sm" />}
        </div>
      </Panel>
    </>
  );
}

function Row({ label, checked, onChange, disabled }: { label: React.ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={cn("flex items-center justify-between gap-2", disabled && "opacity-60")}>
      <span className="min-w-0 truncate">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </label>
  );
}

// ---------------------------------------------------------------- match + layout overlay

function MatchPicker({ value, onChange, disabled }: { value: string | null; onChange: (id: string | null) => void; disabled?: boolean }) {
  const matches = useUpcomingMatches();
  const items = useMemo(() => matches.data ?? [], [matches.data]);
  return (
    <Select value={value ?? NO_MATCH} onValueChange={(v) => onChange(v === NO_MATCH ? null : v)} disabled={disabled}>
      <SelectTrigger className="h-9 w-64 text-xs">
        <SelectValue placeholder="Match" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_MATCH}>No match (no scorecard)</SelectItem>
        {items.map((m) => (
          <SelectItem key={m.matchId} value={m.matchId}>
            {m.title} · {m.subtitle}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
