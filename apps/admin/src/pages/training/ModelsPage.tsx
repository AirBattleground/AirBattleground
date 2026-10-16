import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Boxes, CheckCircle2, GitBranch, History, Loader2, PlugZap, RefreshCw, Rocket, Sparkles, XCircle, Zap } from "lucide-react";
import { toast } from "sonner";
import type { ModelVersion } from "@7xen/shared";
import { EmptyState } from "@7xen/ui/components/brand/page";
import { Pill } from "@7xen/ui/components/brand/status";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@7xen/ui/components/ui/select";
import { cn } from "@7xen/ui/lib/utils";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { ListSkeleton } from "@/components/ListSkeleton";
import { useExtractorStatus } from "@/features/training/api";
import { useActivateModel, useModels } from "@/features/training/api";
import { MetricDelta, MetricText, TrainingHeader } from "@/features/training/components";
import { METRICS, metricGain } from "@/features/training/format";
import { errorMessage } from "@/lib/forms";
import { relativeTime, shortDate } from "@/lib/format";

const OFFLINE_TEXT = "Model versions live inside the reader service, so they show up once it’s back online. Samples still work — keep checking them.";

const TOUR: TourStep[] = [
  { title: "Model versions", description: "Every training run makes a new version that starts from an older one. v0 is the starting model." },
  { element: '[data-tour="model-tree"]', title: "Family tree", description: "Each version shows which version it was trained from, how many samples it learned from, and its accuracy on test screenshots.", side: "top" },
  { element: '[data-tour="model-active"]', title: "The active version", description: "This is the one reading managers' screenshots right now.", side: "bottom" },
  { element: '[data-tour="model-compare"]', title: "Compare", description: "Pick two versions to see which reads better. Green arrows mean better.", side: "top" },
  { element: '[data-tour="model-activate"]', title: "Switch versions", description: "Activate a better version — or roll back to an older one any time. Nothing is deleted.", side: "left" },
];

const TRAINER_LABELS: Record<string, string> = {
  base: "Starting model",
  adaptive: "Quick learner (names + layout)",
  paddle_finetune: "Deep fine-tune (text reader)",
};
const trainerLabel = (t: string) => TRAINER_LABELS[t] ?? t;

/** Depth-first order with depth, so children sit under their parent. */
function lineage(items: ModelVersion[]) {
  const byParent = new Map<string | null, ModelVersion[]>();
  const known = new Set(items.map((m) => m.version));
  for (const m of items) {
    const p = m.parent && known.has(m.parent) ? m.parent : null;
    byParent.set(p, [...(byParent.get(p) ?? []), m]);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const out: { m: ModelVersion; depth: number; last: boolean }[] = [];
  const walk = (parent: string | null, depth: number) => {
    const kids = byParent.get(parent) ?? [];
    kids.forEach((m, i) => {
      out.push({ m, depth, last: i === kids.length - 1 });
      // a straight chain (one child) stays at the same depth so the list reads like a timeline
      walk(m.version, kids.length > 1 || (byParent.get(m.version)?.length ?? 0) > 1 ? depth + 1 : depth);
    });
  };
  walk(null, 0);
  return out;
}

function StatusPill({ m }: { m: ModelVersion }) {
  if (m.active)
    return (
      <Pill tone="brand" icon={<Zap className="size-3" />}>
        Active
      </Pill>
    );
  if (m.status === "TRAINING")
    return (
      <Pill tone="info" icon={<Loader2 className="size-3 animate-spin" />}>
        Training
      </Pill>
    );
  if (m.status === "FAILED")
    return (
      <Pill tone="danger" icon={<XCircle className="size-3" />}>
        Failed
      </Pill>
    );
  return (
    <Pill tone="neutral" icon={<CheckCircle2 className="size-3" />}>
      Ready
    </Pill>
  );
}

function VersionRow({ m, depth, parent, onActivate, index, tourActivate }: { m: ModelVersion; depth: number; parent: ModelVersion | undefined; onActivate: () => void; index: number; tourActivate?: boolean }) {
  return (
    <motion.li
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: Math.min(index, 10) * 0.04 }}
      className="relative"
      style={{ paddingLeft: `${depth * 1.5}rem` }}
    >
      {/* timeline rail + dot */}
      <span className="absolute top-0 bottom-0 w-px bg-border" style={{ left: `calc(${depth * 1.5}rem + 1.1rem)` }} aria-hidden />
      <div
        data-tour={m.active ? "model-active" : undefined}
        className={cn("relative ml-9 rounded-xl border bg-card p-4 shadow-sm transition-colors", m.active && "border-primary/60 bg-gradient-to-r from-primary/10 to-card shadow-glow")}
      >
        <span
          className={cn("absolute top-5 -left-[1.95rem] flex size-5 items-center justify-center rounded-full border-2 bg-background", m.active ? "border-primary" : "border-border")}
          aria-hidden
        >
          <span className={cn("size-2 rounded-full", m.active ? "bg-primary" : m.status === "FAILED" ? "bg-destructive" : "bg-muted-foreground/50")} />
        </span>
        <div className="flex flex-col gap-3 md:flex-row md:items-start">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-2xl leading-none font-bold">{m.version}</h3>
              <StatusPill m={m} />
              {m.parent && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <GitBranch className="size-3.5" /> from <span className="font-semibold text-foreground">{m.parent}</span>
                </span>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              <span>{trainerLabel(m.trainer)}</span>
              <span>{m.sampleCount} samples</span>
              <span title={m.createdAt}>Made {shortDate(m.createdAt)} · {relativeTime(m.createdAt)}</span>
            </div>
            {m.notes && <p className="mt-1.5 text-sm text-muted-foreground">{m.notes}</p>}
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-4">
            {METRICS.filter((x) => x.key !== "rankAccuracy").map((x) => (
              <div key={x.key} className="min-w-[5.5rem]">
                <div className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{x.key === "nameExact" ? "Names" : x.key === "slotAccuracy" ? "Slots" : x.key === "killsAccuracy" ? "Finishes" : "Wrong letters"}</div>
                <div className="flex items-center gap-1 font-display text-lg font-bold">
                  <MetricText metrics={m.metrics} k={x.key} />
                </div>
                {parent && <MetricDelta gain={metricGain(parent.metrics, m.metrics, x.key)} />}
              </div>
            ))}
          </div>
          <div className="shrink-0 md:self-center">
            {m.active ? (
              <span className="text-xs font-semibold text-primary">In use now</span>
            ) : (
              <Button variant="outline" size="sm" onClick={onActivate} disabled={m.status !== "READY"} data-tour={tourActivate ? "model-activate" : undefined}>
                <Rocket /> Activate
              </Button>
            )}
          </div>
        </div>
      </div>
    </motion.li>
  );
}

