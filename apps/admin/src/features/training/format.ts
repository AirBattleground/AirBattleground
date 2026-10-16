import type { EvalMetrics, SampleSource, SampleSplit, TrainingRunStatus } from "@7xen/shared";

export const pct = (x: number | null | undefined, digits = 1) => (x === null || x === undefined || Number.isNaN(x) ? null : `${(x * 100).toFixed(digits)}%`);

export const SOURCE_LABELS: Record<SampleSource, string> = {
  ADMIN_UPLOAD: "Uploaded by admin",
  MANAGER_CORRECTION: "Checked by a manager",
  SEED: "Starter sample",
};
export const SPLIT_LABELS: Record<SampleSplit, string> = { TRAIN: "Training", TEST: "Test" };
export const SPLIT_HINTS: Record<SampleSplit, string> = {
  TRAIN: "The model learns from it",
  TEST: "Kept aside to measure accuracy honestly",
};
export const RUN_STATUS_LABELS: Record<TrainingRunStatus, string> = {
  QUEUED: "Waiting to start",
  RUNNING: "Training…",
  SUCCEEDED: "Finished",
  FAILED: "Failed",
};

export type MetricKey = "nameExact" | "slotAccuracy" | "killsAccuracy" | "rankAccuracy" | "cer";
export const METRICS: { key: MetricKey; label: string; hint: string; lowerIsBetter?: boolean }[] = [
  { key: "nameExact", label: "Names read exactly right", hint: "Player names with every character correct" },
  { key: "slotAccuracy", label: "Slot numbers right", hint: "Team list screenshots" },
  { key: "killsAccuracy", label: "Finishes right", hint: "Results screenshots" },
  { key: "rankAccuracy", label: "Ranks right", hint: "Results screenshots" },
  { key: "cer", label: "Wrong letters", hint: "Share of characters read wrong — lower is better", lowerIsBetter: true },
];

export const metricValue = (m: EvalMetrics | null | undefined, k: MetricKey): number | null => (m ? (m[k] ?? null) : null);

/** Positive = better. Null when either side wasn't measured. */
export function metricGain(before: EvalMetrics | null | undefined, after: EvalMetrics | null | undefined, k: MetricKey): number | null {
  const a = metricValue(before, k);
  const b = metricValue(after, k);
  if (a === null || b === null) return null;
  const lower = METRICS.find((m) => m.key === k)?.lowerIsBetter;
  return lower ? a - b : b - a;
}

/** "12s", "3m 20s", "1h 4m" */
export function duration(fromIso: string | null, toIso: string | null = null): string | null {
  if (!fromIso) return null;
  const ms = (toIso ? Date.parse(toIso) : Date.now()) - Date.parse(fromIso);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
