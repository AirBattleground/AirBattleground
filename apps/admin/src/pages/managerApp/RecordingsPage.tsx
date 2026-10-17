import { useState } from "react";
import { AlertTriangle, Download, Film, Play, Trash2, Video } from "lucide-react";
import { toast } from "sonner";
import type { RecordingStatus } from "@7xen/shared";
import { EmptyState } from "@7xen/ui/components/brand/page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@7xen/ui/components/ui/alert-dialog";
import { Button } from "@7xen/ui/components/ui/button";
import { Progress } from "@7xen/ui/components/ui/progress";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@7xen/ui/components/ui/toggle-group";
import { cn } from "@7xen/ui/lib/utils";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { SearchInput } from "@/components/SearchInput";
import { adminPosterUrl, adminVideoUrl, managerName, useAdminRecordings, useAppSettings, useDeleteRecording, type AdminRecordingRow } from "@/features/managerApp/api";
import { fmtBytes, fmtDuration, ManagerAppHeader, RECORDING_FILTERS, RecordingStatusPill, StorageBar, VideoDialog } from "@/features/managerApp/components";
import { useDebounced } from "@/hooks/use-debounce";
import { errorMessage } from "@/lib/forms";
import { relativeTime } from "@/lib/format";

const TOUR: TourStep[] = [
  { title: "Match recordings", description: "Every match the managers record with the 7XEN Manager app lands here — live, uploading, then ready to watch." },
  { element: '[data-tour="storage"]', title: "Storage", description: "How much disk the videos use. Old videos are deleted automatically after the retention days in Settings.", side: "bottom" },
  { element: '[data-tour="rec-filters"]', title: "Find a recording", description: "Filter by status or search by match or manager.", side: "bottom" },
  { element: '[data-tour="rec-list"]', title: "Watch or delete", description: "Click a ready video to play it. Delete removes the file from the server for good.", side: "top" },
];

const facts = (r: AdminRecordingRow) =>
  [r.deviceName ?? "Unknown phone", r.durationSec != null ? fmtDuration(r.durationSec) : null, r.sizeBytes ? fmtBytes(r.sizeBytes) : null].filter(Boolean).join(" · ");

function Poster({ r }: { r: AdminRecordingRow }) {
  const [broken, setBroken] = useState(false);
  return (
    <>
      {r.hasPoster && !broken ? (
        <img src={adminPosterUrl(r.id)} alt="" loading="lazy" onError={() => setBroken(true)} className="size-full object-cover transition-transform group-hover:scale-105" />
      ) : (
        <span className="absolute inset-0 grid place-items-center text-muted-foreground">
          <Film className="size-8" />
        </span>
      )}
      {r.status === "READY" && (
        <span className="absolute inset-0 grid place-items-center bg-background/0 transition-colors group-hover:bg-background/40">
          <span className="flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-glow transition-transform group-hover:scale-110">
            <Play className="size-5 fill-current" />
          </span>
        </span>
      )}
    </>
  );
}

function RecordingCard({ r, onPlay, onDelete }: { r: AdminRecordingRow; onPlay: () => void; onDelete: () => void }) {
  const ready = r.status === "READY";
  const pct = r.sizeBytes ? Math.min(100, Math.round((r.uploadedBytes / r.sizeBytes) * 100)) : 0;
  return (
    <li className="flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
      <button
        type="button"
        disabled={!ready}
        onClick={onPlay}
        aria-label={ready ? `Play ${r.matchTitle}` : `${r.matchTitle} (not ready to play)`}
        className="group relative block aspect-video w-full overflow-hidden bg-muted outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default"
      >
        <Poster r={r} />
        <RecordingStatusPill status={r.status} className="absolute top-2 left-2 bg-card/90 backdrop-blur-sm" />
      </button>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <div className="line-clamp-2 font-display text-lg leading-tight font-bold" title={r.matchTitle}>
          {r.matchTitle}
        </div>
        <div className="truncate text-sm text-muted-foreground">
          {managerName(r)} · {relativeTime(r.startedAt)}
        </div>
        <div className="truncate text-xs text-muted-foreground">{facts(r)}</div>
        {r.status === "UPLOADING" && (
          <div className="space-y-1">
            <Progress value={pct} className="h-1.5" aria-label="Upload progress" />
            <div className="text-xs text-muted-foreground">
              {pct}% · {fmtBytes(r.uploadedBytes)} of {fmtBytes(r.sizeBytes)}
            </div>
          </div>
        )}
        {r.status === "FAILED" && r.error && <p className="line-clamp-2 text-xs text-destructive">{r.error}</p>}
        <div className="mt-auto flex items-center justify-end gap-1 pt-1">
          {ready && (
            <Button asChild variant="ghost" size="sm">
              <a href={adminVideoUrl(r.id)} download>
                <Download /> Download
              </a>
            </Button>
          )}
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={onDelete} disabled={r.status === "LIVE"} title={r.status === "LIVE" ? "Can't delete while recording" : undefined}>
            <Trash2 /> Delete
          </Button>
        </div>
      </div>
    </li>
  );
}

