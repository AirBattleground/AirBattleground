import type { SampleSource, SampleSplit } from "@7xen/shared";

export const SOURCE_LABELS: Record<SampleSource, string> = {
  ADMIN_UPLOAD: "Uploaded by admin",
  MANAGER_CORRECTION: "Checked by a manager",
  SEED: "Starter sample",
};
export const SPLIT_LABELS: Record<SampleSplit, string> = { TRAIN: "Training", TEST: "Test" };
export const SPLIT_HINTS: Record<SampleSplit, string> = {
  TRAIN: "A general labelled example",
  TEST: "Used to measure how accurately the reader reads",
};
