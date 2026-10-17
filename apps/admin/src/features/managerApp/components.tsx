import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, CircleStop, Download, HardDrive, ListChecks, Loader2, Settings2, Trash, UploadCloud, Video } from "lucide-react";
import type { AppSettings, RecordingStatus } from "@7xen/shared";
import { PageHeader } from "@7xen/ui/components/brand/page";
import { Pill, type Tone } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { cn } from "@7xen/ui/lib/utils";

// ---------- format ----------
export function fmtBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function fmtDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

// ---------- status ----------
const STATUS: Record<RecordingStatus, { label: string; tone: Tone; icon: ReactNode }> = {
  LIVE: { label: "Live", tone: "danger", icon: <span className="size-2 animate-pulse rounded-full bg-destructive" /> },
  STOPPED: { label: "Waiting to upload", tone: "neutral", icon: <CircleStop className="size-3.5" /> },
  UPLOADING: { label: "Uploading", tone: "info", icon: <UploadCloud className="size-3.5" /> },
  PROCESSING: { label: "Processing", tone: "warning", icon: <Loader2 className="size-3.5 animate-spin" /> },
  READY: { label: "Ready", tone: "success", icon: <CheckCircle2 className="size-3.5" /> },
  FAILED: { label: "Failed", tone: "danger", icon: <AlertTriangle className="size-3.5" /> },
  DELETED: { label: "Deleted", tone: "neutral", icon: <Trash className="size-3.5" /> },
};
export const RECORDING_FILTERS: { value: RecordingStatus | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "LIVE", label: "Live" },
  { value: "UPLOADING", label: "Uploading" },
  { value: "PROCESSING", label: "Processing" },
  { value: "READY", label: "Ready" },
  { value: "FAILED", label: "Failed" },
];

export function RecordingStatusPill({ status, className }: { status: RecordingStatus; className?: string }) {
  const s = STATUS[status] ?? STATUS.FAILED;
  return (
    <Pill tone={s.tone} icon={s.icon} className={className}>
      {s.label}
    </Pill>
  );
}

// ---------- player ----------
/** <video> streams with HTTP Range requests, so seeking works without downloading the whole file. */
export function VideoDialog({ open, onOpenChange, title, subtitle, src, poster }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; subtitle?: string; src: string; poster?: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-1rem)] gap-3 p-3 sm:max-w-4xl sm:p-5">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="font-display text-xl">{title}</DialogTitle>
          {subtitle && <DialogDescription>{subtitle}</DialogDescription>}
        </DialogHeader>
        {open && (
          <video key={src} src={src} poster={poster} controls autoPlay playsInline preload="metadata" className="aspect-video w-full rounded-lg border bg-muted object-contain">
            Your browser can't play this video. Use the download button instead.
          </video>
        )}
        <div className="flex justify-end">
          <Button asChild variant="outline" size="sm">
            <a href={src} download>
              <Download /> Download
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- storage ----------
export function StorageBar({ storage, className }: { storage: AppSettings["videoStorage"]; className?: string }) {
  const total = storage.freeBytes != null ? storage.usedBytes + storage.freeBytes : null;
  const pct = total ? Math.min(100, (storage.usedBytes / total) * 100) : null;
  const tone = pct == null ? "bg-primary" : pct > 90 ? "bg-destructive" : pct > 75 ? "bg-warning" : "bg-primary";
  return (
    <div className={cn("space-y-2", className)} data-tour="storage">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex items-center gap-2">
          <HardDrive className="size-5 text-primary" />
          <span className="font-display text-2xl leading-none font-bold">{fmtBytes(storage.usedBytes)}</span>
          <span className="text-sm text-muted-foreground">
            used by {storage.videos} video{storage.videos === 1 ? "" : "s"}
          </span>
        </div>
        <span className="text-sm text-muted-foreground">{storage.freeBytes != null ? `${fmtBytes(storage.freeBytes)} free on disk` : "Free space unknown"}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="meter" aria-label="Video storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct != null ? Math.round(pct) : undefined}>
        <div className={cn("h-full rounded-full transition-[width] duration-500", tone)} style={{ width: `${pct ?? (storage.usedBytes > 0 ? 100 : 0)}%` }} />
      </div>
      <p className="truncate font-mono text-[11px] text-muted-foreground" title={storage.dir}>
        {storage.dir}
      </p>
    </div>
  );
}

// ---------- section tabs ----------
const TABS = [
  { to: "/manager-app/recordings", label: "Recordings", icon: Video, tour: "tab-recordings" },
  { to: "/manager-app/recipes", label: "Recipes", icon: ListChecks, tour: "tab-recipes" },
  { to: "/manager-app/settings", label: "Settings", icon: Settings2, tour: "tab-settings" },
];

/** Header + tabs shared by the Manager app pages (Recordings / Recipes / Settings). */
export function ManagerAppHeader({ title, description, actions }: { title: ReactNode; description: ReactNode; actions?: ReactNode }) {
  return (
    <>
      <PageHeader eyebrow="Manager app" title={title} description={description} actions={actions} />
      <nav aria-label="Manager app" className="mb-6 flex gap-1 overflow-x-auto border-b">
        {TABS.map(({ to, label, icon: Icon, tour }) => (
          <NavLink
            key={to}
            to={to}
            data-tour={tour}
            className={({ isActive }: { isActive: boolean }) =>
              cn(
                "relative inline-flex h-11 shrink-0 items-center gap-2 rounded-t-lg px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )
            }
          >
            {({ isActive }: { isActive: boolean }) => (
              <>
                <Icon className={cn("size-4", isActive && "text-primary")} />
                {label}
                {isActive && <motion.span layoutId="mapp-tab" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary shadow-glow" />}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
