import { useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowDownRight,
  ArrowUpRight,
  BadgeCheck,
  Ban,
  Boxes,
  CheckCircle2,
  CircleDashed,
  Cpu,
  Crosshair,
  FileImage,
  FlaskConical,
  Hash,
  Images,
  ListOrdered,
  Loader2,
  Minus,
  PlugZap,
  RefreshCw,
  ScanText,
  Sparkles,
  Type,
  XCircle,
} from "lucide-react";
import { SCREENSHOT_KIND_LABELS, type EvalMetrics, type SampleSource, type SampleSplit, type ScreenshotKind, type TrainingRunStatus } from "@7xen/shared";
import { PageHeader, StatCard } from "@7xen/ui/components/brand/page";
import { Pill } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@7xen/ui/components/ui/tooltip";
import { cn } from "@7xen/ui/lib/utils";
import { errorMessage } from "@/lib/forms";
import { useExtractorStatus, useModels, useRuns, useSamples, sampleImageUrl } from "./api";
import { METRICS, RUN_STATUS_LABELS, SOURCE_LABELS, SPLIT_HINTS, SPLIT_LABELS, metricValue, pct, type MetricKey } from "./format";

// ---------- pills ----------
export function KindPill({ kind, className }: { kind: ScreenshotKind; className?: string }) {
  return (
    <Pill tone={kind === "SLOT_LIST" ? "info" : "brand"} icon={kind === "SLOT_LIST" ? <Hash className="size-3" /> : <ListOrdered className="size-3" />} className={className}>
      {SCREENSHOT_KIND_LABELS[kind]}
    </Pill>
  );
}
export function SplitPill({ split }: { split: SampleSplit }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <Pill tone="neutral" icon={split === "TEST" ? <FlaskConical className="size-3" /> : <Sparkles className="size-3" />}>
            {SPLIT_LABELS[split]}
          </Pill>
        </span>
      </TooltipTrigger>
      <TooltipContent>{SPLIT_HINTS[split]}</TooltipContent>
    </Tooltip>
  );
}
export function SourceText({ source }: { source: SampleSource }) {
  return <span>{SOURCE_LABELS[source]}</span>;
}
export function VerifiedPill({ verified, excluded }: { verified: boolean; excluded?: boolean }) {
  if (excluded)
    return (
      <Pill tone="neutral" icon={<Ban className="size-3" />}>
        Not used
      </Pill>
    );
  return verified ? (
    <Pill tone="success" icon={<BadgeCheck className="size-3" />}>
      Checked
    </Pill>
  ) : (
    <Pill tone="warning" icon={<CircleDashed className="size-3" />}>
      Needs checking
    </Pill>
  );
}
export function RunStatusPill({ status }: { status: TrainingRunStatus }) {
  const meta: Record<TrainingRunStatus, { tone: "neutral" | "info" | "success" | "danger"; icon: ReactNode }> = {
    QUEUED: { tone: "neutral", icon: <CircleDashed className="size-3" /> },
    RUNNING: { tone: "info", icon: <Loader2 className="size-3 animate-spin" /> },
    SUCCEEDED: { tone: "success", icon: <CheckCircle2 className="size-3" /> },
    FAILED: { tone: "danger", icon: <XCircle className="size-3" /> },
  };
  return (
    <Pill tone={meta[status].tone} icon={meta[status].icon}>
      {RUN_STATUS_LABELS[status]}
    </Pill>
  );
}

// ---------- metrics ----------
/** Coloured change in percentage points, arrow up = better. */
export function MetricDelta({ gain, className }: { gain: number | null; className?: string }) {
  if (gain === null) return null;
  const pts = gain * 100;
  const flat = Math.abs(pts) < 0.05;
  const better = pts > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums",
        flat ? "bg-muted text-muted-foreground" : better ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
        className,
      )}
      aria-label={flat ? "No change" : `${better ? "Better" : "Worse"} by ${Math.abs(pts).toFixed(1)} points`}
    >
      {flat ? <Minus className="size-3" /> : better ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
      {flat ? "same" : `${Math.abs(pts).toFixed(1)} pts`}
    </span>
  );
}

