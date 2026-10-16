import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, ChevronDown, Clock, FlaskConical, GraduationCap, Info, Loader2, PlugZap, RefreshCw, Sparkles, Terminal, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { ModelVersion, TrainingRun, TrainingSampleRow } from "@7xen/shared";
import { EmptyState } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { Label } from "@7xen/ui/components/ui/label";
import { Progress } from "@7xen/ui/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@7xen/ui/components/ui/select";
import { Switch } from "@7xen/ui/components/ui/switch";
import { Textarea } from "@7xen/ui/components/ui/textarea";
import { cn } from "@7xen/ui/lib/utils";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { ListSkeleton } from "@/components/ListSkeleton";
import { useExtractorStatus } from "@/features/training/api";
import { useModels, useRuns, useSamples, useStartRun } from "@/features/training/api";
import { MetricDelta, MetricText, RunStatusPill, TrainingHeader } from "@/features/training/components";
import { METRICS, duration, metricGain } from "@/features/training/format";
import { errorMessage } from "@/lib/forms";
import { relativeTime } from "@/lib/format";

const OFFLINE_TEXT = "Training runs inside the reader service, so you can start one once it’s back online. Samples still work — keep checking them.";

const TOUR: TourStep[] = [
  { title: "Training runs", description: "A training run makes a new model version from your checked samples, then measures whether it reads better." },
  { element: '[data-tour="train-btn"]', title: "Train a new version", description: "Starts from the version in use and learns from every checked sample. Your current version stays active until you switch.", side: "bottom" },
  { element: '[data-tour="run-list"]', title: "Progress and results", description: "Watch progress live. When it finishes you see accuracy before → after, and a link to the new version.", side: "top" },
];

/** Below this many checked test screenshots the accuracy numbers are shaky. */
const MIN_TEST = 3;

function usable(s: TrainingSampleRow) {
  return s.verified && !s.excluded;
}

