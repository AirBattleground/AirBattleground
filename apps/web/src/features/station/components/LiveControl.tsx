import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import JMuxer from "jmuxer";
import { ArrowLeft, Circle, CornerDownLeft, Delete, Layers, Loader2, Lock, LockOpen, MonitorOff, SendHorizontal, WifiOff } from "lucide-react";
import { Button } from "@7xen/ui/components/ui/button";
import { Input } from "@7xen/ui/components/ui/input";
import { Label } from "@7xen/ui/components/ui/label";
import { Switch } from "@7xen/ui/components/ui/switch";
import { cn } from "@7xen/ui/lib/utils";
import { toFraction, videoContentBox } from "../geometry";
import { useStationInput } from "../api";
import { FingerMap, encodeKey, encodeKeyframeRequest, encodeText, encodeTouch, parseFrame, reconnectDelay, streamUrl, type KeyName } from "../liveProtocol";

/** Without a frame for this long the emulator is probably off. */
const NO_FRAME_MS = 4000;
/** Minimum gap between move messages of one finger (~60/s). */
const MOVE_GAP_MS = 16;

type Conn = "connecting" | "open" | "closed";

/**
 * Live, low-latency view of the BlueStacks device (H.264 over WebSocket, decoded with MSE) plus always-on
 * multi-touch control. Owns the socket and the <video>; keep it mounted across Start/End match so the picture
 * doesn't restart. `enabled=false` closes the socket.
 */
