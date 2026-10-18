import { useEffect, useRef, useState, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight, CheckCircle2, Hash, ImagePlus, ListOrdered, Loader2, ScanText, Upload, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { MAX_SCREENSHOT_BYTES, MAX_SCREENSHOTS_PER_UPLOAD, type ExtractionResult, type SampleSplit, type ScreenshotKind } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { Label } from "@7xen/ui/components/ui/label";
import { Progress } from "@7xen/ui/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@7xen/ui/components/ui/select";
import { cn } from "@7xen/ui/lib/utils";
import { errorMessage } from "@/lib/forms";
import { previewExtraction, readerKnownOffline, useCreateSample, useUpdateSample } from "./api";
import { draftFromExtraction, safeLabelsFromDraft, saveReading, setSampleNav } from "./labels";

type ItemStatus = "ready" | "reading" | "saving" | "done" | "failed";
interface Item {
  id: string;
  file: File;
  url: string;
  status: ItemStatus;
  note?: string;
  sampleId?: string;
}
const ACCEPT = ["image/png", "image/jpeg", "image/webp"];

const KINDS: { value: ScreenshotKind; title: string; text: string; icon: typeof Hash }[] = [
  { value: "SLOT_LIST", title: "Team list (slots)", text: "The 3×3 grid of slot numbers and player names", icon: Hash },
  { value: "RESULTS", title: "Final results", text: "Rank blocks with player names and finishes", icon: ListOrdered },
];

export function AddScreenshotsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const create = useCreateSample();
  const update = useUpdateSample();
  const [items, setItems] = useState<Item[]>([]);
  const [kind, setKind] = useState<ScreenshotKind | null>(null);
  const [split, setSplit] = useState<"AUTO" | SampleSplit>("AUTO");
  const [running, setRunning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);

  useEffect(() => {
    if (!open) {
      urls.current.forEach((u) => URL.revokeObjectURL(u));
      urls.current = [];
      setItems([]);
      setKind(null);
      setSplit("AUTO");
      setRunning(false);
    }
  }, [open]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const addFiles = (list: FileList | File[]) => {
    const files = [...list];
    const rejected: string[] = [];
    const next: Item[] = [];
    for (const f of files) {
      if (!ACCEPT.includes(f.type)) rejected.push(`${f.name}: use a PNG, JPG or WEBP image`);
      else if (f.size > MAX_SCREENSHOT_BYTES) rejected.push(`${f.name}: bigger than 10 MB`);
      else if (items.length + next.length >= MAX_SCREENSHOTS_PER_UPLOAD) rejected.push(`${f.name}: up to ${MAX_SCREENSHOTS_PER_UPLOAD} screenshots at a time`);
      else if (items.some((i) => i.file.name === f.name && i.file.size === f.size)) continue;
      else {
        const url = URL.createObjectURL(f);
        urls.current.push(url);
        next.push({ id: `${f.name}-${f.size}-${Math.random().toString(36).slice(2)}`, file: f, url, status: "ready" });
      }
    }
    if (rejected.length) toast.error(rejected.length === 1 ? rejected[0] : `${rejected.length} files skipped`, { description: rejected.length > 1 ? rejected.slice(0, 3).join("\n") : undefined });
    if (next.length) setItems((cur) => [...cur, ...next]);
  };

  const patch = (id: string, p: Partial<Item>) => setItems((cur) => cur.map((i) => (i.id === id ? { ...i, ...p } : i)));

  const start = async () => {
    if (!kind) return;
    setRunning(true);
    const created: string[] = [];
    let offline = 0;
    for (const it of items) {
      if (it.status === "done") {
        if (it.sampleId) created.push(it.sampleId);
        continue;
      }
      patch(it.id, { status: "reading", note: undefined });
      let ex: ExtractionResult | null = null;
      if (readerKnownOffline()) offline++;
      else
        try {
          ex = await previewExtraction(it.file, kind, it.file.name);
        } catch {
          offline++;
        }
      patch(it.id, { status: "saving" });
      try {
        const labels = ex ? safeLabelsFromDraft(draftFromExtraction(ex)) : kind === "SLOT_LIST" ? { teams: [] } : { rows: [] };
        const row = await create.mutateAsync({ file: it.file, kind, labels, split: split === "AUTO" ? undefined : split });
        // labels are unchecked model output → never train on them until the admin marks them checked
        if (row.verified) await update.mutateAsync({ id: row.id, input: { verified: false } }).catch(() => undefined);
        if (ex) saveReading(row.id, ex, true);
        created.push(row.id);
        const names = ex ? (kind === "SLOT_LIST" ? ex.teams : ex.rows).reduce((a, g) => a + g.players.length, 0) : 0;
        patch(it.id, { status: "done", sampleId: row.id, note: ex ? `Claude read ${names} names` : "Saved — the reader couldn't read it, label by hand" });
      } catch (e) {
        patch(it.id, { status: "failed", note: errorMessage(e) });
      }
    }
    setRunning(false);
    if (created.length) {
      setSampleNav(created);
      toast.success(`${created.length} ${created.length === 1 ? "screenshot" : "screenshots"} added`, {
        description: offline ? "The reader was offline for some — you'll type those labels by hand." : "Check the names Claude read, then mark them as checked.",
      });
    }
  };

  const done = items.filter((i) => i.status === "done");
  const finished = items.length > 0 && !running && items.every((i) => i.status === "done" || i.status === "failed");
  const progress = items.length ? (items.filter((i) => i.status === "done" || i.status === "failed").length / items.length) * 100 : 0;

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (!running && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !running && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl" onInteractOutside={(e) => running && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-2xl">
            <ImagePlus className="size-5 text-primary" /> Add screenshots
          </DialogTitle>
          <DialogDescription>Claude reads each screenshot first, so you only fix what it got wrong.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <fieldset disabled={running || finished} className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">1. What kind of screenshots?</legend>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Screenshot kind">
              {KINDS.map(({ value, title, text, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={kind === value}
                  onClick={() => setKind(value)}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border p-3 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60",
                    kind === value ? "border-primary bg-primary/10" : "hover:border-primary/40 hover:bg-muted/50",
                  )}
                >
                  <span className={cn("rounded-lg p-2", kind === value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                    <Icon className="size-4" />
                  </span>
                  <span>
                    <span className="block font-medium">{title}</span>
                    <span className="block text-xs text-muted-foreground">{text}</span>
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          <div>
            <div className="mb-2 text-sm font-medium">2. Choose images</div>
            {!running && !finished && (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                className={cn("flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors", dragOver ? "border-primary bg-primary/10" : "border-border bg-muted/30")}
              >
                <Upload className="size-7 text-primary" />
                <div className="text-sm">
                  Drop screenshots here or{" "}
                  <button type="button" onClick={() => input.current?.click()} className="font-semibold text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">
                    browse
                  </button>
                </div>
                <div className="text-xs text-muted-foreground">PNG, JPG or WEBP · up to 10 MB each · {MAX_SCREENSHOTS_PER_UPLOAD} at a time</div>
                <input
                  ref={input}
                  type="file"
                  accept={ACCEPT.join(",")}
                  multiple
                  className="sr-only"
                  onChange={(e) => {
                    if (e.target.files) addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>
            )}
            {items.length > 0 && (
              <ul className="mt-3 grid gap-2">
                {items.map((it) => (
                  <li key={it.id} className="flex items-center gap-3 rounded-lg border bg-card p-2">
                    <img src={it.url} alt="" className="aspect-[20/9] w-24 shrink-0 rounded-md bg-muted object-cover" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{it.file.name}</div>
                      <div className={cn("truncate text-xs", it.status === "failed" ? "text-destructive" : "text-muted-foreground")}>
                        {it.status === "ready" && `${(it.file.size / 1024 / 1024).toFixed(1)} MB · ready`}
                        {it.status === "reading" && "Claude is reading names…"}
                        {it.status === "saving" && "Saving…"}
                        {(it.status === "done" || it.status === "failed") && it.note}
                      </div>
                    </div>
                    <span className="shrink-0">
                      {it.status === "ready" && !running && (
                        <Button variant="ghost" size="icon-sm" aria-label={`Remove ${it.file.name}`} onClick={() => setItems((cur) => cur.filter((x) => x.id !== it.id))}>
                          <X />
                        </Button>
                      )}
                      {(it.status === "reading" || it.status === "saving") && <Loader2 className="size-4 animate-spin text-primary" />}
                      {it.status === "done" && (it.note?.startsWith("Saved") ? <AlertTriangle className="size-4 text-warning" /> : <CheckCircle2 className="size-4 text-success" />)}
                      {it.status === "failed" && <XCircle className="size-4 text-destructive" />}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {!finished && (
            <div className="grid gap-1.5 sm:max-w-xs">
              <Label htmlFor="upload-split">3. Use them for</Label>
              <Select value={split} onValueChange={(v) => setSplit(v as typeof split)} disabled={running}>
                <SelectTrigger id="upload-split" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="AUTO">Let 7xen decide (recommended)</SelectItem>
                  <SelectItem value="TRAIN">Training — general labelled examples</SelectItem>
                  <SelectItem value="TEST">Test — only to measure accuracy</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {(running || finished) && <Progress value={progress} aria-label="Upload progress" />}
        </div>

        <DialogFooter>
          {finished ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              {done.length > 0 && (
                <Button
                  onClick={() => {
                    const ids = done.map((d) => d.sampleId!).filter(Boolean);
                    setSampleNav(ids);
                    onOpenChange(false);
                    navigate(`/training/samples/${ids[0]}`);
                  }}
                >
                  Check labels now <ArrowRight />
                </Button>
              )}
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={running}>
                Cancel
              </Button>
              <Button onClick={start} disabled={!kind || !items.length || running} className="shadow-glow">
                {running ? <Loader2 className="animate-spin" /> : <ScanText />}
                {running ? "Reading…" : !kind ? "Pick a kind first" : `Read & add ${items.length || ""} ${items.length === 1 ? "screenshot" : "screenshots"}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