function Counts({ samples }: { samples: TrainingSampleRow[] }) {
  const cell = (kind: TrainingSampleRow["kind"], split: TrainingSampleRow["split"]) => samples.filter((s) => s.kind === kind && s.split === split).length;
  const rows: [string, TrainingSampleRow["kind"]][] = [
    ["Team lists", "SLOT_LIST"],
    ["Results", "RESULTS"],
  ];
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th className="py-1.5 font-medium">Checked samples</th>
          <th className="py-1.5 text-right font-medium">
            <span className="inline-flex items-center gap-1"><Sparkles className="size-3" />Training</span>
          </th>
          <th className="py-1.5 text-right font-medium">
            <span className="inline-flex items-center gap-1"><FlaskConical className="size-3" />Test</span>
          </th>
        </tr>
      </thead>
      <tbody className="font-display text-base font-bold tabular-nums">
        {rows.map(([label, kind]) => (
          <tr key={kind} className="border-t">
            <td className="py-1.5 font-sans text-sm font-medium">{label}</td>
            <td className="py-1.5 text-right">{cell(kind, "TRAIN")}</td>
            <td className={cn("py-1.5 text-right", cell(kind, "TEST") === 0 && "text-warning-foreground dark:text-warning")}>{cell(kind, "TEST")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TrainDialog({ open, onOpenChange, models, activeVersion }: { open: boolean; onOpenChange: (o: boolean) => void; models: ModelVersion[]; activeVersion: string | undefined }) {
  const samples = useSamples();
  const start = useStartRun();
  const ready = models.filter((m) => m.status === "READY");
  const [base, setBase] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [autoActivate, setAutoActivate] = useState(false);
  useEffect(() => {
    if (open) {
      setBase(activeVersion ?? ready[0]?.version ?? "");
      setNotes("");
      setAutoActivate(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const all = samples.data?.items ?? [];
  const use = all.filter(usable);
  const test = use.filter((s) => s.split === "TEST").length;
  const train = use.length - test;
  const unchecked = all.filter((s) => !s.verified && !s.excluded).length;
  const names = use.reduce((a, s) => a + s.nameCount, 0);

  const submit = async () => {
    try {
      await start.mutateAsync({ baseVersion: base || undefined, notes: notes.trim() || undefined, autoActivate });
      toast.success("Training started", { description: "This page updates by itself while it runs." });
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !start.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-2xl">
            <GraduationCap className="size-5 text-primary" /> Train a new version
          </DialogTitle>
          <DialogDescription>
            The new version starts from <strong className="text-foreground">{base || "the active version"}</strong> and keeps everything it already knows, then learns from every <strong className="text-foreground">checked</strong> sample that's in use. When it's done, it's tested on the test screenshots so you can see if it got better.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="rounded-xl border bg-muted/30 p-3">
            {samples.isPending ? <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /> : <Counts samples={use} />}
            <p className="mt-2 text-xs text-muted-foreground">
              {use.length} samples · {names} names will be used.
              {unchecked > 0 && (
                <>
                  {" "}
                  {unchecked} more {unchecked === 1 ? "is" : "are"} waiting to be checked —{" "}
                  <Link to="/training/samples?status=unverified" className="font-medium text-primary hover:underline" onClick={() => onOpenChange(false)}>
                    check them first
                  </Link>{" "}
                  to train on more.
                </>
              )}
            </p>
          </div>

          {!samples.isPending && use.length === 0 && (
            <div className="flex gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <XCircle className="mt-0.5 size-4 shrink-0" />
              No checked samples yet. Open a few samples, fix the labels and mark them checked.
            </div>
          )}
          {!samples.isPending && use.length > 0 && train === 0 && (
            <div className="flex gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
              All checked samples are test samples, so there's nothing new to learn from. Move some to Training.
            </div>
          )}
          {!samples.isPending && use.length > 0 && test < MIN_TEST && (
            <div className="flex gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
              <span>
                Only {test} checked test {test === 1 ? "screenshot" : "screenshots"}. Accuracy numbers will be rough — aim for at least {MIN_TEST}, with both team lists and results.
              </span>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="base-version">Start from</Label>
            <Select value={base} onValueChange={setBase}>
              <SelectTrigger id="base-version" className="w-full">
                <SelectValue placeholder="Active version" />
              </SelectTrigger>
              <SelectContent>
                {ready.map((m) => (
                  <SelectItem key={m.version} value={m.version}>
                    {m.version}
                    {m.active ? " — active (recommended)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Usually the active version. Pick an older one only to retry from before a bad run.</p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="run-notes">Notes (optional)</Label>
            <Textarea id="run-notes" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Added 12 results screenshots from Sunday scrims" className="min-h-16" />
          </div>

          <div className="flex items-start justify-between gap-4 rounded-xl border p-3">
            <Label htmlFor="auto-activate" className="flex-col items-start gap-0.5">
              <span>Switch to it automatically if it's better</span>
              <span className="text-xs font-normal text-muted-foreground">Only if it reads more names exactly right on the test screenshots. Otherwise you decide on the Models tab.</span>
            </Label>
            <Switch id="auto-activate" checked={autoActivate} onCheckedChange={setAutoActivate} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={start.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={start.isPending || samples.isPending || use.length === 0 || !ready.length} className="shadow-glow">
            {start.isPending ? <Loader2 className="animate-spin" /> : <GraduationCap />} Start training
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LogTail({ lines, live }: { lines: string[]; live: boolean }) {
  const [open, setOpen] = useState(live);
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (open && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines, open]);
  if (!lines.length) return null;
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Terminal className="size-3.5" /> {open ? "Hide" : "Show"} log
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <pre ref={ref} className="mt-2 max-h-56 overflow-auto rounded-lg border bg-muted/50 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground" aria-live={live ? "polite" : undefined}>
          {lines.join("\n")}
        </pre>
      )}
    </div>
  );
}

function RunCard({ run, index }: { run: TrainingRun; index: number }) {
  const live = run.status === "QUEUED" || run.status === "RUNNING";
  const pct = Math.round(Math.min(1, Math.max(0, run.progress > 1 ? run.progress / 100 : run.progress)) * 100);
  const took = duration(run.startedAt, run.finishedAt);
  const better = metricGain(run.metricsBefore, run.metricsAfter, "nameExact");
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 10) * 0.03 }}
      className={cn("rounded-xl border bg-card p-4 shadow-sm", live && "border-info/40", run.status === "FAILED" && "border-destructive/30")}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-xl font-bold">
              {run.baseVersion} <ArrowRight className="inline size-4 text-muted-foreground" />{" "}
              {run.resultVersion ? (
                <Link to="/training/models" className="text-primary hover:underline">
                  {run.resultVersion}
                </Link>
              ) : (
                <span className="text-muted-foreground">{live ? "new version" : "—"}</span>
              )}
            </span>
            <RunStatusPill status={run.status} />
            {run.status === "SUCCEEDED" && better !== null && (better > 0.0005 ? <span className="text-xs font-semibold text-success">Reads better</span> : better < -0.0005 ? <span className="text-xs font-semibold text-destructive">Reads worse — keep the old one</span> : <span className="text-xs text-muted-foreground">About the same</span>)}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span>{run.sampleCount} samples</span>
            <span title={run.createdAt}>Started {relativeTime(run.startedAt ?? run.createdAt)}</span>
            {took && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" /> {live ? `running ${took}` : `took ${took}`}
              </span>
            )}
          </div>
        </div>
      </div>

      {live && (
        <div className="mt-3 flex items-center gap-3">
          <Progress value={run.status === "QUEUED" ? 0 : pct} className="flex-1" aria-label="Training progress" />
          <span className="w-10 text-right text-sm font-semibold tabular-nums">{run.status === "QUEUED" ? "…" : `${pct}%`}</span>
        </div>
      )}

      {run.error && (
        <div className="mt-3 flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <XCircle className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 break-words">{run.error}</span>
        </div>
      )}

      {(run.metricsBefore || run.metricsAfter) && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {METRICS.filter((m) => m.key !== "rankAccuracy").map((m) => (
            <div key={m.key} className="rounded-lg border bg-muted/30 p-2.5">
              <div className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{m.label}</div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 font-display text-base font-bold">
                <MetricText metrics={run.metricsBefore} k={m.key} className="text-muted-foreground" />
                <ArrowRight className="size-3 self-center text-muted-foreground" />
                <MetricText metrics={run.metricsAfter} k={m.key} />
              </div>
              <MetricDelta gain={metricGain(run.metricsBefore, run.metricsAfter, m.key)} className="mt-1" />
            </div>
          ))}
        </div>
      )}

      <LogTail lines={run.logTail} live={live} />
    </motion.li>
  );
}

export default function RunsPage() {
  usePageTour("admin.training.runs", TOUR);
  const runs = useRuns();
  const models = useModels();
  const status = useExtractorStatus();
  const [open, setOpen] = useState(false);
  const items = useMemo(() => [...(runs.data?.items ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [runs.data]);
  const live = items.some((r) => r.status === "QUEUED" || r.status === "RUNNING");

  const trainBtn = (
    <Button size="lg" onClick={() => setOpen(true)} disabled={live || models.isPending || runs.offline} data-tour="train-btn" className="shadow-glow">
      {live ? <Loader2 className="animate-spin" /> : <GraduationCap />} {live ? "Training in progress" : "Train new version"}
    </Button>
  );

  let body: ReactNode;
  if (runs.offline)
    body = (
      <EmptyState
        icon={<PlugZap />}
        title="The screenshot reader is offline"
        description={OFFLINE_TEXT}
        action={
          <Button variant="outline" onClick={() => status.refetch()}>
            <RefreshCw /> Check again
          </Button>
        }
      />
    );
  else if (runs.isPending) body = <ListSkeleton rows={3} />;
  else if (runs.isError)
    body = (
      <EmptyState
        icon={<AlertTriangle />}
        title="Couldn't load training runs"
        description={errorMessage(runs.error)}
        action={
          <Button variant="outline" onClick={() => runs.refetch()}>
            <RefreshCw /> Try again
          </Button>
        }
      />
    );
  else if (!items.length)
    body = (
      <EmptyState
        icon={<GraduationCap />}
        title="No training runs yet"
        description="Check some samples first, then train. The new version starts from the one in use, so it only gets better at what you've corrected."
        action={trainBtn}
      />
    );
  else
    body = (
      <ul className="grid gap-3" data-tour="run-list">
        {items.map((r, i) => (
          <RunCard key={r.id} run={r} index={i} />
        ))}
      </ul>
    );

  return (
    <>
      <TrainingHeader actions={trainBtn} />
      {live && (
        <p className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Info className="size-4 text-info" /> Training runs in the background — you can leave this page. Only one run at a time.
        </p>
      )}
      {body}
      <TrainDialog open={open} onOpenChange={setOpen} models={models.data?.items ?? []} activeVersion={models.data?.active} />
    </>
  );
}
