import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { ArrowLeft, Circle, CornerDownLeft, Delete, Layers, LogOut, SendHorizontal } from "lucide-react";
import type { StationInput } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { Input } from "@7xen/ui/components/ui/input";
import { cn } from "@7xen/ui/lib/utils";
import { toFraction, videoContentBox } from "../geometry";

type Send = (input: StationInput) => boolean;

/** Pointer moves less than this (CSS px) → a tap, otherwise a swipe. */
const TAP_SLOP = 10;
/** Held this long without moving → long press (sent as a swipe that stays in place). */
const LONG_PRESS_MS = 550;

interface Mark {
  id: number;
  x: number;
  y: number;
  kind: "tap" | "swipe-end";
}
interface Drag {
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  t0: number;
}

/**
 * Transparent layer over the live video that turns pointer input into station input.
 * Click/tap = tap, drag = swipe (start → end, real duration), press-and-hold = long press.
 * Coordinates are fractions of the picture itself — the letterbox bars of `object-fit: contain` are excluded.
 */
export function RemoteControlLayer({ videoRef, send }: { videoRef: RefObject<HTMLVideoElement | null>; send: Send }) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const [trail, setTrail] = useState<Drag | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const seq = useRef(0);

  const mark = (x: number, y: number, kind: Mark["kind"]) => {
    const id = ++seq.current;
    setMarks((m) => [...m.slice(-6), { id, x, y, kind }]);
    setTimeout(() => setMarks((m) => m.filter((k) => k.id !== id)), 650);
  };

  /** pointer → coordinates relative to the video element (the layer covers it exactly) */
  const local = (e: ReactPointerEvent) => {
    const r = layerRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current || (e.pointerType === "mouse" && e.button !== 0)) return;
    const video = videoRef.current;
    const box = video && videoContentBox(video);
    if (!box) return;
    const p = local(e);
    if (!toFraction(p.x, p.y, box)) return; // on a letterbox bar
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { pointerId: e.pointerId, startX: p.x, startY: p.y, x: p.x, y: p.y, t0: performance.now() };
    setTrail(null);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const p = local(e);
    d.x = p.x;
    d.y = p.y;
    if (Math.hypot(d.x - d.startX, d.y - d.startY) > TAP_SLOP) setTrail({ ...d });
  };

  const finish = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    setTrail(null);
    if (cancelled) return;
    const video = videoRef.current;
    const box = video && videoContentBox(video);
    if (!box) return;
    const p = local(e);
    const held = performance.now() - d.t0;
    const moved = Math.hypot(p.x - d.startX, p.y - d.startY) > TAP_SLOP;
    const a = toFraction(d.startX, d.startY, box, true)!;
    if (!moved) {
      if (held >= LONG_PRESS_MS) {
        if (send({ type: "swipe", x: a.x, y: a.y, x2: a.x, y2: a.y, durationMs: Math.min(3000, Math.round(held)) })) mark(d.startX, d.startY, "tap");
      } else if (send({ type: "tap", x: a.x, y: a.y })) mark(d.startX, d.startY, "tap");
      return;
    }
    const b = toFraction(p.x, p.y, box, true)!;
    const durationMs = Math.min(3000, Math.max(50, Math.round(held)));
    if (send({ type: "swipe", x: a.x, y: a.y, x2: b.x, y2: b.y, durationMs })) {
      mark(d.startX, d.startY, "tap");
      mark(p.x, p.y, "swipe-end");
    }
  };

  return (
    <div
      ref={layerRef}
      data-testid="remote-layer"
      className="absolute inset-0 z-10 cursor-crosshair touch-none select-none"
      style={{ WebkitTouchCallout: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, false)}
      onPointerCancel={(e) => finish(e, true)}
      onContextMenu={(e) => e.preventDefault()}
      aria-label="Remote control: tap or drag on the video"
      role="application"
    >
      {trail && (
        <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden>
          <line x1={trail.startX} y1={trail.startY} x2={trail.x} y2={trail.y} className="stroke-primary" strokeWidth={4} strokeLinecap="round" strokeDasharray="2 8" />
          <circle cx={trail.startX} cy={trail.startY} r={7} className="fill-primary/40 stroke-primary" strokeWidth={2} />
          <circle cx={trail.x} cy={trail.y} r={10} className="fill-primary/30 stroke-primary" strokeWidth={2} />
        </svg>
      )}
      {marks.map((m) => (
        <span
          key={m.id}
          className="pointer-events-none absolute"
          style={{ left: m.x, top: m.y }}
          aria-hidden
        >
          <span className={cn("absolute -top-6 -left-6 size-12 animate-ping rounded-full border-2", m.kind === "tap" ? "border-primary bg-primary/25" : "border-primary/70 bg-primary/10")} />
          <span className="absolute -top-1.5 -left-1.5 size-3 rounded-full bg-primary shadow-glow" />
        </span>
      ))}
    </div>
  );
}

/** Back / Home / Recents + "Type into game". Esc anywhere exits control mode. */
export function RemoteToolbar({ send, onExit }: { send: Send; onExit: () => void }) {
  const [text, setText] = useState("");

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector("[role=dialog],[role=alertdialog]")) onExit();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onExit]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.slice(0, 64);
    if (!t.trim()) return;
    if (send({ type: "text", text: t })) setText("");
  };

  const keyBtn = "h-9 gap-1.5 px-2.5 sm:px-3";
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 p-2" data-tour="station-remote-toolbar">
      <div className="flex gap-1">
        <Button type="button" variant="outline" size="sm" className={keyBtn} onClick={() => send({ type: "key", key: "BACK" })} title="Back" aria-label="Back">
          <ArrowLeft /> <span className="hidden sm:inline">Back</span>
        </Button>
        <Button type="button" variant="outline" size="sm" className={keyBtn} onClick={() => send({ type: "key", key: "HOME" })} title="Home" aria-label="Home">
          <Circle /> <span className="hidden sm:inline">Home</span>
        </Button>
        <Button type="button" variant="outline" size="sm" className={keyBtn} onClick={() => send({ type: "key", key: "APP_SWITCH" })} title="Recent apps" aria-label="Recent apps">
          <Layers /> <span className="hidden sm:inline">Recents</span>
        </Button>
      </div>
      <form onSubmit={submit} className="flex min-w-0 flex-1 basis-56 items-center gap-1">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={64}
          placeholder="Type into game"
          aria-label="Type into game"
          className="h-9 min-w-0 flex-1 bg-background"
          enterKeyHint="send"
        />
        <Button type="submit" size="icon" className="size-9 shrink-0" disabled={!text.trim()} aria-label="Send text" title="Send text">
          <SendHorizontal />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="size-9 shrink-0" onClick={() => send({ type: "key", key: "DEL" })} aria-label="Backspace" title="Backspace">
          <Delete />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="size-9 shrink-0" onClick={() => send({ type: "key", key: "ENTER" })} aria-label="Enter key" title="Enter">
          <CornerDownLeft />
        </Button>
      </form>
      <Button type="button" variant="ghost" size="sm" className="h-9 text-muted-foreground" onClick={onExit} title="Exit remote control (Esc)">
        <LogOut /> Exit <kbd className="ml-0.5 hidden rounded border bg-muted px-1 text-[10px] font-semibold sm:inline">Esc</kbd>
      </Button>
    </div>
  );
}
