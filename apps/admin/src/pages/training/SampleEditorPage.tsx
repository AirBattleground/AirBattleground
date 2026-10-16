import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useBlocker, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Info,
  Keyboard,
  Languages,
  Loader2,
  RefreshCw,
  Save,
  ScanText,
  SearchX,
  Trash2,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { SCREENSHOT_KIND_LABELS, type SampleSplit, type TrainingSampleDetail } from "@7xen/shared";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@7xen/ui/components/ui/alert-dialog";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { Label } from "@7xen/ui/components/ui/label";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { Switch } from "@7xen/ui/components/ui/switch";
import { Textarea } from "@7xen/ui/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@7xen/ui/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@7xen/ui/components/ui/tooltip";
import { cn } from "@7xen/ui/lib/utils";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { previewExtraction, sampleImageUrl, useExtractorStatus, useDeleteSample, usePrefillSample, useSample, useSamples, useUpdateSample } from "@/features/training/api";
import { KindPill, VerifiedPill } from "@/features/training/components";
import { SOURCE_LABELS, SPLIT_HINTS, SPLIT_LABELS } from "@/features/training/format";
import { ImageViewer } from "@/features/training/ImageViewer";
import { AddGroupButton, CharPalette, GlyphLegend, GroupCard, InsertTargetProvider } from "@/features/training/LabelFields";
import {
  draftFromExtraction,
  draftFromLabels,
  draftSignature,
  draftStats,
  emptyGroup,
  getSampleNav,
  labelsFromDraft,
  loadReading,
  saveReading,
  validateDraft,
  withHints,
  type LabelDraft,
} from "@/features/training/labels";
import { errorMessage } from "@/lib/forms";
import { relativeTime } from "@/lib/format";

const TOUR: TourStep[] = [
  { title: "Label editor", description: "Make the labels match the screenshot exactly. These become the 'right answers' the model learns from." },
  { element: '[data-tour="viewer"]', title: "The screenshot", description: "Scroll to zoom, drag to move, double-click to zoom in. Use the expand button for a bigger view.", side: "right" },
  { element: '[data-tour="editor-tools"]', title: "Helpers", description: "Re-read with the current model, show look-alike letters (I vs l vs 1, O vs 0), or open special characters like 多 シ 《》.", side: "bottom" },
  { element: '[data-tour="group-card"]', title: "One card per team", description: "Same order as the screenshot (left to right, top to bottom). Amber boxes are where the model wasn't sure.", side: "left" },
  { element: '[data-tour="sample-settings"]', title: "Training or test", description: "Test samples are kept aside to measure accuracy honestly. Turn off 'Use this sample' for blurry or broken screenshots.", side: "top" },
  { element: '[data-tour="save-bar"]', title: "Save and mark checked", description: "Only checked samples are used for training. Ctrl+S saves, Ctrl+Enter marks checked and opens the next one.", side: "top" },
];

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl";

