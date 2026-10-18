import { useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { motion } from "framer-motion";
import {
  BadgeCheck,
  Ban,
  CircleDashed,
  Cpu,
  FileImage,
  FlaskConical,
  Hash,
  Images,
  ListOrdered,
  PlugZap,
  RefreshCw,
  Sparkles,
  Type,
} from "lucide-react";
import { SCREENSHOT_KIND_LABELS, type SampleSplit, type ScreenshotKind } from "@7xen/shared";
import { PageHeader, StatCard } from "@7xen/ui/components/brand/page";
import { Pill } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@7xen/ui/components/ui/tooltip";
import { cn } from "@7xen/ui/lib/utils";
import { errorMessage } from "@/lib/forms";
import { useExtractorStatus, useSamples, sampleImageUrl } from "./api";
import { SPLIT_HINTS, SPLIT_LABELS } from "./format";

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
// ---------- sample stats ----------
/** Counts for the labelled test set (screenshots with known right answers, used to check the reader). */
function SampleStats() {
  const samples = useSamples();
  if (samples.isPending)
    return (
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[124px] rounded-xl" />
        ))}
      </div>
    );
  const items = samples.data?.items ?? [];
  const used = items.filter((x) => !x.excluded);
  const checked = used.filter((x) => x.verified).length;
  const unchecked = used.length - checked;
  const names = used.reduce((n, x) => n + x.nameCount, 0);
  const err = samples.isError ? "Couldn't load samples" : null;
  const cards: { label: string; value: number; hint: string; tone: "brand" | "info" | "success" | "warning"; icon: ReactNode }[] = [
    { label: "Samples", value: used.length, hint: err ?? "Screenshots in the test set", tone: "brand", icon: <Images /> },
    { label: "Checked", value: checked, hint: err ?? "Labels confirmed by a person", tone: "success", icon: <BadgeCheck /> },
    { label: "Need checking", value: unchecked, hint: err ?? "Open them and fix what the reader got wrong", tone: "warning", icon: <CircleDashed /> },
    { label: "Player names", value: names, hint: err ?? "Names labelled across all samples", tone: "info", icon: <Type /> },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" data-tour="training-metrics">
      {cards.map((c, i) => (
        <motion.div key={c.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i, duration: 0.3 }}>
          <StatCard className="h-full" label={c.label} tone={c.tone} icon={c.icon} value={<span className="tabular-nums">{c.value}</span>} hint={c.hint} />
        </motion.div>
      ))}
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

function ExtractorStatusCard({ className }: { className?: string }) {
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
              <h2 className="font-display text-xl font-bold">Screenshot reader · Claude</h2>
              {online ? <Pill tone="success">Online</Pill> : <Pill tone="danger">Offline</Pill>}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {status.isError
                ? `Couldn't check the reader. ${errorMessage(status.error)}`
                : online
                  ? "Reading screenshots normally. Uploads from managers are read automatically."
                  : <>Claude CLI not found or not logged in — run <code className="rounded bg-muted px-1 font-mono text-xs">claude</code> on the server once to log in. Managers can still type results by hand.</>}
            </p>
          </div>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:w-[26rem]">
          <Fact label="Model" value={s?.activeModel ?? "—"} ok={!!s?.activeModel} />
          <Fact label="Claude CLI" value={online ? (s?.serviceVersion?.replace(/\s*\(Claude Code\)\s*$/, "") || "Ready") : "Not found"} ok={online} />
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
] as const;

function TrainingTabs() {
  const samples = useSamples();
  const unverified = samples.data?.items.filter((s) => !s.verified && !s.excluded).length ?? 0;
  const counts: Record<string, ReactNode> = {
    "/training/samples": unverified ? <span className="rounded-full bg-warning/20 px-1.5 text-[11px] font-bold text-warning-foreground dark:text-warning">{unverified}</span> : null,
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

/** Header for the training pages: title, reader status, sample counts, tabs. */
export function TrainingHeader({ actions, description }: { actions?: ReactNode; description?: ReactNode }) {
  return (
    <>
      <PageHeader
        eyebrow="Training center"
        title="Check the screenshot reader"
        description={description ?? "A labelled test set of BGMI screenshots with the right answers, for checking how accurately Claude reads them."}
        actions={actions}
      />
      <div className="mb-6 space-y-4">
        <ExtractorStatusCard />
        <SampleStats />
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
