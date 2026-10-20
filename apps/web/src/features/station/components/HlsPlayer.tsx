import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type Hls from "hls.js";
import { Loader2, Maximize, Minimize, Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { cn } from "@7xen/ui/lib/utils";
import { fmtDuration } from "@/features/live/format";
import { useT } from "@/i18n/core";
import { liveMsg } from "@/i18n/live";

export type PlayerState = "connecting" | "playing" | "ended";

/** Pulsing red "LIVE" badge, optionally with the elapsed time since `startedAt`. */
export function LiveBadge({ startedAt, className }: { startedAt?: string | null; className?: string }) {
  const elapsed = useElapsed(startedAt);
  const t = useT(liveMsg);
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md bg-destructive px-2 py-0.5 font-display text-xs font-bold tracking-wider text-destructive-foreground uppercase shadow-sm", className)}>
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive-foreground opacity-70" />
        <span className="relative inline-flex size-2 rounded-full bg-destructive-foreground" />
      </span>
      {t("live_label")}
      {elapsed != null && <span className="font-sans font-semibold tabular-nums normal-case opacity-90">{fmtDuration(elapsed)}</span>}
    </span>
  );
}

export function useElapsed(startedAt?: string | null): number | null {
  const start = startedAt ? new Date(startedAt).getTime() : NaN;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!Number.isFinite(start)) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [start]);
  return Number.isFinite(start) ? Math.max(0, (now - start) / 1000) : null;
}

/** Rewind keeps this much of the stream in the browser (the browser may drop older parts sooner if memory runs low). */
const DVR_KEEP_SEC = 30 * 60;

const canPlayNative = (v: HTMLVideoElement) => !!v.canPlayType("application/vnd.apple.mpegurl");
const backoff = (attempt: number) => Math.min(5_000, 750 * 2 ** Math.min(attempt, 3));

/**
 * Live HLS player: hls.js (low-latency settings) with native HLS for Safari/iOS.
 * - Reconnects while the playlist briefly 404s (the stream starts a few seconds after the station goes live).
 * - Recovers from media errors, jumps back to the live edge when the tab becomes visible again.
 * - `children` render over the picture (e.g. the remote-control layer); `hud` renders in the top-right corner.
 */
