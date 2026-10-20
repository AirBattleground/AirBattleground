import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { AlertTriangle, CheckCircle2, ImagePlus, Loader2, MonitorPlay, RotateCw, Smartphone, Trash2, UploadCloud, WifiOff, ZoomIn } from "lucide-react";
import { toast } from "sonner";
import {
  MAX_SCREENSHOT_BYTES,
  MAX_SCREENSHOTS_PER_UPLOAD,
  type ScreenshotKind,
  type ScreenshotRow,
} from "@7xen/shared";
import { Pill } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Progress } from "@7xen/ui/components/ui/progress";
import { cn } from "@7xen/ui/lib/utils";
import { ConfirmDialog } from "@/features/manager/components/ConfirmDialog";
import { screenshotUrl, useDeleteScreenshot, useRetryScreenshot, useUploadScreenshots } from "../api";

const ACCEPT = ["image/png", "image/jpeg", "image/webp"];

const isOffline = (s: ScreenshotRow) => s.status === "FAILED" && /offline|unreachable|reader is down/i.test(s.error ?? "");

/** "Read · 9 teams" etc. */
function doneLabel(s: ScreenshotRow): string {
  const ex = s.extraction;
  if (!ex) return "Read";
  if (s.kind === "SLOT_LIST") return `Read · ${ex.teams.length} team${ex.teams.length === 1 ? "" : "s"}`;
  return `Read · ${ex.rows.length} rank${ex.rows.length === 1 ? "" : "s"}`;
}

function StatusChip({ s }: { s: ScreenshotRow }) {
  switch (s.status) {
    case "QUEUED":
      return <Pill tone="neutral" icon={<Loader2 className="size-3.5 animate-spin" />}>Waiting</Pill>;
    case "PROCESSING":
      return <Pill tone="info" icon={<Loader2 className="size-3.5 animate-spin" />}>Reading…</Pill>;
    case "DONE":
      return (
        <Pill tone={s.extraction?.needsReview ? "warning" : "success"} icon={<CheckCircle2 className="size-3.5" />}>
          {doneLabel(s)}
        </Pill>
      );
    case "FAILED":
      return (
        <Pill tone="danger" icon={isOffline(s) ? <WifiOff className="size-3.5" /> : <AlertTriangle className="size-3.5" />}>
          {isOffline(s) ? "Reader offline" : "Couldn't read"}
        </Pill>
      );
  }
}

/** Phase 4: screenshots captured by the station / app / iPhone are tagged with a small source icon. */
function SourceBadge({ s }: { s: ScreenshotRow }) {
  const source = s.source as string;
  const label =
    source === "STATION" ? "From station" : source === "DEVICE" ? "From iPhone" : source === "APP_AUTO" ? "From app (auto)" : source === "APP_MANUAL" ? "From app" : null;
  if (!label) return null;
  const Icon = source === "STATION" ? MonitorPlay : Smartphone;
  return (
    <span title={label} aria-label={label} className="absolute top-1 left-1 grid size-5 place-items-center rounded bg-background/85 text-primary backdrop-blur-sm">
      <Icon className="size-3" />
    </span>
  );
}

interface Pending {
  key: string;
  url: string;
  name: string;
}

/**
 * Drag & drop / click / paste uploader + the uploaded screenshots of one kind with their
 * reading status. Clicking a thumbnail opens it full size via `onOpen(index)`.
 */