export function MetricText({ metrics, k, className }: { metrics: EvalMetrics | null | undefined; k: MetricKey; className?: string }) {
  const v = pct(metricValue(metrics, k));
  return v ? <span className={cn("tabular-nums", className)}>{v}</span> : <span className={cn("text-xs font-normal text-muted-foreground", className)}>Not measured</span>;
}

const STAT_ICONS: Record<MetricKey, ReactNode> = {
  nameExact: <Type />,
  slotAccuracy: <Hash />,
  killsAccuracy: <Crosshair />,
  rankAccuracy: <ListOrdered />,
  cer: <ScanText />,
};

/** Stat cards for the active model ("Not measured yet" instead of made-up numbers). */
export function ActiveModelStats() {
  const models = useModels();
  if (models.isPending && !models.offline)
    return (
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[124px] rounded-xl" />
        ))}
      </div>
    );
  const active = models.data?.items.find((m) => m.active) ?? null;
  const metrics = active?.metrics ?? null;
  const shown = METRICS.filter((m) => m.key !== "rankAccuracy");
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" data-tour="training-metrics">
      {shown.map((m, i) => {
        const v = pct(metricValue(metrics, m.key));
        return (
          <motion.div key={m.key} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i, duration: 0.3 }}>
            <StatCard
              className="h-full"
              label={m.label}
              tone={m.key === "cer" ? "warning" : i === 0 ? "brand" : i === 1 ? "info" : "success"}
              icon={STAT_ICONS[m.key]}
              value={v ?? <span className="block text-base leading-tight text-muted-foreground sm:text-xl">Not measured yet</span>}
              hint={
                models.offline
                  ? "Reader is offline"
                  : models.isError
                  ? "Couldn't load models"
                  : !active
                    ? "No model is active yet"
                    : metrics
                      ? `${m.hint} · ${metrics.images} test screenshots`
                      : `Train a version to measure ${active.version}`
              }
            />
          </motion.div>
        );
      })}
    </div>
  );
}

// ---------- extractor status ----------
function Fact({ label, value, ok }: { label: string; value: ReactNode; ok?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</div>
      <div className={cn("mt-0.5 truncate font-display text-lg font-bold", ok === false && "text-muted-foreground")}>{value}</div>
    </div>
  );
}

export function ExtractorStatusCard({ className }: { className?: string }) {
  const status = useExtractorStatus();
  if (status.isPending) return <Skeleton className={cn("h-[124px] rounded-xl", className)} />;
  const s = status.data;
  const online = !!s?.online;
  return (
    <section
      data-tour="extractor-status"
      className={cn("relative overflow-hidden rounded-xl border bg-card p-5 shadow-sm", online ? "border-success/30" : "border-destructive/30", className)}
      aria-live="polite"
    >
      <div className={cn("pointer-events-none absolute -top-16 -left-16 size-44 rounded-full bg-gradient-to-br to-transparent blur-2xl", online ? "from-success/20" : "from-destructive/20")} />
      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className={cn("relative mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-xl", online ? "bg-success/15 text-success" : "bg-destructive/10 text-destructive")}>
            {online ? <Cpu className="size-5" /> : <PlugZap className="size-5" />}
            {online && <span className="absolute -top-0.5 -right-0.5 size-3 animate-pulse rounded-full border-2 border-card bg-success" aria-hidden />}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-xl font-bold">Screenshot reader</h2>
              {online ? <Pill tone="success">Online</Pill> : <Pill tone="danger">Offline</Pill>}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {status.isError
                ? `Couldn't check the reader. ${errorMessage(status.error)}`
                : online
                  ? s?.ocrReady
                    ? "Reading screenshots normally. Uploads from managers are read automatically."
                    : "Running, but the text reader is still loading. Screenshots wait in the queue until it's ready."
                  : "The reader service isn't reachable. Managers can still type results by hand; training and \"read with model\" won't work until it's back."}
            </p>
          </div>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 lg:w-[30rem]">
          <Fact label="Active model" value={s?.activeModel ?? "—"} ok={!!s?.activeModel} />
          <Fact label="Text reader" value={online ? (s?.ocrReady ? "Ready" : "Loading") : "—"} ok={online && !!s?.ocrReady} />
          <Fact label="AI fallback" value={s?.vlmEnabled ? "On" : "Off"} ok={!!s?.vlmEnabled} />
          <Fact
            label="Queue"
            value={
              <span className="tabular-nums">
                {(s?.queue.queued ?? 0) + (s?.queue.processing ?? 0)}
                {!!s?.queue.failedLast24h && <span className="ml-1.5 text-xs font-semibold text-destructive">{s.queue.failedLast24h} failed</span>}
              </span>
            }
          />
        </div>
        {status.isError && (
          <Button variant="outline" size="sm" onClick={() => status.refetch()} className="self-start">
            <RefreshCw /> Retry
          </Button>
        )}
      </div>
    </section>
  );
}

