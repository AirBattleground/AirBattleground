/**
 * /studio-render/:showId — opened by a Studio worker's headless Chrome (signed in as the show's manager). It renders
 * the show's program from the control state with the same StudioMixer the console uses, records it and hands the
 * chunks to the worker (window.__swChunk), which encodes and publishes the broadcast. No layout, nav or tour.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { RENDER_VIDEO_BPS, STUDIO_HEIGHT, STUDIO_WIDTH, type RenderStatus, type ShowControlState, type StudioShow } from "@7xen/shared";
import { useAuth } from "@/lib/auth";
import { useMatch } from "@/features/matches/api";
import { pollControl, useShow } from "@/features/studio/api";
import { asConfig, fadeMsOf, resolveSceneForWorker } from "@/features/studio/config";
import { StudioMixer } from "@/features/studio/engine/mixer";
import { useOverlayImage } from "@/features/studio/overlayImage";
import { useBox, useBoxDevices, useMixerDeviceUrls } from "@/features/studio/box";
import type { SourceRef } from "@/features/studio/engine/types";

declare global {
  interface Window {
    /** set by the Studio worker: one recorder chunk (base64 WebM) */
    __swChunk?: (base64: string) => Promise<void>;
    /** set by the Studio worker: render health, about once a second */
    __swStatus?: (s: RenderStatus) => void;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toBase64(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      // "data:video/webm;codecs=vp8,opus;base64,…" — the MIME type itself has a comma, so cut after ";base64,"
      const s = r.result as string;
      const at = s.indexOf(";base64,");
      resolve(at >= 0 ? s.slice(at + 8) : s.slice(s.lastIndexOf(",") + 1));
    };
    r.onerror = () => reject(r.error ?? new Error("Couldn't read the chunk"));
    r.readAsDataURL(b);
  });
}

export default function RenderPage() {
  const { showId = "" } = useParams();
  const [mixer, setMixer] = useState<StudioMixer | null>(null);
  // on a Studio Box the phones play from the box itself — wait for that check before loading any source
  const box = useBox();
  // one mixer per mount (created in the effect so StrictMode's double mount gets a fresh, working one)
  useEffect(() => {
    const m = new StudioMixer();
    setMixer(m);
    return () => m.dispose();
  }, []);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-black">
      {mixer && box.ready && <Render key={mixer.id} showId={showId} mixer={mixer} isBox={box.isBox} />}
    </div>
  );
}

