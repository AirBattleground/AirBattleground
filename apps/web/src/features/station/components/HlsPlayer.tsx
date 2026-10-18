import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type Hls from "hls.js";
import { Loader2, Maximize, Minimize, Volume2, VolumeX } from "lucide-react";
import { cn } from "@7xen/ui/lib/utils";
import { fmtDuration } from "@/features/live/format";

export type PlayerState = "connecting" | "playing" | "ended";

/** Pulsing red "LIVE" badge, optionally with the elapsed time since `startedAt`. */
export function LiveBadge({ startedAt, className }: { startedAt?: string | null; className?: string }) {
  const elapsed = useElapsed(startedAt);
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md bg-destructive px-2 py-0.5 font-display text-xs font-bold tracking-wider text-destructive-foreground uppercase shadow-sm", className)}>
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive-foreground opacity-70" />
        <span className="relative inline-flex size-2 rounded-full bg-destructive-foreground" />
      </span>
      Live
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
  label = "Live match stream",
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
}) {
  const ownRef = useRef<HTMLVideoElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<PlayerState>("connecting");
  const [attempts, setAttempts] = useState(0);
  const [muted, setMuted] = useState(true);
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
          liveMaxLatencyDurationCount: 6,
          maxLiveSyncPlaybackRate: 1.15,
          backBufferLength: 30,
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

    // back at the live edge after the tab was hidden
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
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
  }, [src, ended]);

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
          aria-label={label}
          className={cn("absolute inset-0 size-full object-contain transition-opacity", showEnded && "opacity-30")}
        />

        {!showEnded && state === "connecting" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="flex flex-col items-center gap-2 rounded-xl bg-background/80 px-4 py-3 text-center shadow-sm backdrop-blur-sm">
              <Loader2 className="size-6 animate-spin text-primary" />
              <p className="text-sm font-medium">{attempts > 1 ? "Waiting for the stream…" : "Connecting to the live stream…"}</p>
              {attempts > 1 && <p className="max-w-56 text-xs text-muted-foreground">It starts a few seconds after the station goes live.</p>}
            </div>
          </div>
        )}

        {showEnded && endedSlot && <div className="absolute inset-0 grid place-items-center p-4">{endedSlot}</div>}

        {!showEnded && children}

        {!showEnded && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2 sm:p-3">
            <LiveBadge startedAt={startedAt} />
            <div className="pointer-events-auto flex items-center gap-1.5">
              {hud}
              <button
                type="button"
                onClick={() => setMuted((m) => !m)}
                className="flex size-8 items-center justify-center rounded-md bg-background/75 text-foreground shadow-sm backdrop-blur-sm transition-colors outline-none hover:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/50"
                aria-label={muted ? "Unmute" : "Mute"}
                title={muted ? "Unmute" : "Mute"}
              >
                {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
              </button>
              <button
                type="button"
                onClick={toggleFullscreen}
                className="flex size-8 items-center justify-center rounded-md bg-background/75 text-foreground shadow-sm backdrop-blur-sm transition-colors outline-none hover:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/50"
                aria-label={fullscreen ? "Exit full screen" : "Full screen"}
                title={fullscreen ? "Exit full screen" : "Full screen"}
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