// ---------- section header + sub-navigation ----------
const TABS = [
  { to: "/training/samples", label: "Samples", icon: Images, tour: "tab-samples" },
  { to: "/training/models", label: "Models", icon: Boxes, tour: "tab-models" },
  { to: "/training/runs", label: "Training runs", icon: Sparkles, tour: "tab-runs" },
] as const;

export function TrainingTabs() {
  const samples = useSamples();
  const runs = useRuns();
  const models = useModels();
  const unverified = samples.data?.items.filter((s) => !s.verified && !s.excluded).length ?? 0;
  const live = runs.data?.items.filter((r) => r.status === "QUEUED" || r.status === "RUNNING").length ?? 0;
  const counts: Record<string, ReactNode> = {
    "/training/samples": unverified ? <span className="rounded-full bg-warning/20 px-1.5 text-[11px] font-bold text-warning-foreground dark:text-warning">{unverified}</span> : null,
    "/training/models": models.data ? <span className="text-xs text-muted-foreground">{models.data.items.length}</span> : null,
    "/training/runs": live ? <Loader2 className="size-3.5 animate-spin text-info" aria-label="Training in progress" /> : null,
  };
  return (
    <nav aria-label="Training center" className="mb-6 flex gap-1 overflow-x-auto border-b">
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
              {counts[to]}
              {isActive && <motion.span layoutId="training-tab" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary shadow-glow" />}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

/** Header shared by the Samples / Models / Runs pages: title, reader status, active model accuracy, tabs. */
export function TrainingHeader({ actions, description }: { actions?: ReactNode; description?: ReactNode }) {
  return (
    <>
      <PageHeader
        eyebrow="Training center"
        title="Teach the screenshot reader"
        description={description ?? "Check what the reader got wrong, train a new version from your corrections, and switch versions when one reads better."}
        actions={actions}
      />
      <div className="mb-6 space-y-4">
        <ExtractorStatusCard />
        <ActiveModelStats />
        <p className="text-xs text-muted-foreground">Accuracy is measured on test screenshots the model never learned from, so the numbers are honest.</p>
      </div>
      <TrainingTabs />
    </>
  );
}

// ---------- thumbnail ----------
export function SampleThumb({ id, alt, className }: { id: string; alt: string; className?: string }) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  return (
    <div className={cn("relative aspect-[20/9] overflow-hidden bg-muted", className)}>
      {state === "loading" && <Skeleton className="absolute inset-0 rounded-none" />}
      {state === "error" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
          <FileImage className="size-6" />
          Image unavailable
        </div>
      ) : (
        <img
          src={sampleImageUrl(id)}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setState("ok")}
          onError={() => setState("error")}
          className={cn("size-full object-cover transition-opacity duration-300", state === "ok" ? "opacity-100" : "opacity-0")}
        />
      )}
    </div>
  );
}