export function HlsPlayer({
  src,
  startedAt,
  ended,
  endedSlot,
  videoRef: externalRef,
  onStateChange,
  children,
  hud,
  className,
  frameClassName,
  label,
  showLiveBadge = true,
  dvr = false,
}: {
  src: string | null;
  startedAt?: string | null;
  /** the caller knows the stream is over: stop reconnecting and show `endedSlot` */
  ended?: boolean;
  endedSlot?: ReactNode;
  videoRef?: RefObject<HTMLVideoElement | null>;
  onStateChange?: (s: PlayerState) => void;
  children?: ReactNode;
  hud?: ReactNode;
  className?: string;
  frameClassName?: string;
  label?: string;
  /** false when something drawn over the video (a broadcast layout) has its own LIVE badge */
  showLiveBadge?: boolean;
  /**
   * Rewind: keep everything received since the viewer joined (up to DVR_KEEP_SEC) and show a seek bar with
   * "Go live". The browser holds the video in memory; nothing is stored on the server.
   */
  dvr?: boolean;
}) {
  const t = useT(liveMsg);
  const ownRef = useRef<HTMLVideoElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<PlayerState>("connecting");
  const [attempts, setAttempts] = useState(0);
  const [muted, setMuted] = useState(true);
  /** the stream carries a sound track (null = not known yet); drives the "Tap for sound" button */
  const [hasAudio, setHasAudio] = useState<boolean | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const stateCb = useRef(onStateChange);
  stateCb.current = onStateChange;

  const setVideo = (el: HTMLVideoElement | null) => {
    ownRef.current = el;
    if (externalRef) externalRef.current = el;
  };

  useEffect(() => stateCb.current?.(state), [state]);

  // ---- attach the stream ----
  useEffect(() => {
    const video = ownRef.current;
    if (!video || !src || ended) return;
    let disposed = false;
    let hls: Hls | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let mediaRecoveries = 0;
    setState("connecting");
    setAttempts(0);

    const onPlaying = () => {
      attempt = 0;
      mediaRecoveries = 0;
      setAttempts(0);
      setState("playing");
    };
    const onWaiting = () => setState((s) => (s === "ended" ? s : "connecting"));
    const onEnded = () => setState("ended");
    video.addEventListener("playing", onPlaying);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("ended", onEnded);

    const tryPlay = () => {
      video.play().catch(() => {
        /* autoplay blocked until the user interacts — the picture still loads */
      });
    };

    const scheduleRetry = (start: () => void) => {
      if (disposed) return;
      clearTimeout(retryTimer);
      const ms = backoff(attempt++);
      setAttempts(attempt);
      setState("connecting");
      retryTimer = setTimeout(() => !disposed && start(), ms);
    };

    let startNative = () => {};
    const onNativeError = () => scheduleRetry(startNative);
    startNative = () => {
      video.src = `${src}${src.includes("?") ? "&" : "?"}r=${Date.now()}`;
      tryPlay();
    };

    const startHls = async () => {
      const { default: HlsCtor } = await import("hls.js");
      if (disposed) return;
      if (!HlsCtor.isSupported()) {
        if (canPlayNative(video)) {
          video.addEventListener("error", onNativeError);
          startNative();
        }
        return;
      }
      const make = () => {
        hls?.destroy();
        const h = new HlsCtor({
          lowLatencyMode: true,
          liveSyncDurationCount: 2,
          // rewind: never yank the viewer back to live or speed playback up while they watch an earlier moment
          liveMaxLatencyDurationCount: dvr ? Infinity : 6,
          maxLiveSyncPlaybackRate: dvr ? 1 : 1.15,
          backBufferLength: dvr ? DVR_KEEP_SEC : 30,
          maxBufferLength: 10,
          enableWorker: true,
          manifestLoadPolicy: {
            default: {
              maxTimeToFirstByteMs: 8_000,
              maxLoadTimeMs: 10_000,
              timeoutRetry: { maxNumRetry: 2, retryDelayMs: 0, maxRetryDelayMs: 0 },
              errorRetry: { maxNumRetry: 1, retryDelayMs: 1000, maxRetryDelayMs: 2000 },
            },
          },
          playlistLoadPolicy: {
            default: {
              maxTimeToFirstByteMs: 8_000,
              maxLoadTimeMs: 10_000,
              timeoutRetry: { maxNumRetry: 2, retryDelayMs: 0, maxRetryDelayMs: 0 },
              errorRetry: { maxNumRetry: 3, retryDelayMs: 1000, maxRetryDelayMs: 4000 },
            },
          },
        });
        hls = h;
        h.on(HlsCtor.Events.MANIFEST_PARSED, tryPlay);
        h.on(HlsCtor.Events.BUFFER_CODECS, (_e, data) => !disposed && setHasAudio(!!(data as { audio?: unknown; audiovideo?: unknown }).audio || !!(data as { audiovideo?: unknown }).audiovideo));
        h.on(HlsCtor.Events.ERROR, (_e, data) => {
          if (!data.fatal || disposed) return;
          if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) {
            if (mediaRecoveries++ === 1) h.swapAudioCodec();
            h.recoverMediaError();
            return;
          }
          // playlist 404 (not started yet / restarting), network blip or unrecoverable media error → rebuild
          h.destroy();
          if (hls === h) hls = null;
          scheduleRetry(make);
        });
        h.loadSource(src);
        h.attachMedia(video);
      };
      make();
    };

    // prefer hls.js (better live-edge control); Safari/iOS without MSE use the native player
    const hasMse = typeof window !== "undefined" && ("MediaSource" in window || "ManagedMediaSource" in window);
    if (!hasMse && canPlayNative(video)) {
      video.addEventListener("error", onNativeError);
      startNative();
    } else void startHls();

    // back at the live edge after the tab was hidden (not in rewind mode: the viewer may be watching the past on purpose)
    const onVisible = () => {
      if (document.visibilityState !== "visible" || dvr) return;
      const edge = hls?.liveSyncPosition;
      if (edge != null && video.currentTime < edge - 8) video.currentTime = edge;
      tryPlay();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisible);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("error", onNativeError);
      hls?.destroy();
      hls = null;
      video.removeAttribute("src");
      video.load();
    };
  }, [src, ended, dvr]);

  // ---- fullscreen ----
  useEffect(() => {
    const h = () => setFullscreen(document.fullscreenElement === frameRef.current && !!frameRef.current);
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);
  const toggleFullscreen = () => {
    const frame = frameRef.current;
    const video = ownRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (frame?.requestFullscreen) void frame.requestFullscreen().catch(() => video?.webkitEnterFullscreen?.());
    else video?.webkitEnterFullscreen?.();
  };

  const showEnded = ended || state === "ended";

  return (
    <div className={cn("space-y-2", className)}>
      <div
        ref={frameRef}
        className={cn(
          "relative aspect-video w-full overflow-hidden rounded-xl border bg-muted",
          fullscreen && "rounded-none border-0 bg-background",
          frameClassName,
        )}
      >
        <video
          ref={setVideo}
          muted={muted}
          autoPlay
          playsInline
          disablePictureInPicture
          aria-label={label ?? t("stream_label")}
          className={cn("absolute inset-0 size-full object-contain transition-opacity", showEnded && "opacity-30")}
        />

        {!showEnded && state === "connecting" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="flex flex-col items-center gap-2 rounded-xl bg-background/80 px-4 py-3 text-center shadow-sm backdrop-blur-sm">
              <Loader2 className="size-6 animate-spin text-primary" />
              <p className="text-sm font-medium">{attempts > 1 ? t("waiting_stream") : t("connecting")}</p>
              {attempts > 1 && <p className="max-w-56 text-xs text-muted-foreground">{t("starts_soon")}</p>}
            </div>
          </div>
        )}

        {showEnded && endedSlot && <div className="absolute inset-0 grid place-items-center p-4">{endedSlot}</div>}

        {!showEnded && children}

        {dvr && !showEnded && state !== "connecting" && <DvrBar video={ownRef} />}

        {!showEnded && muted && hasAudio !== false && state !== "connecting" && (
          <button
            type="button"
            onClick={() => setMuted(false)}
            className={cn("absolute left-3 z-10 flex items-center gap-2 rounded-full bg-background/85 px-3.5 py-2 text-sm font-semibold text-foreground shadow-lg backdrop-blur-sm transition-colors outline-none hover:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/50", dvr ? "bottom-16" : "bottom-3")}
          >
            <VolumeX className="size-4 text-primary" /> {t("tap_for_sound")}
          </button>
        )}

        {!showEnded && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2 sm:p-3">
            {showLiveBadge ? <LiveBadge startedAt={startedAt} /> : <span />}
            <div className="pointer-events-auto flex items-center gap-1.5">
              {hud}
              <button
                type="button"
                onClick={() => setMuted((m) => !m)}
                className="flex size-8 items-center justify-center rounded-md bg-background/75 text-foreground shadow-sm backdrop-blur-sm transition-colors outline-none hover:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/50"
                aria-label={muted ? t("unmute") : t("mute")}
                title={muted ? t("unmute") : t("mute")}
              >
                {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
              </button>
              <button
                type="button"
                onClick={toggleFullscreen}
                className="flex size-8 items-center justify-center rounded-md bg-background/75 text-foreground shadow-sm backdrop-blur-sm transition-colors outline-none hover:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/50"
                aria-label={fullscreen ? t("exit_fullscreen") : t("fullscreen")}
                title={fullscreen ? t("exit_fullscreen") : t("fullscreen")}
              >
                {fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const fmtClock = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

/** Seek bar over what the browser has received: pause, back 10 s, scrub, "Go live". */
function DvrBar({ video: ref }: { video: RefObject<HTMLVideoElement | null> }) {
  const [, tick] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const t = useT(liveMsg);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const rerender = () => tick((n) => n + 1);
    const t = setInterval(rerender, 500);
    v.addEventListener("pause", rerender);
    v.addEventListener("play", rerender);
    v.addEventListener("seeked", rerender);
    return () => {
      clearInterval(t);
      v.removeEventListener("pause", rerender);
      v.removeEventListener("play", rerender);
      v.removeEventListener("seeked", rerender);
    };
  }, [ref]);

  const v = ref.current;
  if (!v || !v.seekable.length) return null;
  const start = v.seekable.start(0);
  const edge = v.seekable.end(v.seekable.length - 1);
  const span = Math.max(1, edge - start);
  const pos = drag ?? v.currentTime;
  const behind = Math.max(0, edge - pos);
  const atLive = behind < 6 && !v.paused;

  const seek = (t: number) => {
    v.currentTime = Math.min(edge - 0.5, Math.max(start, t));
    void v.play().catch(() => undefined);
  };
  const btn =
    "flex size-8 shrink-0 items-center justify-center rounded-md bg-background/75 text-foreground shadow-sm backdrop-blur-sm transition-colors outline-none hover:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/50";

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-2 bg-gradient-to-t from-black/70 to-transparent p-2 pt-6 sm:p-3 sm:pt-8">
      <button type="button" className={btn} onClick={() => (v.paused ? void v.play().catch(() => undefined) : v.pause())} aria-label={v.paused ? t("play") : t("pause")}>
        {v.paused ? <Play className="size-4" /> : <Pause className="size-4" />}
      </button>
      <button type="button" className={btn} onClick={() => seek(v.currentTime - 10)} aria-label={t("back10")} title={t("back10")}>
        <RotateCcw className="size-4" />
      </button>
      <input
        type="range"
        min={0}
        max={span}
        step={0.1}
        value={Math.min(span, Math.max(0, pos - start))}
        onChange={(e) => setDrag(start + Number(e.target.value))}
        onPointerUp={() => {
          if (drag != null) seek(drag);
          setDrag(null);
        }}
        onKeyUp={() => {
          if (drag != null) seek(drag);
          setDrag(null);
        }}
        aria-label={t("seek")}
        className="h-1.5 min-w-0 flex-1 cursor-pointer accent-primary"
      />
      <span className="w-14 shrink-0 text-right font-mono text-xs text-white tabular-nums">{behind < 2 ? t("live_caps") : `−${fmtClock(behind)}`}</span>
      <button
        type="button"
        onClick={() => seek(edge - 1.5)}
        className={cn(
          "flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 font-display text-xs font-bold tracking-wider uppercase shadow-sm transition-colors",
          atLive ? "bg-destructive text-destructive-foreground" : "bg-background/85 text-foreground hover:bg-background",
        )}
        aria-label={t("go_live")}
      >
        <span className={cn("size-2 rounded-full", atLive ? "bg-destructive-foreground" : "bg-destructive")} />
        {atLive ? t("live_label") : t("go_live")}
      </button>
    </div>
  );
}
