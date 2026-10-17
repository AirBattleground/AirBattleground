import type { ReactNode } from "react";
import { AlertTriangle, Loader2, MonitorOff, MonitorPlay } from "lucide-react";
import type { StationPhase, StationStatus } from "@7xen/shared";
import { Pill, type Tone } from "@7xen/ui/components/brand/status";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { cn } from "@7xen/ui/lib/utils";
import { relativeTime } from "@/lib/format";
import { useStationStatus } from "./api";

const PHASE: Record<StationPhase, { label: string; tone: Tone; icon?: ReactNode }> = {
  IDLE: { label: "Ready", tone: "success", icon: <span className="size-2 rounded-full bg-success" /> },
  STARTING_EMULATOR: { label: "Starting emulator", tone: "info", icon: <Loader2 className="size-3.5 animate-spin" /> },
  LAUNCHING_BGMI: { label: "Opening BGMI", tone: "info", icon: <Loader2 className="size-3.5 animate-spin" /> },
  LIVE: { label: "Live", tone: "danger", icon: <span className="size-2 animate-pulse rounded-full bg-destructive" /> },
  STOPPING: { label: "Saving video", tone: "neutral", icon: <Loader2 className="size-3.5 animate-spin" /> },
  ERROR: { label: "Problem", tone: "danger", icon: <AlertTriangle className="size-3.5" /> },
};

export function StationPill({ s }: { s: StationStatus }) {
  if (!s.online)
    return (
      <Pill tone="neutral" icon={<MonitorOff className="size-3.5" />}>
        Offline
      </Pill>
    );
  const p = PHASE[s.phase] ?? PHASE.ERROR;
  return (
    <Pill tone={p.tone} icon={p.icon}>
      {p.label}
    </Pill>
  );
}

/** One line of facts: "Emulator ready · BGMI installed · v1.2.0" or the current match. */
export function stationFacts(s: StationStatus): string {
  if (!s.online) return "The 7XEN Station PC isn't running — managers record with the phone app instead.";
  const parts: string[] = [];
  if (s.matchId && s.phase !== "IDLE") parts.push(`Match ${s.matchId.slice(-6)}${s.startedAt ? ` · started ${relativeTime(s.startedAt)}` : ""}`);
  else parts.push(s.emulator === "READY" ? "Emulator running" : s.emulator === "BOOTING" ? "Emulator booting" : "Emulator off (starts on demand)");
  parts.push(s.bgmiInstalled ? "BGMI installed" : "BGMI not installed");
  if (s.version) parts.push(`v${s.version}`);
  return parts.join(" · ");
}

/** Overview card: is the Station up, and what is it doing. */
export function StationCard({ className }: { className?: string }) {
  const q = useStationStatus();
  const s = q.data;
  const live = s?.online && s.phase === "LIVE";
  return (
    <section
      data-tour="station-card"
      aria-labelledby="station-card-title"
      className={cn("flex items-center gap-4 rounded-xl border bg-card p-5 shadow-sm", live && "border-destructive/40", className)}
    >
      <div
        className={cn(
          "relative flex size-12 shrink-0 items-center justify-center rounded-xl [&_svg]:size-6",
          !s ? "bg-muted text-muted-foreground" : !s.online ? "bg-muted text-muted-foreground" : live ? "bg-destructive/10 text-destructive" : "bg-success/15 text-success",
        )}
      >
        {s && !s.online ? <MonitorOff /> : <MonitorPlay />}
        {live && <span className="absolute -top-0.5 -right-0.5 size-3 animate-pulse rounded-full border-2 border-card bg-destructive" aria-hidden />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="station-card-title" className="font-display text-xl font-bold">
            7XEN Station
          </h2>
          {s ? <StationPill s={s} /> : <Skeleton className="h-5 w-16 rounded-full" />}
        </div>
        <div className="text-sm text-muted-foreground">
          {q.isPending ? <Skeleton className="mt-1 h-4 w-56" /> : q.isError ? "Couldn't check the station." : s && stationFacts(s)}
        </div>
        {s?.online && s.error && <p className="mt-1 line-clamp-2 text-xs text-destructive">{s.error}</p>}
      </div>
    </section>
  );
}
