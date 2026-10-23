/**
 * Matching a name read from a screenshot to a registered player's IGN.
 *
 * Both names are normalised first (case, spaces, clan-tag separators, OCR lookalikes), then compared by edit distance.
 * A name links only when exactly one candidate reaches IGN_MATCH_THRESHOLD — two near-identical roster names never
 * guess. Used by the API when linking a published match's player rows to accounts (same team roster only).
 */

/** Similarity (0–1) a read name needs to link to a roster IGN. */
export const IGN_MATCH_THRESHOLD = 0.95;

// clan-tag separators players put between tag and name (all dropped)
const SEPARATORS = /[\s•·・‧∙⋅●◦|｜/\\.,:;_\-–—~'"`´＿《》〈〉「」『』【】()[\]{}<>]/gu;
// OCR lookalikes, mapped to one form
const LOOKALIKES: [RegExp, string][] = [
  [/rn/g, "m"],
  [/[0ο]/g, "o"],
  [/[1il!ı]/g, "l"],
  [/5/g, "s"],
  [/8/g, "b"],
];

/** The form two names are compared in. */
export function normalizeIgn(name: string): string {
  let s = name.normalize("NFKC").toLowerCase().replace(SEPARATORS, "");
  for (const [re, to] of LOOKALIKES) s = s.replace(re, to);
  return s;
}

function editDistance(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[y.length]!;
}

/** 0–1: 1 = the same after normalising. */
export function ignSimilarity(a: string, b: string): number {
  const na = normalizeIgn(a);
  const nb = normalizeIgn(b);
  if (!na || !nb) return 0;
  const len = Math.max([...na].length, [...nb].length);
  return 1 - editDistance(na, nb) / len;
}

/** The one candidate whose IGN matches `name`, or null when none (or more than one) reaches the threshold. */
export function matchIgn<T extends { ign: string }>(name: string, candidates: readonly T[]): T | null {
  const hits = candidates.filter((c) => ignSimilarity(name, c.ign) >= IGN_MATCH_THRESHOLD);
  return hits.length === 1 ? hits[0]! : null;
}