function Compare({ items, active }: { items: ModelVersion[]; active: string }) {
  const sorted = [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const activeM = items.find((m) => m.version === active);
  const [a, setA] = useState(() => activeM?.parent ?? sorted.find((m) => m.version !== active)?.version ?? active);
  const [b, setB] = useState(() => {
    const newest = sorted[sorted.length - 1]?.version;
    return newest && newest !== a ? newest : active;
  });
  const A = items.find((m) => m.version === a);
  const B = items.find((m) => m.version === b);
  const pick = (value: string, set: (v: string) => void, label: string) => (
    <Select value={value} onValueChange={set}>
      <SelectTrigger aria-label={label} className="w-full bg-card sm:w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {sorted.map((m) => (
          <SelectItem key={m.version} value={m.version}>
            {m.version}
            {m.active ? " (active)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  return (
    <section className="rounded-xl border bg-card shadow-sm" data-tour="model-compare">
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center">
        <h2 className="font-display text-xl font-bold">Compare versions</h2>
        <div className="flex items-center gap-2 sm:ml-auto">
          {pick(a, setA, "First version")}
          <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
          {pick(b, setB, "Second version")}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-4 py-2 font-medium">Measured on test screenshots</th>
              <th className="px-4 py-2 text-right font-medium">{a}</th>
              <th className="px-4 py-2 text-right font-medium">{b}</th>
              <th className="px-4 py-2 text-right font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {METRICS.map((x) => (
              <tr key={x.key} className="border-b last:border-0">
                <td className="px-4 py-2.5">
                  <div className="font-medium">{x.label}</div>
                  <div className="text-xs text-muted-foreground">{x.hint}</div>
                </td>
                <td className="px-4 py-2.5 text-right font-display text-base font-bold">
                  <MetricText metrics={A?.metrics} k={x.key} />
                </td>
                <td className="px-4 py-2.5 text-right font-display text-base font-bold">
                  <MetricText metrics={B?.metrics} k={x.key} />
                </td>
                <td className="px-4 py-2.5 text-right">{a === b ? <span className="text-xs text-muted-foreground">same version</span> : <MetricDelta gain={metricGain(A?.metrics, B?.metrics, x.key)} />}</td>
              </tr>
            ))}
            <tr>
              <td className="px-4 py-2.5 text-xs text-muted-foreground">Test set</td>
              <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{A?.metrics ? `${A.metrics.images} screenshots · ${A.metrics.names} names` : "—"}</td>
              <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{B?.metrics ? `${B.metrics.images} screenshots · ${B.metrics.names} names` : "—"}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      {A?.metrics && B?.metrics && (A.metrics.images !== B.metrics.images || A.metrics.names !== B.metrics.names) && (
        <p className="flex items-center gap-1.5 border-t px-4 py-2 text-xs text-warning-foreground dark:text-warning">
          <AlertTriangle className="size-3.5" /> These were measured on different test sets, so the comparison is rough. A training run measures both on the same set.
        </p>
      )}
    </section>
  );
}