export default function RecordingsPage() {
  usePageTour("admin.recordings", TOUR);
  const [status, setStatus] = useState<RecordingStatus | "">("");
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 300);
  const list = useAdminRecordings({ status, q });
  const settings = useAppSettings();
  const del = useDeleteRecording();
  const [playing, setPlaying] = useState<AdminRecordingRow | null>(null);
  const [deleting, setDeleting] = useState<AdminRecordingRow | null>(null);
  const items = (list.data?.items ?? []).filter((r) => r.status !== "DELETED");

  return (
    <>
      <ManagerAppHeader title="Recordings" description="Match videos recorded by managers with the 7XEN Manager app." />

      <div className="space-y-5">
        <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
          {settings.isPending ? (
            <Skeleton className="h-16 rounded-lg" />
          ) : settings.data ? (
            <StorageBar storage={settings.data.videoStorage} />
          ) : (
            <p className="text-sm text-muted-foreground" data-tour="storage">
              Storage details aren't available yet.
            </p>
          )}
        </section>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" data-tour="rec-filters">
          <ToggleGroup type="single" variant="outline" value={status} onValueChange={(v) => setStatus((v as RecordingStatus | "") ?? "")} className="flex-wrap" aria-label="Filter by status">
            {RECORDING_FILTERS.map((f) => (
              <ToggleGroupItem key={f.label} value={f.value} className="px-3 text-xs sm:text-sm">
                {f.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <SearchInput value={search} onChange={setSearch} placeholder="Search match or manager" loading={list.isFetching && search !== ""} />
        </div>

        <div data-tour="rec-list">
          {list.isPending ? (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-72 rounded-xl" />
              ))}
            </ul>
          ) : list.isError ? (
            <EmptyState icon={<AlertTriangle />} title="Couldn't load recordings" description={errorMessage(list.error)} action={<Button onClick={() => void list.refetch()}>Try again</Button>} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={<Video />}
              title={status || q ? "No recordings match" : "No recordings yet"}
              description={status || q ? "Try another status or clear the search." : "When a manager taps Go live in the 7XEN Manager app, the match video shows up here."}
            />
          ) : (
            <ul className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-3 transition-opacity", list.isPlaceholderData && "opacity-60")}>
              {items.map((r) => (
                <RecordingCard key={r.id} r={r} onPlay={() => setPlaying(r)} onDelete={() => setDeleting(r)} />
              ))}
            </ul>
          )}
        </div>
      </div>

      <VideoDialog
        open={!!playing}
        onOpenChange={(o) => !o && setPlaying(null)}
        title={playing?.matchTitle ?? ""}
        subtitle={playing ? `${managerName(playing)} · ${facts(playing)}` : undefined}
        src={playing ? adminVideoUrl(playing.id) : ""}
        poster={playing?.hasPoster ? adminPosterUrl(playing.id) : undefined}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl">Delete this recording?</AlertDialogTitle>
            <AlertDialogDescription>
              The video of <strong className="text-foreground">{deleting?.matchTitle}</strong>
              {deleting?.sizeBytes ? ` (${fmtBytes(deleting.sizeBytes)})` : ""} is removed from the server for good. Match results and screenshots are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                deleting &&
                del.mutate(deleting.id, {
                  onSuccess: () => toast.success("Recording deleted"),
                  onError: (err) => toast.error("Couldn't delete the recording", { description: errorMessage(err) }),
                })
              }
            >
              Delete video
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