export function ScreenshotUploader({
  matchId,
  kind,
  screenshots,
  readOnly = false,
  onOpen,
  title,
  hint,
}: {
  matchId: string;
  kind: ScreenshotKind;
  screenshots: ScreenshotRow[];
  readOnly?: boolean;
  onOpen: (index: number) => void;
  title: string;
  /** optional one-line helper under the title */
  hint?: string;
}) {
  const upload = useUploadScreenshots(matchId);
  const retry = useRetryScreenshot(matchId);
  const del = useDeleteScreenshot(matchId);
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [progress, setProgress] = useState(0);
  const [deleting, setDeleting] = useState<ScreenshotRow | null>(null);

  useEffect(() => () => pending.forEach((p) => URL.revokeObjectURL(p.url)), [pending]);

  const send = useCallback(
    async (list: File[]) => {
      if (readOnly) return;
      const ok: File[] = [];
      const bad: string[] = [];
      for (const f of list) {
        if (!ACCEPT.includes(f.type)) bad.push(`${f.name || "That file"} isn't a PNG, JPG or WEBP image`);
        else if (f.size > MAX_SCREENSHOT_BYTES) bad.push(`${f.name || "That image"} is over 10 MB`);
        else ok.push(f);
      }
      if (bad.length) toast.error(bad.length === 1 ? bad[0] : `${bad.length} files were skipped`, { description: bad.length > 1 ? bad.join(" · ") : undefined });
      if (!ok.length) return;
      // the API takes up to 10 files per request
      for (let i = 0; i < ok.length; i += MAX_SCREENSHOTS_PER_UPLOAD) {
        const batch = ok.slice(i, i + MAX_SCREENSHOTS_PER_UPLOAD);
        const previews = batch.map((f, j) => ({ key: `${Date.now()}-${i + j}`, url: URL.createObjectURL(f), name: f.name || "Pasted screenshot" }));
        setPending(previews);
        setProgress(0);
        try {
          await upload.mutateAsync({ kind, files: batch, onProgress: setProgress });
        } catch {
          /* toast shown by the mutation */
        } finally {
          setPending([]);
        }
      }
    },
    [kind, readOnly, upload],
  );

  // paste from clipboard (Ctrl/Cmd+V anywhere on the page while this uploader is shown)
  useEffect(() => {
    if (readOnly) return;
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      e.preventDefault();
      void send(files.map((f, i) => (f.name ? f : new File([f], `pasted-${i + 1}.png`, { type: f.type }))));
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [readOnly, send]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    void send(Array.from(e.dataTransfer.files));
  };

  const uploading = pending.length > 0;
  const offline = screenshots.some(isOffline);

  return (
    <div className="space-y-3" data-tour="uploader">
      {!readOnly && (
        <div
          role="button"
          tabIndex={0}
          aria-label={`Upload ${title}`}
          onClick={() => !uploading && input.current?.click()}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && !uploading) {
              e.preventDefault();
              input.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          className={cn(
            "group relative flex min-h-16 cursor-pointer flex-wrap items-center gap-3 rounded-xl border-2 border-dashed px-4 py-3 outline-none transition-all focus-visible:ring-[3px] focus-visible:ring-ring/50",
            drag ? "border-primary bg-primary/10 shadow-glow" : "border-border bg-card hover:border-primary/50 hover:bg-primary/5",
            uploading && "cursor-progress",
          )}
        >
          <div className={cn("grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary transition-transform", drag && "scale-110")}>
            {uploading ? <Loader2 className="size-5 animate-spin" /> : <UploadCloud className="size-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{uploading ? `Uploading ${pending.length} screenshot${pending.length === 1 ? "" : "s"}…` : drag ? "Drop to upload" : title}</p>
            <p className="text-xs text-muted-foreground">
              {uploading ? "Keep this page open." : (hint ?? "Drop, choose or paste (Ctrl+V) · PNG / JPG up to 10 MB")}
            </p>
          </div>
          {uploading ? (
            <Progress value={progress} className="h-2 w-full sm:w-40" />
          ) : (
            <span className="hidden items-center gap-1 rounded-md border bg-background px-2.5 py-1.5 text-xs font-medium sm:inline-flex">
              <ImagePlus className="size-3.5" /> Choose files
            </span>
          )}
          <input
            ref={input}
            type="file"
            accept={ACCEPT.join(",")}
            multiple
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              void send(files);
            }}
          />
        </div>
      )}

      {offline && (
        <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          <WifiOff className="mt-0.5 size-5 shrink-0 text-warning-foreground dark:text-warning" />
          <p>
            <span className="font-semibold">Screenshot reader is offline.</span>{" "}
            <span className="text-muted-foreground">Type the details below, or retry in a few minutes.</span>
          </p>
        </div>
      )}

      {(screenshots.length > 0 || uploading) && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8">
          {screenshots.map((s, i) => (
            <li key={s.id} className="overflow-hidden rounded-lg border bg-card">
              <button
                type="button"
                onClick={() => onOpen(i)}
                className="group relative block aspect-[20/9] w-full overflow-hidden bg-muted outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                aria-label={`View screenshot ${i + 1} full size`}
              >
                <img src={screenshotUrl(s.id)} alt="" loading="lazy" className="size-full object-cover transition-transform group-hover:scale-105" />
                <SourceBadge s={s} />
                <span className="absolute inset-0 grid place-items-center bg-background/0 opacity-0 transition-all group-hover:bg-background/40 group-hover:opacity-100">
                  <ZoomIn className="size-6" />
                </span>
                {(s.status === "QUEUED" || s.status === "PROCESSING") && (
                  <span className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-primary/20">
                    <span className="block h-full w-1/3 animate-[sx-scan_1.2s_ease-in-out_infinite] bg-primary" />
                  </span>
                )}
              </button>
              <div className="space-y-1 p-1.5">
                <div className="flex items-center justify-between gap-1">
                  <StatusChip s={s} />
                  {!readOnly && (
                    <div className="flex">
                      {s.status === "FAILED" && (
                        <Button size="icon-sm" variant="ghost" aria-label="Retry reading" title="Retry" onClick={() => retry.mutate(s.id)}>
                          <RotateCw />
                        </Button>
                      )}
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        aria-label="Delete screenshot"
                        title="Delete"
                        onClick={() => setDeleting(s)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  )}
                </div>
                {s.status === "FAILED" && s.error && (
                  <p className="line-clamp-1 text-[11px] text-muted-foreground" title={s.error}>
                    {s.error}
                  </p>
                )}
              </div>
            </li>
          ))}
          {pending.map((p) => (
            <li key={p.key} className="overflow-hidden rounded-lg border border-primary/40 bg-card opacity-80">
              <div className="relative aspect-[20/9] bg-muted">
                <img src={p.url} alt="" className="size-full object-cover" />
                <span className="absolute inset-0 grid place-items-center bg-background/50">
                  <Loader2 className="size-6 animate-spin text-primary" />
                </span>
              </div>
              <div className="p-1.5">
                <Pill tone="brand" icon={<UploadCloud className="size-3.5" />}>
                  Uploading {progress}%
                </Pill>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this screenshot?"
        description="Names and numbers already filled in from it stay as they are — you can still edit them."
        confirmLabel="Delete"
        destructive
        onConfirm={() => deleting && del.mutate(deleting.id)}
      />
    </div>
  );
}