export default function ModelsPage() {
  usePageTour("admin.training.models", TOUR);
  const models = useModels();
  const status = useExtractorStatus();
  const activate = useActivateModel();
  const [target, setTarget] = useState<ModelVersion | null>(null);

  const items = models.data?.items ?? [];
  const rows = useMemo(() => lineage(items), [items]);
  const byVersion = useMemo(() => new Map(items.map((m) => [m.version, m])), [items]);
  const active = byVersion.get(models.data?.active ?? "");
  const firstInactive = rows.find((r) => !r.m.active && r.m.status === "READY")?.m.version;
  const isRollback = !!(target && active && target.createdAt < active.createdAt);

  let body: ReactNode;
  if (models.offline)
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
  else if (models.isPending) body = <ListSkeleton rows={3} />;
  else if (models.isError)
    body = (
      <EmptyState
        icon={<AlertTriangle />}
        title="Couldn't load model versions"
        description={`${errorMessage(models.error)} The screenshot reader may be offline.`}
        action={
          <Button variant="outline" onClick={() => models.refetch()}>
            <RefreshCw /> Try again
          </Button>
        }
      />
    );
  else if (!items.length)
    body = (
      <EmptyState
        icon={<Boxes />}
        title="No model versions yet"
        description="The reader hasn't registered its starting model. Check that the screenshot reader is online."
      />
    );
  else
    body = (
      <div className="space-y-6">
        <section>
          <div className="mb-3 flex items-center gap-2">
            <History className="size-4 text-primary" />
            <h2 className="font-display text-xl font-bold">Versions</h2>
            <span className="text-sm text-muted-foreground">oldest first · arrows compare with the version it came from</span>
          </div>
          <ol className="grid gap-3" data-tour="model-tree">
            {rows.map(({ m, depth }, i) => (
              <VersionRow key={m.version} m={m} depth={depth} index={i} parent={m.parent ? byVersion.get(m.parent) : undefined} onActivate={() => setTarget(m)} tourActivate={m.version === firstInactive} />
            ))}
          </ol>
        </section>
        {items.length > 1 ? (
          <Compare items={items} active={models.data!.active} />
        ) : (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-5 sm:flex-row sm:items-center">
            <Sparkles className="size-6 text-primary" />
            <div className="flex-1 text-sm text-muted-foreground">Only the starting model exists. Check some samples and run a training to make v1 — then you can compare them here.</div>
            <Button asChild variant="outline">
              <Link to="/training/runs">
                Go to training runs <ArrowRight />
              </Link>
            </Button>
          </div>
        )}
      </div>
    );

  return (
    <>
      <TrainingHeader />
      {body}
      <AlertDialog open={!!target} onOpenChange={(o) => !o && !activate.isPending && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl">
              {isRollback ? "Roll back to" : "Switch to"} {target?.version}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              From now on every new screenshot is read with {target?.version} instead of {active?.version ?? "the current version"}. Screenshots already read stay as they are. You can switch back any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {target && active && (
            <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
              {METRICS.filter((x) => x.key === "nameExact" || x.key === "cer").map((x) => (
                <div key={x.key}>
                  <div className="text-xs text-muted-foreground">{x.label}</div>
                  <div className="flex items-center gap-2 font-display text-lg font-bold">
                    <MetricText metrics={target.metrics} k={x.key} />
                    <MetricDelta gain={metricGain(active.metrics, target.metrics, x.key)} />
                  </div>
                </div>
              ))}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={activate.isPending}>Cancel</AlertDialogCancel>
            <Button
              disabled={activate.isPending}
              onClick={async () => {
                if (!target) return;
                try {
                  await activate.mutateAsync(target.version);
                  toast.success(`${target.version} is now reading screenshots`);
                  setTarget(null);
                } catch (e) {
                  toast.error(errorMessage(e));
                }
              }}
            >
              {activate.isPending ? <Loader2 className="animate-spin" /> : <Rocket />} {isRollback ? "Roll back" : "Activate"} {target?.version}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