export default function SampleEditorPage() {
  const { id } = useParams<{ id: string }>();
  const sample = useSample(id);
  usePageTour("admin.training.editor", TOUR, !!sample.data);

  if (sample.isPending)
    return (
      <div aria-busy aria-label="Loading">
        <Skeleton className="mb-6 h-16 w-72" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <Skeleton className="aspect-[20/9] rounded-xl" />
          <div className="space-y-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-48 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  if (sample.isError || !sample.data)
    return (
      <EmptyState
        icon={<SearchX />}
        title="Couldn't open this sample"
        description={errorMessage(sample.error)}
        action={
          <Button asChild variant="outline">
            <Link to="/training/samples">
              <ArrowLeft /> All samples
            </Link>
          </Button>
        }
      />
    );
  return (
    <InsertTargetProvider>
      <Editor key={sample.data.id} sample={sample.data} />
    </InsertTargetProvider>
  );
}

function initialDraft(sample: TrainingSampleDetail): LabelDraft {
  const reading = loadReading(sample.id);
  if (reading?.fresh && reading.extraction.kind === sample.kind) return draftFromExtraction(reading.extraction);
  return withHints(draftFromLabels(sample.kind, sample.labels), reading?.extraction ?? null);
}

function Editor({ sample }: { sample: TrainingSampleDetail }) {
  const navigate = useNavigate();
  const update = useUpdateSample();
  const prefill = usePrefillSample();
  const del = useDeleteSample();
  const allSamples = useSamples();
  const readerOffline = useExtractorStatus().data?.online === false;

  const [draft, setDraft] = useState<LabelDraft>(() => initialDraft(sample));
  const [notes, setNotes] = useState(sample.notes ?? "");
  const [attempted, setAttempted] = useState(false);
  const [showGlyphs, setShowGlyphs] = useState(() => {
    try {
      return localStorage.getItem("7xen.admin.training.glyphs") === "1";
    } catch {
      return false;
    }
  });
  const [showPalette, setShowPalette] = useState(false);
  const [rereadOpen, setRereadOpen] = useState(false);
  const [rereading, setRereading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [bigView, setBigView] = useState(false);
  const [newGroupKey, setNewGroupKey] = useState<string | null>(null);
  const skipBlock = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem("7xen.admin.training.glyphs", showGlyphs ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [showGlyphs]);

  const baseline = useMemo(() => draftSignature(draftFromLabels(sample.kind, sample.labels)), [sample.kind, sample.labels]);
  const labelsDirty = draftSignature(draft) !== baseline;
  const notesDirty = notes.trim() !== (sample.notes ?? "").trim();
  const dirty = labelsDirty || notesDirty;
  const errors = useMemo(() => validateDraft(draft), [draft]);
  const stats = draftStats(draft);
  const hasHints = draft.groups.some((g) => g.numOcr || g.players.some((p) => p.nameOcr));
  const isSlots = sample.kind === "SLOT_LIST";

  // ---------- prev / next ----------
  const navIds = useMemo(() => {
    const stored = getSampleNav();
    if (stored?.includes(sample.id)) return stored;
    return allSamples.data?.items.map((s) => s.id) ?? [sample.id];
  }, [allSamples.data, sample.id]);
  const idx = navIds.indexOf(sample.id);
  const prevId = idx > 0 ? navIds[idx - 1] : undefined;
  const nextId = idx >= 0 && idx < navIds.length - 1 ? navIds[idx + 1] : undefined;

  // ---------- unsaved-changes guard ----------
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !skipBlock.current && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  const go = useCallback(
    (to: string) => {
      skipBlock.current = true;
      navigate(to);
    },
    [navigate],
  );

  // ---------- save ----------
  const save = useCallback(
    async (opts: { verify?: boolean; unverify?: boolean; thenNext?: boolean } = {}): Promise<boolean> => {
      if (errors.count) {
        setAttempted(true);
        toast.error(`Fix ${errors.count} ${errors.count === 1 ? "problem" : "problems"} first`, { description: "They're marked in red next to the fields." });
        requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
        return false;
      }
      const labels = labelsFromDraft(draft);
      if (opts.verify) {
        const names = isSlots ? (labels as { teams: { players: string[] }[] }).teams.reduce((a, t) => a + t.players.length, 0) : stats.names;
        if (!names) {
          toast.error(`Add at least one ${isSlots ? "team" : "rank block"} before marking it checked`);
          return false;
        }
      }
      try {
        await update.mutateAsync({
          id: sample.id,
          input: {
            ...(labelsDirty || opts.verify ? { labels } : {}),
            ...(notesDirty ? { notes: notes.trim() } : {}),
            ...(opts.verify ? { verified: true } : opts.unverify ? { verified: false } : {}),
          },
        });
        const reading = loadReading(sample.id);
        if (reading?.fresh) saveReading(sample.id, reading.extraction, false);
        setAttempted(false);
        if (opts.thenNext) {
          if (nextId) {
            toast.success(opts.verify ? "Checked ✓ — next sample" : "Saved — next sample");
            go(`/training/samples/${nextId}`);
          } else {
            toast.success(opts.verify ? "Checked ✓ — that was the last one" : "Saved", { description: "Head to Training runs when you're ready to train." });
            go("/training/samples");
          }
        } else toast.success(opts.verify ? "Marked as checked — it will be used for training" : opts.unverify ? "Marked as needs checking" : "Labels saved");
        return true;
      } catch (e) {
        toast.error(errorMessage(e));
        return false;
      }
    },
    [errors.count, draft, isSlots, stats.names, update, sample.id, labelsDirty, notesDirty, notes, nextId, go],
  );

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!update.isPending) void save();
      } else if (mod && e.key === "Enter") {
        e.preventDefault();
        if (!update.isPending) void save({ verify: true, thenNext: true });
      } else if (e.altKey && e.key === "ArrowLeft" && prevId) {
        e.preventDefault();
        navigate(`/training/samples/${prevId}`);
      } else if (e.altKey && e.key === "ArrowRight" && nextId) {
        e.preventDefault();
        navigate(`/training/samples/${nextId}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, update.isPending, prevId, nextId, navigate]);

  // ---------- meta changes (saved right away) ----------
  const setMeta = async (input: { split?: SampleSplit; excluded?: boolean }, msg: string) => {
    try {
      await update.mutateAsync({ id: sample.id, input });
      toast.success(msg);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  // ---------- re-read with the current model ----------
  const reread = async () => {
    setRereading(true);
    try {
      let ex = null;
      try {
        const res = await fetch(sampleImageUrl(sample.id), { credentials: "include" });
        if (res.ok) ex = await previewExtraction(await res.blob(), sample.kind);
      } catch {
        ex = null;
      }
      if (ex) {
        // shows confidences + what changed; the admin saves when happy
        saveReading(sample.id, ex, true);
        setDraft(draftFromExtraction(ex));
        toast.success("The current model read it again", { description: `${ex.modelVersion} · check the amber fields, then save.` });
      } else {
        const d = await prefill.mutateAsync(sample.id);
        setDraft(draftFromLabels(d.kind, d.labels));
        toast.success("The current model read it again and the labels were replaced");
      }
      setAttempted(false);
      setRereadOpen(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRereading(false);
    }
  };

  const setGroup = (key: string, g: LabelDraft["groups"][number]) => setDraft((d) => ({ ...d, groups: d.groups.map((x) => (x.key === key ? g : x)) }));
  const removeGroup = (key: string) => {
    const prev = draft;
    setDraft((d) => ({ ...d, groups: d.groups.filter((g) => g.key !== key) }));
    toast(`${isSlots ? "Team" : "Rank block"} removed`, { action: { label: "Undo", onClick: () => setDraft(prev) } });
  };
  const addGroup = () => {
    const nums = draft.groups.map((g) => Number(g.num)).filter((n) => Number.isInteger(n) && n > 0);
    const g = emptyGroup(nums.length ? String(Math.max(...nums) + 1) : "");
    setNewGroupKey(g.key);
    setDraft((d) => ({ ...d, groups: [...d.groups, g] }));
  };

  const shownErrors = attempted ? errors : { ...errors, groups: Object.fromEntries(Object.entries(errors.groups).map(([k, v]) => [k, { warn: v.warn }])), players: {}, form: [] };

  return (
    <>
      <Link to="/training/samples" className="mb-3 inline-flex items-center gap-1 rounded text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <ArrowLeft className="size-4" /> All samples
      </Link>
      <PageHeader
        eyebrow="Label editor"
        title={<>Check the {isSlots ? "team list" : "results"}</>}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <KindPill kind={sample.kind} />
            <VerifiedPill verified={sample.verified} excluded={sample.excluded} />
            <span className="text-sm">
              {SOURCE_LABELS[sample.source]} · added {relativeTime(sample.createdAt)}
              {sample.createdBy && ` by ${sample.createdBy.displayName}`}
            </span>
          </span>
        }
        actions={
          <div className="flex items-center gap-1" role="group" aria-label="Sample navigation">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" disabled={!prevId} onClick={() => prevId && navigate(`/training/samples/${prevId}`)} aria-label="Previous sample">
                  <ChevronLeft />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Previous (Alt+←)</TooltipContent>
            </Tooltip>
            <span className="min-w-16 text-center text-sm font-medium text-muted-foreground tabular-nums">{idx >= 0 ? `${idx + 1} of ${navIds.length}` : "—"}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" disabled={!nextId} onClick={() => nextId && navigate(`/training/samples/${nextId}`)} aria-label="Next sample">
                  <ChevronRight />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Next (Alt+→)</TooltipContent>
            </Tooltip>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* left: screenshot + sample settings */}
        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <div data-tour="viewer">
            <ImageViewer src={sampleImageUrl(sample.id)} alt={`${SCREENSHOT_KIND_LABELS[sample.kind]} screenshot`} onExpand={() => setBigView(true)} />
          </div>

          <section className="space-y-4 rounded-xl border bg-card p-4 shadow-sm" data-tour="sample-settings">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-medium">Use this sample for</div>
                <div className="text-xs text-muted-foreground">{SPLIT_HINTS[sample.split]}</div>
              </div>
              <ToggleGroup
                type="single"
                variant="outline"
                value={sample.split}
                onValueChange={(v) => v && v !== sample.split && setMeta({ split: v as SampleSplit }, `Moved to ${SPLIT_LABELS[v as SampleSplit].toLowerCase()}`)}
                aria-label="Training or test"
                disabled={update.isPending}
              >
                <ToggleGroupItem value="TRAIN" className="px-3">Training</ToggleGroupItem>
                <ToggleGroupItem value="TEST" className="px-3">Test</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="use-sample" className="flex-col items-start gap-0.5">
                <span>Use this sample</span>
                <span className="text-xs font-normal text-muted-foreground">Turn off for blurry, cut-off or wrong screenshots</span>
              </Label>
              <Switch
                id="use-sample"
                checked={!sample.excluded}
                disabled={update.isPending}
                onCheckedChange={(on) => setMeta({ excluded: !on }, on ? "This sample will be used again" : "This sample won't be used")}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sample-notes">Notes</Label>
              <Textarea id="sample-notes" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} placeholder="Anything worth remembering, e.g. 'slot 10 empty in this lobby'" className="min-h-16" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Keyboard className="size-3.5" /> {MOD}+S save · {MOD}+Enter check &amp; next · Alt+←/→ move
              </div>
              <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2 /> Delete sample
              </Button>
            </div>
          </section>
        </div>

        {/* right: labels */}
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-2 shadow-sm" data-tour="editor-tools">
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={readerOffline ? 0 : -1} className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                  <Button variant="outline" size="sm" onClick={() => (stats.names ? setRereadOpen(true) : void reread())} disabled={rereading || readerOffline}>
                    {rereading ? <Loader2 className="animate-spin" /> : <ScanText />} Re-read with current model
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{readerOffline ? "The screenshot reader is offline right now" : "Let the active model read this screenshot again"}</TooltipContent>
            </Tooltip>
            <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-muted">
              <Switch checked={showGlyphs} onCheckedChange={setShowGlyphs} size="sm" aria-label="Show look-alike characters" />
              Look-alikes
            </label>
            <Button variant={showPalette ? "secondary" : "ghost"} size="sm" onClick={() => setShowPalette((v) => !v)} aria-expanded={showPalette}>
              <Languages /> Special characters
            </Button>
          </div>

          {showPalette && <CharPalette />}
          {showGlyphs && (
            <div className="rounded-xl border bg-card px-3 py-2">
              <GlyphLegend />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-sm text-muted-foreground" aria-live="polite">
            <span>
              <strong className="font-display text-base text-foreground">{stats.groups}</strong> {isSlots ? (stats.groups === 1 ? "team" : "teams") : stats.groups === 1 ? "rank" : "ranks"}
            </span>
            <span>
              <strong className="font-display text-base text-foreground">{stats.names}</strong> names
            </span>
            {stats.low > 0 && <span className="text-warning-foreground dark:text-warning">{stats.low} unsure</span>}
            {stats.corrected > 0 && <span className="text-success">{stats.corrected} corrected</span>}
          </div>

          {!hasHints && draft.groups.length > 0 && (
            <div className="flex gap-2 rounded-xl border border-info/30 bg-info/10 p-3 text-sm">
              <Info className="mt-0.5 size-4 shrink-0 text-info" />
              <span>These labels have no model reading attached. Click <strong>Re-read with current model</strong> to see what the model gets and how sure it is.</span>
            </div>
          )}
          {!isSlots && (
            <p className="px-1 text-xs text-muted-foreground">Results screens show no slot numbers. Rank 1 has a wings icon instead of a number. Skip blocks that are cut off at the edge.</p>
          )}
          {attempted && errors.form.map((m) => (
            <p key={m} className="flex items-center gap-1.5 rounded-lg bg-destructive/10 p-2 text-sm text-destructive">
              <AlertTriangle className="size-4" /> {m}
            </p>
          ))}

          {draft.groups.length === 0 ? (
            <EmptyState
              icon={isSlots ? <ScanText /> : <ScanText />}
              title={`No ${isSlots ? "teams" : "ranks"} yet`}
              description={`Re-read with the current model to pre-fill, or add each ${isSlots ? "team card" : "rank block"} you see in the screenshot.`}
              action={
                <Button onClick={addGroup} variant="outline">
                  {isSlots ? "Add team card" : "Add rank block"}
                </Button>
              }
            />
          ) : (
            <div className="grid gap-3">
              <AnimatePresence initial={false}>
                {draft.groups.map((g, i) => (
                  <GroupCard
                    key={g.key}
                    kind={sample.kind}
                    group={g}
                    index={i}
                    onChange={(ng) => setGroup(g.key, ng)}
                    onRemove={() => removeGroup(g.key)}
                    showGlyphs={showGlyphs}
                    errors={shownErrors}
                    focusNew={g.key === newGroupKey}
                    tour={i === 0}
                  />
                ))}
              </AnimatePresence>
              <AddGroupButton kind={sample.kind} onClick={addGroup} />
            </div>
          )}
        </div>
      </div>

      {/* save bar */}
      <div
        data-tour="save-bar"
        className="sticky bottom-4 z-20 mt-6 flex flex-col gap-3 rounded-xl border bg-popover/95 p-3 shadow-lg backdrop-blur sm:flex-row sm:items-center"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          {attempted && errors.count > 0 ? (
            <span className="flex items-center gap-1.5 font-medium text-destructive">
              <AlertTriangle className="size-4" /> {errors.count} {errors.count === 1 ? "problem" : "problems"} to fix
            </span>
          ) : dirty ? (
            <span className="flex items-center gap-1.5 font-medium text-warning-foreground dark:text-warning">
              <span className="size-2 rounded-full bg-warning" /> Unsaved changes
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <BadgeCheck className="size-4 text-success" /> All changes saved
            </span>
          )}
          {sample.verified && !sample.excluded && <span className="hidden text-muted-foreground md:inline">· used for training</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sample.verified && (
            <Button variant="ghost" size="sm" onClick={() => save({ unverify: true })} disabled={update.isPending}>
              <Undo2 /> Needs checking
            </Button>
          )}
          <Button variant="outline" onClick={() => save()} disabled={update.isPending || !dirty}>
            {update.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save
            <kbd className="ml-1 hidden rounded border bg-muted px-1 text-[10px] text-muted-foreground sm:inline">{MOD}+S</kbd>
          </Button>
          <Button onClick={() => save({ verify: true, thenNext: true })} disabled={update.isPending} className="shadow-glow">
            <BadgeCheck /> Mark checked{nextId ? " & next" : ""}
            <kbd className="ml-1 hidden rounded border border-primary-foreground/30 px-1 text-[10px] sm:inline">{MOD}+↵</kbd>
          </Button>
        </div>
      </div>

      {/* dialogs */}
      <Dialog open={bigView} onOpenChange={setBigView}>
        <DialogContent className="max-w-[min(96vw,1400px)] sm:max-w-[min(96vw,1400px)]">
          <DialogHeader>
            <DialogTitle className="font-display">Screenshot</DialogTitle>
            <DialogDescription>Scroll to zoom, drag to move.</DialogDescription>
          </DialogHeader>
          <ImageViewer src={sampleImageUrl(sample.id)} alt={`${SCREENSHOT_KIND_LABELS[sample.kind]} screenshot`} />
        </DialogContent>
      </Dialog>

      <AlertDialog open={rereadOpen} onOpenChange={(o) => !rereading && setRereadOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl">Replace labels with a new reading?</AlertDialogTitle>
            <AlertDialogDescription>
              The current model reads the screenshot again and its answers replace what's in the editor now ({stats.names} names). You'll see how sure it was for each field. Your fixes are lost unless you skip saving.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rereading}>Keep my labels</AlertDialogCancel>
            <Button onClick={reread} disabled={rereading}>
              {rereading ? <Loader2 className="animate-spin" /> : <RefreshCw />} {rereading ? "Reading…" : "Re-read"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={(o) => !del.isPending && setDeleteOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl">Delete this sample?</AlertDialogTitle>
            <AlertDialogDescription>The screenshot and its labels are removed for good. Models already trained keep what they learned. To just stop using it, turn off “Use this sample” instead.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={del.isPending}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={del.isPending}
              onClick={async () => {
                try {
                  await del.mutateAsync(sample.id);
                  toast.success("Sample deleted");
                  setDeleteOpen(false);
                  go(nextId ? `/training/samples/${nextId}` : prevId ? `/training/samples/${prevId}` : "/training/samples");
                } catch (e) {
                  toast.error(errorMessage(e));
                }
              }}
            >
              {del.isPending ? "Deleting…" : "Delete sample"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={blocker.state === "blocked"}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl">Save your changes?</AlertDialogTitle>
            <AlertDialogDescription>You changed labels on this sample and haven't saved them yet.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className={cn("gap-2")}>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>Stay here</AlertDialogCancel>
            <Button variant="outline" onClick={() => blocker.proceed?.()}>
              Discard
            </Button>
            <Button
              onClick={async () => {
                const ok = await save();
                if (ok) blocker.proceed?.();
                else blocker.reset?.();
              }}
              disabled={update.isPending}
            >
              Save &amp; continue
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
