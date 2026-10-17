import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleStop, Download, Loader2, Trash, UploadCloud } from "lucide-react";
import type { RecordingRow, RecordingStatus } from "@7xen/shared";
import { Pill, type Tone } from "@7xen/ui/components/brand/status";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { Button } from "@7xen/ui/components/ui/button";
import { fmtBytes, fmtClock, fmtDuration } from "../format";

const STATUS: Record<RecordingStatus, { label: string; tone: Tone; icon: ReactNode }> = {
  LIVE: { label: "Live", tone: "danger", icon: <span className="size-2 animate-pulse rounded-full bg-destructive" /> },
  STOPPED: { label: "Waiting to upload", tone: "neutral", icon: <CircleStop className="size-3.5" /> },
  UPLOADING: { label: "Uploading", tone: "info", icon: <UploadCloud className="size-3.5" /> },
  PROCESSING: { label: "Processing", tone: "warning", icon: <Loader2 className="size-3.5 animate-spin" /> },
  READY: { label: "Ready", tone: "success", icon: <CheckCircle2 className="size-3.5" /> },
  FAILED: { label: "Failed", tone: "danger", icon: <AlertTriangle className="size-3.5" /> },
  DELETED: { label: "Deleted", tone: "neutral", icon: <Trash className="size-3.5" /> },
};

export function RecordingStatusPill({ status, className }: { status: RecordingStatus; className?: string }) {
  const s = STATUS[status] ?? STATUS.FAILED;
  return (
    <Pill tone={s.tone} icon={s.icon} className={className}>
      {s.label}
    </Pill>
  );
}

export function uploadPct(r: Pick<RecordingRow, "uploadedBytes" | "sizeBytes">): number {
  if (!r.sizeBytes) return 0;
  return Math.min(100, Math.round((r.uploadedBytes / r.sizeBytes) * 100));
}

/** One-line facts: "Rahul's phone · 7:42 PM · 24:10 · 512 MB" */
export function recordingFacts(r: RecordingRow): string {
  return [r.deviceName ?? "Unknown phone", fmtClock(r.startedAt), r.durationSec != null ? fmtDuration(r.durationSec) : null, r.sizeBytes ? fmtBytes(r.sizeBytes) : null]
    .filter(Boolean)
    .join(" · ");
}

/** Plays a recording. <video> streams it with HTTP Range requests, so seeking works without downloading everything. */
export function VideoDialog({
  open,
  onOpenChange,
  title,
  subtitle,
  src,
  poster,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  src: string;
  poster?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-1rem)] gap-3 p-3 sm:max-w-4xl sm:p-5">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="font-display text-xl">{title}</DialogTitle>
          {subtitle && <DialogDescription>{subtitle}</DialogDescription>}
        </DialogHeader>
        {open && (
          <video
            key={src}
            src={src}
            poster={poster}
            controls
            autoPlay
            playsInline
            preload="metadata"
            className="aspect-video w-full rounded-lg border bg-muted object-contain"
          >
            Your browser can't play this video. Use the download button instead.
          </video>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Tip: drag the timeline to jump — the video streams, no need to wait.</p>
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
