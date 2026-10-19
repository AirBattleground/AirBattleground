import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { formatDistanceToNowStrict } from "date-fns";
import { Battery, BatteryCharging, Cpu, KeyRound, MemoryStick, MonitorPlay, MoreVertical, Pencil, RefreshCw, Smartphone, Thermometer, Trash2, Video, Wifi, WifiOff } from "lucide-react";
import type { DeviceRow, DeviceStatus, ThermalState } from "@7xen/shared";
import { Pill, type Tone } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@7xen/ui/components/ui/dropdown-menu";
import { cn } from "@7xen/ui/lib/utils";
import { useNow } from "@/features/manager/components/useNow";
import { PairQr } from "./PairQr";

const STATUS: Record<DeviceStatus, { label: string; tone: Tone; icon: ReactNode }> = {
  OFFLINE: { label: "Offline", tone: "neutral", icon: <WifiOff className="size-3.5" /> },
  ONLINE: { label: "Online", tone: "success", icon: <Wifi className="size-3.5" /> },
  STREAMING: { label: "Streaming", tone: "danger", icon: <span className="size-2 animate-pulse rounded-full bg-destructive" /> },
};

const THERMAL: Record<ThermalState, { label: string; className: string }> = {
  nominal: { label: "Cool", className: "text-success" },
  fair: { label: "Warm", className: "text-success" },
  serious: { label: "Hot", className: "text-warning-foreground dark:text-warning" },
  critical: { label: "Too hot", className: "text-destructive" },
};

/** iOS kills a broadcast extension at about 50 MB. */
const EXTENSION_MEM_LIMIT_MB = 50;

export function DeviceStatusPill({ status }: { status: DeviceStatus }) {
  const s = STATUS[status];
  return (
    <Pill tone={s.tone} icon={s.icon}>
      {s.label}
    </Pill>
  );
}