function Render({ showId, mixer, isBox }: { showId: string; mixer: StudioMixer; isBox: boolean }) {
  const { user } = useAuth();
  const boxDevices = useBoxDevices(isBox);
  useMixerDeviceUrls(mixer, isBox, boxDevices.data);
  const show = useShow(showId);
  const host = useRef<HTMLDivElement>(null);
  const [ctl, setCtl] = useState<ShowControlState | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [tookFirst, setTookFirst] = useState(false);

  // the canvas on screen (the recorder reads it either way; showing it helps when watching the worker)
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    mixer.canvas.style.width = `${STUDIO_WIDTH}px`;
    mixer.canvas.style.height = `${STUDIO_HEIGHT}px`;
    mixer.canvas.className = "block";
    el.appendChild(mixer.canvas);
    void mixer.resumeAudio();
    return () => {
      if (mixer.canvas.parentElement === el) el.removeChild(mixer.canvas);
    };
  }, [mixer]);

  // long-poll the control state
  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      let since = -1; // first request answers at once (a new show is at version 0)
      while (!ac.signal.aborted) {
        try {
          const s = await pollControl(showId, since, ac.signal);
          since = s.version;
          setPollError(null);
          setCtl((prev) => (prev && prev.version === s.version && prev.state === s.state ? prev : s));
        } catch {
          if (ac.signal.aborted) return;
          setPollError("Can't reach the server");
          await sleep(2000);
        }
      }
    })();
    return () => ac.abort();
  }, [showId]);

  // config: from the control state, else the show as loaded
  const rawConfig = ctl?.config ?? show.data?.config ?? null;
  const configKey = JSON.stringify(rawConfig);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const config = useMemo(() => asConfig(rawConfig), [configKey]);

  useEffect(() => {
    if (config) mixer.overlays = config.overlays;
  }, [config, mixer]);

  // match data (scorecard / MVP) + the broadcast layout overlay
  const matchId = ctl ? ctl.matchId : (show.data?.match?.id ?? null);
  const match = useMatch(matchId ?? undefined);
  useEffect(() => {
    mixer.setMatch(match.data ?? null, user?.displayName ?? "");
  }, [match.data, mixer, user?.displayName]);
  const refetchMatch = match.refetch;
  useEffect(() => {
    if (!matchId) return;
    const t = window.setInterval(() => void refetchMatch(), 10_000);
    return () => window.clearInterval(t);
  }, [matchId, refetchMatch]);
  useOverlayImage(mixer, !!config?.overlays.layout, matchId);

  // load every scene's sources up front so cuts are instant
  useEffect(() => {
    if (!config) return;
    const refs: SourceRef[] = [];
    for (const s of config.scenes) for (const r of resolveSceneForWorker(s).slots) if (r) refs.push(r);
    void mixer.prepare(refs).catch(() => undefined);
  }, [config, mixer]);

  // the program: a new take (programId / takeSeq) fades per the show's transition; an edit of the scene on air cuts
  const programId = ctl?.programId ?? null;
  const takeSeq = ctl?.takeSeq ?? 0;
  const scene = config ? (config.scenes.find((s) => s.id === programId) ?? config.scenes[0] ?? null) : null;
  const resolved = scene ? resolveSceneForWorker(scene) : null;
  const sceneKey = JSON.stringify(resolved);
  const last = useRef<{ id: string; seq: number; key: string } | null>(null);
  // takes run one after another (a slow-loading source can't let an older take land after a newer one)
  const chain = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (!resolved || !config || !ctl) return;
    const prev = last.current;
    if (prev && prev.id === resolved.id && prev.seq === takeSeq && prev.key === sceneKey) return;
    const isTake = !prev || prev.id !== resolved.id || prev.seq !== takeSeq;
    last.current = { id: resolved.id, seq: takeSeq, key: sceneKey };
    const fade = isTake ? fadeMsOf(config) : 0;
    const next = resolved;
    chain.current = chain.current
      .then(() => mixer.take(next, fade))
      .catch(() => undefined)
      .finally(() => setTookFirst(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneKey, takeSeq, !!ctl, mixer]);

  // LIVE bug clock
  const state = ctl?.state ?? null;
  const liveSince = useLiveSince(show.data, state);
  useEffect(() => {
    mixer.setLiveClock(state === "LIVE" ? liveSince : null);
  }, [mixer, state, liveSince]);

  // record + hand chunks to the worker once the first scene is on air; stop when the show ends
  useEffect(() => {
    if (state === "ENDED") {
      mixer.stopCapture();
      return;
    }
    if (!tookFirst || !window.__swChunk || mixer.capturing) return;
    mixer.startCapture({
      bitsPerSecond: RENDER_VIDEO_BPS,
      timesliceMs: 500,
      onChunk: async (blob) => {
        const send = window.__swChunk;
        if (!send) return;
        await send(await toBase64(blob));
      },
    });
  }, [tookFirst, state, mixer]);

  // health → the worker, about once a second (and keep the audio engine awake)
  const pollErrorRef = useRef(pollError);
  pollErrorRef.current = pollError;
  useEffect(() => {
    const t = window.setInterval(() => {
      void mixer.resumeAudio();
      window.__swStatus?.({ fps: mixer.status.fps, recording: mixer.capture.recording, error: mixer.capture.error ?? pollErrorRef.current });
    }, 1000);
    return () => window.clearInterval(t);
  }, [mixer]);

  return <div ref={host} />;
}

/** When the show went on air (from the show, else when this page first saw it live). */
function useLiveSince(show: StudioShow | undefined, state: ShowControlState["state"] | null): number | null {
  const seen = useRef<number | null>(null);
  if (state === "LIVE" && seen.current === null) seen.current = Date.now();
  if (state !== "LIVE") seen.current = null;
  const fromShow = show?.liveSince ? Date.parse(show.liveSince) : NaN;
  if (state !== "LIVE") return null;
  return Number.isFinite(fromShow) ? fromShow : seen.current;
}