export function LiveControl({ matchId, enabled, className }: { matchId: string; enabled: boolean; className?: string }) {
  const sendRest = useStationInput(matchId);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fingers = useRef(new FingerMap());
  const lastPos = useRef(new Map<number, { x: number; y: number }>());
  const lastMove = useRef(new Map<number, number>());
  const lastFrameAt = useRef(0);
  const frameCount = useRef(0);

  const [conn, setConn] = useState<Conn>("connecting");
  const [hasPicture, setHasPicture] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [fps, setFps] = useState(0);
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(false);
  const [text, setText] = useState("");

  const sendBin = useCallback((bytes: Uint8Array) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(bytes);
    return true;
  }, []);

  /** lift every finger that is down (blur, cancel, lock, unmount) */
  const releaseAll = useCallback(() => {
    for (const [, id] of fingers.current.entries()) {
      const p = lastPos.current.get(id) ?? { x: 0.5, y: 0.5 };
      sendBin(encodeTouch("up", id, p.x, p.y));
    }
    fingers.current.clear();
    lastPos.current.clear();
    lastMove.current.clear();
  }, [sendBin]);

  // ---- socket + decoder
  useEffect(() => {
    if (!enabled) return;
    let closed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let muxer: JMuxer | null = null;
    let needKey = true;

    const destroyMuxer = () => {
      try {
        muxer?.destroy();
      } catch {
        /* already gone */
      }
      muxer = null;
      needKey = true;
    };

    const connect = () => {
      if (closed) return;
      setConn("connecting");
      const ws = new WebSocket(streamUrl(matchId, window.location));
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setConn("open");
        lastFrameAt.current = performance.now();
        ws.send(encodeKeyframeRequest());
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          let msg: { type?: string } | null = null;
          try {
            msg = JSON.parse(ev.data);
          } catch {
            return;
          }
          if (msg?.type === "config") {
            // new stream settings: rebuild the decoder and wait for the next keyframe
            destroyMuxer();
            setHasPicture(false);
            if (ws.readyState === WebSocket.OPEN) ws.send(encodeKeyframeRequest());
          }
          return;
        }
        const frame = parseFrame(ev.data as ArrayBuffer);
        const video = videoRef.current;
        if (!frame || !video) return;
        if (needKey) {
          if (!frame.key) return;
          needKey = false;
          muxer = new JMuxer({ node: video, mode: "video", flushingTime: 0, fps: 30, maxDelay: 400, clearBuffer: true });
        }
        muxer?.feed({ video: frame.data });
        lastFrameAt.current = performance.now();
        frameCount.current++;
        if (video.paused) void video.play().catch(() => undefined);
      };
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (closed) return;
        fingers.current.clear();
        setConn("closed");
        setHasPicture(false);
        destroyMuxer();
        timer = setTimeout(connect, reconnectDelay(attempt++));
      };
      ws.onerror = () => ws.close();
    };
    connect();

    // health: frames per second + "no picture" detection
    const health = setInterval(() => {
      const n = frameCount.current;
      frameCount.current = 0;
      setFps(n);
      const fresh = performance.now() - lastFrameAt.current < NO_FRAME_MS;
      setHasPicture((was) => (n > 0 ? true : fresh ? was : false));
      setStalled(!fresh);
    }, 1000);

    return () => {
      closed = true;
      clearTimeout(timer);
      clearInterval(health);
      releaseAll();
      const ws = wsRef.current;
      wsRef.current = null;
      ws?.close();
      destroyMuxer();
      setHasPicture(false);
    };
  }, [enabled, matchId, releaseAll]);

  // lift fingers when the window loses focus or controls get locked
  useEffect(() => {
    window.addEventListener("blur", releaseAll);
    return () => window.removeEventListener("blur", releaseAll);
  }, [releaseAll]);
  useEffect(() => {
    lockedRef.current = locked;
    if (locked) releaseAll();
  }, [locked, releaseAll]);

  // ---- pointer → touch
  const frac = (e: ReactPointerEvent, clamp: boolean) => {
    const video = videoRef.current;
    const layer = layerRef.current;
    const box = video && videoContentBox(video);
    if (!box || !layer) return null;
    const r = layer.getBoundingClientRect();
    return toFraction(e.clientX - r.left, e.clientY - r.top, box, clamp);
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (lockedRef.current || (e.pointerType === "mouse" && e.button !== 0)) return;
    const p = frac(e, false);
    if (!p) return; // on a letterbox bar
    const id = fingers.current.acquire(e.pointerId);
    if (id === null) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    lastPos.current.set(id, p);
    sendBin(encodeTouch("down", id, p.x, p.y));
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const id = fingers.current.get(e.pointerId);
    if (id === undefined || lockedRef.current) return;
    const now = performance.now();
    if (now - (lastMove.current.get(id) ?? 0) < MOVE_GAP_MS) return;
    const p = frac(e, true);
    if (!p) return;
    lastMove.current.set(id, now);
    lastPos.current.set(id, p);
    sendBin(encodeTouch("move", id, p.x, p.y));
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const id = fingers.current.release(e.pointerId);
    if (id === undefined) return;
    const p = frac(e, true) ?? lastPos.current.get(id) ?? { x: 0.5, y: 0.5 };
    lastPos.current.delete(id);
    lastMove.current.delete(id);
    sendBin(encodeTouch("up", id, p.x, p.y));
  };

  // ---- toolbar
  const sendKey = (key: KeyName) => {
    sendBin(encodeKey("down", key));
    sendBin(encodeKey("up", key));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text) return;
    for (const m of encodeText(text)) sendBin(m);
    setText("");
  };

  const overlay =
    conn === "connecting" ? (
      <Notice icon={<Loader2 className="size-5 animate-spin" />}>Connecting to the station…</Notice>
    ) : conn === "closed" ? (
      <Notice icon={<WifiOff className="size-5" />}>Connection lost — reconnecting…</Notice>
    ) : !hasPicture ? (
      stalled ? (
        <Notice icon={<MonitorOff className="size-5" />}>Emulator is off or not showing a picture yet</Notice>
      ) : (
        <Notice icon={<Loader2 className="size-5 animate-spin" />}>Waiting for the picture…</Notice>
      )
    ) : null;

  const keyBtn = "h-9 gap-1.5 px-2.5 sm:px-3";
  const ctl = locked || conn !== "open";
  return (
    <div className={cn("space-y-3", className)} data-tour="station-remote">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Switch id={`lock-${matchId}`} checked={locked} onCheckedChange={setLocked} />
          <Label htmlFor={`lock-${matchId}`} className="flex cursor-pointer items-center gap-1.5 font-semibold">
            {locked ? <Lock className="size-4 text-warning-foreground dark:text-warning" /> : <LockOpen className="size-4 text-primary" />} Lock controls
          </Label>
        </div>
        <span className="text-xs text-muted-foreground">
          {locked ? "Locked — clicks won't reach the game" : "Click and drag on the picture to play · two fingers work on touch screens"}
          {hasPicture && fps > 0 && <span className="ml-2 tabular-nums opacity-70">{fps} fps</span>}
        </span>
      </div>

      <div className={cn("relative -mx-4 overflow-hidden border-y bg-muted sm:mx-0 sm:rounded-xl sm:border", !locked && hasPicture && "ring-2 ring-primary sm:ring-offset-2 sm:ring-offset-card")}>
        <div className="relative mx-auto aspect-video max-h-[70vh] w-full">
          <video ref={videoRef} className="absolute inset-0 size-full object-contain" muted playsInline autoPlay aria-label="Station live view" />
          <div
            ref={layerRef}
            className={cn("absolute inset-0 touch-none select-none", locked ? "cursor-not-allowed" : "cursor-crosshair")}
            style={{ touchAction: "none" }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onLostPointerCapture={onUp}
            onContextMenu={(e) => e.preventDefault()}
          />
          {overlay}
          {locked && hasPicture && (
            <span className="pointer-events-none absolute top-2 left-2 inline-flex items-center gap-1 rounded-md bg-background/85 px-2 py-1 text-xs font-semibold shadow-sm">
              <Lock className="size-3" /> Locked
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/40 p-2" data-tour="station-remote-toolbar">
        <div className="flex gap-1">
          <Button type="button" variant="outline" size="sm" className={keyBtn} disabled={locked} onClick={() => sendRest({ type: "key", key: "BACK" })} title="Back" aria-label="Back">
            <ArrowLeft /> <span className="hidden sm:inline">Back</span>
          </Button>
          <Button type="button" variant="outline" size="sm" className={keyBtn} disabled={locked} onClick={() => sendRest({ type: "key", key: "HOME" })} title="Home" aria-label="Home">
            <Circle /> <span className="hidden sm:inline">Home</span>
          </Button>
          <Button type="button" variant="outline" size="sm" className={keyBtn} disabled={locked} onClick={() => sendRest({ type: "key", key: "APP_SWITCH" })} title="Recent apps" aria-label="Recent apps">
            <Layers /> <span className="hidden sm:inline">Recents</span>
          </Button>
        </div>
        <form onSubmit={submit} className="flex min-w-0 flex-1 basis-56 items-center gap-1">
          <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={200} disabled={ctl} placeholder="Type into game" aria-label="Type into game" className="h-9 min-w-0 flex-1 bg-background" enterKeyHint="send" />
          <Button type="submit" size="icon" className="size-9 shrink-0" disabled={ctl || !text} aria-label="Send text" title="Send text">
            <SendHorizontal />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="size-9 shrink-0" disabled={ctl} onClick={() => sendKey("Backspace")} aria-label="Backspace" title="Backspace">
            <Delete />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="size-9 shrink-0" disabled={ctl} onClick={() => sendKey("Enter")} aria-label="Enter key" title="Enter">
            <CornerDownLeft />
          </Button>
        </form>
      </div>
    </div>
  );
}

function Notice({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/70 p-4">
      <p className="flex items-center gap-2 rounded-lg bg-card px-3 py-2 text-sm font-medium shadow-sm">
        {icon} {children}
      </p>
    </div>
  );
}
