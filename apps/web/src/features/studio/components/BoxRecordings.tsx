import { useState } from "react";
import { format, parseISO } from "date-fns";
import { Download, Film, HardDrive, Play, Trash2 } from "lucide-react";
import type { BoxRecording } from "@7xen/shared";
import { EmptyState } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { Progress } from "@7xen/ui/components/ui/progress";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { ConfirmDialog } from "@/features/manager/components/ConfirmDialog";
import { boxRecordingUrl, useBoxRecordings, useDeleteBoxRecording } from "../box";

const gb = (b: number) => `${(b / 1024 ** 3).toFixed(b >= 10 * 1024 ** 3 ? 0 : 1)} GB`;
const size = (b: number) => (b >= 1024 ** 3 ? gb(b) : `${Math.max(1, Math.round(b / 1024 ** 2))} MB`);

/** "Record on this box" recordings: play, download, delete, and how much disk is left. */
export function BoxRecordingsSection() {
  const q = useBoxRecordings();
  const del = useDeleteBoxRecording();
  const [playing, setPlaying] = useState<BoxRecording | null>(null);
  const [removing, setRemoving] = useState<BoxRecording | null>(null);
  const disk = q.data?.disk;
  const usedPct = disk && disk.totalBytes ? Math.round(((disk.totalBytes - disk.freeBytes) / disk.totalBytes) * 100) : 0;

  return (
    <section data-tour="box-recordings" className="mb-6 rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-xl font-bold">
            <Film className="size-5 text-primary" /> Recordings on this box
          </h2>
          <p className="text-sm text-muted-foreground">Shows recorded with “Record on this box”. They stay on this PC only.</p>
        </div>
        {disk && (
          <div className="w-48 text-xs text-muted-foreground">
            <p className="mb-1 flex items-center gap-1.5">
              <HardDrive className="size-3.5" /> {gb(disk.freeBytes)} free of {gb(disk.totalBytes)}
            </p>
            <Progress value={usedPct} className="h-1.5" />
          </div>
        )}
      </div>

      {!q.data ? (
        <Skeleton className="h-16 rounded-lg" />
      ) : q.data.items.length === 0 ? (
        <EmptyState icon={<Film />} title="No recordings yet" description="Open a show, choose “Record on this box” in Where it goes, then press Start recording." />
      ) : (
        <ul className="divide-y rounded-lg border">
          {q.data.items.map((r) => (
            <li key={r.file} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate font-semibold">
                  {r.recording && <span className="rounded bg-destructive px-1.5 py-px text-[10px] font-bold text-white">● REC</span>}
                  {r.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {format(parseISO(r.startedAt), "EEE, d MMM · h:mm a")} · {size(r.sizeBytes)}
                </p>
              </div>
              <div className="flex gap-1.5">
                <Button size="sm" variant="outline" onClick={() => setPlaying(r)}>
                  <Play /> Play
                </Button>
                <Button asChild size="sm" variant="outline" aria-label={`Download ${r.title}`}>
                  <a href={boxRecordingUrl(r.file, true)} download={r.file}>
                    <Download /> <span className="hidden sm:inline">Download</span>
                  </a>
                </Button>
                <Button size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-destructive" aria-label={`Delete ${r.title}`} disabled={r.recording} onClick={() => setRemoving(r)}>
                  <Trash2 />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!playing} onOpenChange={(o) => !o && setPlaying(null)}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{playing?.title}</DialogTitle>
          </DialogHeader>
          {playing && <video src={boxRecordingUrl(playing.file)} controls autoPlay playsInline className="aspect-video w-full rounded-lg bg-black" />}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Delete “${removing?.title ?? "this recording"}”?`}
        description="The video file is removed from this PC for good."
        confirmLabel="Delete"
        destructive
        onConfirm={() => removing && del.mutate(removing.file)}
      />
    </section>
  );
}