function elapsed(fromIso: string, now: number) {
  const s = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** Bar filled to `pct`; colour from `danger` (0–100, higher = worse; defaults to pct). */
function Meter({ icon, label, value, pct, danger = pct }: { icon: ReactNode; label: string; value: string; pct: number; danger?: number }) {
  const p = Math.max(0, Math.min(100, pct));
  const tone = danger >= 85 ? "bg-destructive" : danger >= 60 ? "bg-warning" : "bg-success";
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1 [&_svg]:size-3.5">
          {icon} {label}
        </span>
        <span className="font-display text-sm font-bold text-foreground tabular-nums">{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-[width] duration-700", tone)} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

/** Battery / temperature always; CPU, memory and video numbers while streaming. */
export function DeviceHealthPanel({ device: d, className }: { device: DeviceRow; className?: string }) {
  const h = d.health;
  const live = d.status === "STREAMING";
  if (!h || d.status === "OFFLINE") return null;
  return (
    <div className={cn("grid gap-3 rounded-xl border bg-background/60 p-3 sm:grid-cols-2", className)}>
      {h.battery != null && (
        <Meter
          icon={h.charging ? <BatteryCharging /> : <Battery />}
          label={h.charging ? "Battery (charging)" : "Battery"}
          value={`${Math.round(h.battery * 100)}%`}
          pct={h.battery * 100}
          danger={h.charging ? 0 : 100 - h.battery * 100}
        />
      )}
      {h.thermal && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Thermometer className="size-3.5" /> Temperature
          </span>
          <span className={cn("font-display text-sm font-bold", THERMAL[h.thermal].className)}>{THERMAL[h.thermal].label}</span>
        </div>
      )}
      {live && h.cpuPct != null && <Meter icon={<Cpu />} label="App CPU" value={`${Math.round(h.cpuPct)}%`} pct={h.cpuPct} />}
      {live && h.memMB != null && (
        <Meter icon={<MemoryStick />} label="App memory" value={`${Math.round(h.memMB)} / ${EXTENSION_MEM_LIMIT_MB} MB`} pct={(h.memMB / EXTENSION_MEM_LIMIT_MB) * 100} />
      )}
      {live && (h.bitrateKbps != null || h.fps != null) && (
        <p className="text-xs text-muted-foreground sm:col-span-2">
          {[h.width && h.height && `${h.width}×${h.height}`, h.fps != null && `${Math.round(h.fps)} fps`, h.bitrateKbps != null && `${(h.bitrateKbps / 1000).toFixed(1)} Mbps`, h.network === "cellular" ? "mobile data" : h.network === "wifi" ? "Wi-Fi" : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
    </div>
  );
}

export function DeviceStreamBadges({ device: d }: { device: DeviceRow }) {
  const now = useNow(1000);
  const live = d.status === "STREAMING";
  return (
    <>
      <DeviceStatusPill status={d.status} />
      {live && d.streamingSince && <span className="font-display text-lg font-bold tabular-nums">{elapsed(d.streamingSince, now)}</span>}
      {d.broadcastLive && <Pill tone="danger">Live to teams</Pill>}
      {live && d.health?.quality && (
        <Pill tone="brand">
          {d.health.quality}
          {d.health.autoDowngraded && " · lowered (phone hot)"}
        </Pill>
      )}
    </>
  );
}

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

/** Whole card opens the device's live page; inner controls stop the click. */
export function DeviceCard({ device: d, onShowKey, onRename, onRegenerate, onRemove }: {
  device: DeviceRow;
  onShowKey: () => void;
  onRename: () => void;
  onRegenerate: () => void;
  onRemove: () => void;
}) {
  const navigate = useNavigate();
  const live = d.status === "STREAMING";
  const online = d.status !== "OFFLINE";
  const neverConnected = !d.lastSeenAt;
  const href = `/manager/devices/${d.id}`;

  return (
    <article
      data-tour="device-card"
      onClick={() => navigate(href)}
      className={cn(
        "group relative flex cursor-pointer flex-col gap-4 overflow-hidden rounded-2xl border bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-glow",
        live && "border-destructive/40 shadow-glow",
      )}
    >
      <header className="flex items-start gap-3">
        <div className={cn("flex size-12 shrink-0 items-center justify-center rounded-xl", online ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
          {live ? <Video className="size-6" /> : <Smartphone className="size-6" />}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-xl leading-tight font-bold">
            <Link to={href} onClick={stop} className="outline-none hover:underline focus-visible:underline">
              {d.name}
            </Link>
          </h3>
          <p className="truncate text-sm text-muted-foreground">{[d.model ?? "iPhone", d.osVersion && `iOS ${d.osVersion}`, d.appVersion && `app ${d.appVersion}`].filter(Boolean).join(" · ")}</p>
        </div>
        <div onClick={stop}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`More for ${d.name}`} className="-mt-1 -mr-2">
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onShowKey}>
                <KeyRound /> Show key & QR
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onRename}>
                <Pencil /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onRegenerate}>
                <RefreshCw /> New key
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                <Trash2 /> Remove device
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <DeviceStreamBadges device={d} />
        <span className="ml-auto text-xs text-muted-foreground">
          {neverConnected ? "Never connected" : online ? "Connected" : `Last seen ${formatDistanceToNowStrict(new Date(d.lastSeenAt!))} ago`}
        </span>
      </div>

      {!online ? (
        <div data-tour="device-qr" className="flex items-center gap-4 rounded-xl border border-dashed p-3" onClick={stop}>
          <PairQr deviceId={d.id} size={96} hidden />
          <div className="min-w-0 space-y-1.5 text-sm">
            <p className="font-semibold">{neverConnected ? "Connect the phone" : "Phone not connected"}</p>
            <p className="text-muted-foreground">Open 7XEN Stream on the iPhone and scan this QR, or enter the key.</p>
            <button type="button" onClick={onShowKey} className="font-semibold text-primary hover:underline">
              Show key
            </button>
          </div>
        </div>
      ) : (
        <DeviceHealthPanel device={d} />
      )}

      <Button
        variant={live ? "default" : "outline"}
        className={cn("mt-auto w-full", live && "shadow-glow")}
        onClick={(e) => {
          stop(e);
          navigate(href);
        }}
      >
        {live ? <MonitorPlay /> : <Video />} {live ? "Watch live" : "Open"}
      </Button>
    </article>
  );
}
