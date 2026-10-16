import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { FileImage, Maximize2, Minus, Plus, Scan } from "lucide-react";
import { Button } from "@7xen/ui/components/ui/button";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@7xen/ui/components/ui/tooltip";
import { cn } from "@7xen/ui/lib/utils";

const MIN = 1;
const MAX = 8;
type View = { s: number; x: number; y: number };
const FIT: View = { s: 1, x: 0, y: 0 };

/**
 * Screenshot viewer: scroll / pinch-free wheel to zoom at the cursor, drag to pan, double-click to zoom in,
 * +/−/0 keys when focused. At scale 1 the image fits the box.
 */
export function ImageViewer({ src, alt, className, onExpand, aspect = "20 / 9" }: { src: string; alt: string; className?: string; onExpand?: () => void; aspect?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(FIT);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const drag = useRef<{ id: number; x: number; y: number; vx: number; vy: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    setView(FIT);
    setState("loading");
  }, [src]);

  /** keep the image covering the box (no empty gaps when zoomed) */
  const clamp = useCallback((v: View): View => {
    const el = box.current;
    if (!el) return v;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const s = Math.min(MAX, Math.max(MIN, v.s));
    return { s, x: Math.min(0, Math.max(w - w * s, v.x)), y: Math.min(0, Math.max(h - h * s, v.y)) };
  }, []);

  const zoomAt = useCallback(
    (factor: number, px?: number, py?: number) => {
      const el = box.current;
      if (!el) return;
      const cx = px ?? el.clientWidth / 2;
      const cy = py ?? el.clientHeight / 2;
      setView((v) => {
        const s = Math.min(MAX, Math.max(MIN, v.s * factor));
        const k = s / v.s;
        return clamp({ s, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k });
      });
    },
    [clamp],
  );

  // wheel needs a non-passive listener to stop the page from scrolling while zooming
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (view.s <= 1 || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setView((v) => clamp({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = 40;
    if (e.key === "+" || e.key === "=") zoomAt(1.25);
    else if (e.key === "-" || e.key === "_") zoomAt(0.8);
    else if (e.key === "0") setView(FIT);
    else if (e.key === "ArrowLeft") setView((v) => clamp({ ...v, x: v.x + step }));
    else if (e.key === "ArrowRight") setView((v) => clamp({ ...v, x: v.x - step }));
    else if (e.key === "ArrowUp") setView((v) => clamp({ ...v, y: v.y + step }));
    else if (e.key === "ArrowDown") setView((v) => clamp({ ...v, y: v.y - step }));
    else return;
    e.preventDefault();
  };

  return (
    <div className={cn("overflow-hidden rounded-xl border bg-card shadow-sm", className)}>
      <div
        ref={box}
        role="img"
        aria-label={`${alt}. Scroll to zoom, drag to move. Keys: plus, minus, 0 to fit, arrows to move.`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          if (view.s >= 3) setView(FIT);
          else zoomAt(2, e.clientX - r.left, e.clientY - r.top);
        }}
        style={{ aspectRatio: aspect }}
        className={cn(
          "relative touch-none overflow-hidden bg-muted outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset",
          view.s > 1 ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in",
        )}
      >
        {state === "loading" && <Skeleton className="absolute inset-0 rounded-none" />}
        {state === "error" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <FileImage className="size-8" />
            Couldn't load the screenshot
          </div>
        ) : (
          <img
            src={src}
            alt=""
            draggable={false}
            onLoad={() => setState("ok")}
            onError={() => setState("error")}
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, transformOrigin: "0 0" }}
            className={cn("absolute inset-0 size-full object-contain will-change-transform", !dragging && "transition-transform duration-75", state !== "ok" && "opacity-0")}
          />
        )}
      </div>
      <div className="flex items-center gap-1 border-t px-2 py-1.5">
        <ToolBtn label="Zoom out (−)" onClick={() => zoomAt(0.8)} disabled={view.s <= MIN}>
          <Minus />
        </ToolBtn>
        <span className="w-12 text-center text-xs font-semibold text-muted-foreground tabular-nums" aria-live="polite">
          {Math.round(view.s * 100)}%
        </span>
        <ToolBtn label="Zoom in (+)" onClick={() => zoomAt(1.25)} disabled={view.s >= MAX}>
          <Plus />
        </ToolBtn>
        <ToolBtn label="Fit (0)" onClick={() => setView(FIT)} disabled={view.s === 1}>
          <Scan />
        </ToolBtn>
        <span className="ml-auto hidden text-xs text-muted-foreground sm:block">Scroll to zoom · drag to move</span>
        {onExpand && (
          <ToolBtn label="Bigger view" onClick={onExpand}>
            <Maximize2 />
          </ToolBtn>
        )}
      </div>
    </div>
  );
}

function ToolBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onClick} disabled={disabled} aria-label={label}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
