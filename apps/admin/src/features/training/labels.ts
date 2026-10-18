import type { ZodIssue } from "zod";
import {
  MAX_ROSTER_PLAYERS,
  resultsLabelsSchema,
  slotListLabelsSchema,
  type ExtractionResult,
  type ResultsLabels,
  type ScreenshotKind,
  type SlotListLabels,
} from "@7xen/shared";

/** Below this the model is unsure about a field → highlight it in amber. */
export const LOW_CONFIDENCE = 0.85;
export const MAX_NAME_LENGTH = 40;

let seq = 0;
const key = () => `k${++seq}`;

/** What the model read for a field (shown next to the input so the admin sees what was corrected). */
export interface OcrHint {
  text: string;
  confidence: number;
}
export interface PlayerDraft {
  key: string;
  name: string;
  /** RESULTS only — kept as text so the input can be empty while typing */
  kills: string;
  nameOcr?: OcrHint;
  killsOcr?: OcrHint;
}
/** A team card (SLOT_LIST, num = slot) or a rank block (RESULTS, num = rank). */
export interface GroupDraft {
  key: string;
  num: string;
  numOcr?: OcrHint;
  players: PlayerDraft[];
}
export interface LabelDraft {
  kind: ScreenshotKind;
  groups: GroupDraft[];
}

export const emptyPlayer = (): PlayerDraft => ({ key: key(), name: "", kills: "" });
export const emptyGroup = (num = ""): GroupDraft => ({ key: key(), num, players: [emptyPlayer(), emptyPlayer(), emptyPlayer(), emptyPlayer()] });

export function draftFromLabels(kind: ScreenshotKind, labels: SlotListLabels | ResultsLabels | null | undefined): LabelDraft {
  if (kind === "SLOT_LIST") {
    const teams = (labels as SlotListLabels | null)?.teams ?? [];
    return { kind, groups: teams.map((t) => ({ key: key(), num: String(t.slot), players: t.players.map((name) => ({ key: key(), name, kills: "" })) })) };
  }
  const rows = (labels as ResultsLabels | null)?.rows ?? [];
  return { kind, groups: rows.map((r) => ({ key: key(), num: String(r.rank), players: r.players.map((p) => ({ key: key(), name: p.name, kills: String(p.kills) })) })) };
}

const hint = (text: string | number | null | undefined, confidence: number): OcrHint | undefined =>
  text === null || text === undefined ? (confidence > 0 ? { text: "", confidence } : undefined) : { text: String(text), confidence };

/** Model output → editable draft, keeping every field's OCR text + confidence. */
export function draftFromExtraction(ex: ExtractionResult): LabelDraft {
  if (ex.kind === "SLOT_LIST") {
    return {
      kind: ex.kind,
      groups: ex.teams.map((t) => ({
        key: key(),
        num: t.slot === null ? "" : String(t.slot),
        numOcr: { text: t.slot === null ? "" : String(t.slot), confidence: t.slotConfidence },
        players: t.players.slice(0, MAX_ROSTER_PLAYERS).map((p) => ({ key: key(), name: p.name.slice(0, MAX_NAME_LENGTH), kills: "", nameOcr: { text: p.name, confidence: p.confidence } })),
      })),
    };
  }
  return {
    kind: ex.kind,
    groups: ex.rows.map((r) => ({
      key: key(),
      num: r.rank === null ? "" : String(r.rank),
      numOcr: { text: r.rank === null ? "" : String(r.rank), confidence: r.rankConfidence },
      players: r.players.slice(0, MAX_ROSTER_PLAYERS).map((p) => ({
        key: key(),
        name: p.name.slice(0, MAX_NAME_LENGTH),
        kills: p.kills === null ? "" : String(p.kills),
        nameOcr: { text: p.name, confidence: p.confidence },
        killsOcr: hint(p.kills, p.killsConfidence ?? 0),
      })),
    })),
  };
}

const toInt = (s: string) => (s.trim() === "" ? Number.NaN : Number(s.trim()));

/** Draft → labels object as typed (may be invalid; run validateDraft first). Empty player rows are dropped. */
export function labelsFromDraft(d: LabelDraft): SlotListLabels | ResultsLabels {
  const filled = (g: GroupDraft) => g.players.filter((p) => p.name.trim() !== "" || p.kills.trim() !== "");
  if (d.kind === "SLOT_LIST") return { teams: d.groups.map((g) => ({ slot: toInt(g.num), players: filled(g).map((p) => p.name.normalize("NFC")) })) };
  return { rows: d.groups.map((g) => ({ rank: toInt(g.num), players: filled(g).map((p) => ({ name: p.name.normalize("NFC"), kills: toInt(p.kills) })) })) };
}

/** Labels guaranteed to pass the schema: drops unusable groups/players. Used when saving model output that wasn't checked yet. */
export function safeLabelsFromDraft(d: LabelDraft): SlotListLabels | ResultsLabels {
  const okNum = (n: number) => Number.isInteger(n) && n >= 1 && n <= 100;
  const name = (s: string) => s.trim().normalize("NFC").slice(0, MAX_NAME_LENGTH);
  if (d.kind === "SLOT_LIST") {
    const teams = d.groups
      .map((g) => ({ slot: toInt(g.num), players: g.players.map((p) => name(p.name)).filter(Boolean).slice(0, MAX_ROSTER_PLAYERS) }))
      .filter((t) => okNum(t.slot) && t.players.length)
      .slice(0, 25);
    return { teams };
  }
  const rows = d.groups
    .map((g) => ({
      rank: toInt(g.num),
      players: g.players
        .filter((p) => name(p.name))
        .map((p) => {
          const k = toInt(p.kills);
          return { name: name(p.name), kills: Number.isInteger(k) && k >= 0 && k <= 99 ? k : 0 };
        })
        .slice(0, MAX_ROSTER_PLAYERS),
    }))
    .filter((r) => okNum(r.rank) && r.players.length)
    .slice(0, 25);
  return { rows };
}

// ---------- validation ----------
export interface DraftErrors {
  form: string[];
  /** keyed by group key */
  groups: Record<string, { num?: string; players?: string; warn?: string }>;
  /** keyed by player key */
  players: Record<string, { name?: string; kills?: string }>;
  count: number;
}

function friendly(issue: ZodIssue, field: "num" | "name" | "kills" | "players" | "groups", kind: ScreenshotKind): string {
  const what = kind === "SLOT_LIST" ? "slot" : "rank";
  if (field === "num") {
    if (issue.code === "invalid_type") return `Enter the ${what} number`;
    if (issue.code === "too_small" || issue.code === "too_big") return `${what === "slot" ? "Slot" : "Rank"} must be 1–100`;
    return `Enter a whole ${what} number`;
  }
  if (field === "name") {
    if (issue.code === "too_small") return "Enter the player's name";
    if (issue.code === "too_big") return `Max ${MAX_NAME_LENGTH} characters`;
    return "Check this name";
  }
  if (field === "kills") {
    if (issue.code === "invalid_type") return "Enter finishes (0 if none)";
    return "Finishes must be 0–99";
  }
  if (field === "players") {
    if (issue.code === "too_small") return "Add at least one player name";
    if (issue.code === "too_big") return `At most ${MAX_ROSTER_PLAYERS} players`;
    return "Check the players";
  }
  if (issue.code === "too_big") return `At most 25 ${kind === "SLOT_LIST" ? "teams" : "ranks"} per screenshot`;
  return issue.message;
}

export function validateDraft(d: LabelDraft): DraftErrors {
  const errors: DraftErrors = { form: [], groups: {}, players: {}, count: 0 };
  const labels = labelsFromDraft(d);
  const schema = d.kind === "SLOT_LIST" ? slotListLabelsSchema : resultsLabelsSchema;
  const res = schema.safeParse(labels);
  // map each filled player index back to its draft row
  const filledRows = d.groups.map((g) => g.players.filter((p) => p.name.trim() !== "" || p.kills.trim() !== ""));
  if (!res.success) {
    for (const issue of res.error.issues) {
      const [, gi, field, pi, sub] = issue.path as (string | number)[];
      if (typeof gi !== "number") {
        errors.form.push(friendly(issue, "groups", d.kind));
        continue;
      }
      const g = d.groups[gi];
      if (!g) continue;
      if (field === "slot" || field === "rank") (errors.groups[g.key] ??= {}).num = friendly(issue, "num", d.kind);
      else if (field === "players" && typeof pi !== "number") (errors.groups[g.key] ??= {}).players = friendly(issue, "players", d.kind);
      else if (field === "players" && typeof pi === "number") {
        const p = filledRows[gi]?.[pi];
        if (!p) continue;
        const f = d.kind === "SLOT_LIST" || sub === "name" ? "name" : "kills";
        (errors.players[p.key] ??= {})[f] = friendly(issue, f, d.kind);
      }
    }
  }
  // duplicates are allowed by the schema but almost always a typo → warn (non-blocking)
  const seen = new Map<string, string>();
  for (const g of d.groups) {
    const n = g.num.trim();
    if (!n) continue;
    const first = seen.get(n);
    if (first) (errors.groups[g.key] ??= {}).warn = `${d.kind === "SLOT_LIST" ? "Slot" : "Rank"} ${n} appears twice`;
    else seen.set(n, g.key);
  }
  errors.count = errors.form.length + Object.values(errors.groups).filter((e) => e.num || e.players).length + Object.values(errors.players).filter((e) => e.name || e.kills).length;
  return errors;
}

export const draftSignature = (d: LabelDraft) => JSON.stringify(labelsFromDraft(d));

export function draftStats(d: LabelDraft) {
  let names = 0;
  let low = 0;
  let corrected = 0;
  for (const g of d.groups) {
    if (g.numOcr && g.numOcr.confidence < LOW_CONFIDENCE) low++;
    for (const p of g.players) {
      if (p.name.trim()) names++;
      if (p.nameOcr && p.nameOcr.confidence < LOW_CONFIDENCE) low++;
      if (p.nameOcr && p.nameOcr.text !== p.name) corrected++;
    }
  }
  return { groups: d.groups.length, names, low, corrected };
}

// ---------- look-alike / invisible characters ----------
type GlyphClass = "one" | "zero" | "space" | "invisible" | "unicode" | "plain";
const ONE_LIKE = new Set(["I", "l", "1", "|", "!", "ǀ", "Ι", "І", "ӏ"]);
const ZERO_LIKE = new Set(["O", "0", "o", "Ο", "О", "〇"]);
const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿]/u;

export function classifyChar(ch: string): GlyphClass {
  if (ch === " ") return "space";
  if (INVISIBLE.test(ch) || /\s/u.test(ch)) return "invisible";
  if (ONE_LIKE.has(ch)) return "one";
  if (ZERO_LIKE.has(ch)) return "zero";
  if (ch.codePointAt(0)! > 0x7e) return "unicode";
  return "plain";
}
export const codePoint = (ch: string) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
export const hasInvisible = (s: string) => [...s].some((c) => classifyChar(c) === "invisible") || s !== s.trim() || /\s{2,}/.test(s);
export const needsNfc = (s: string) => s !== s.normalize("NFC");

/** Characters seen in real BGMI names that are hard to type. */
export const CHAR_PALETTE: { label: string; chars: string[] }[] = [
  { label: "Seen in screenshots", chars: ["多", "シ", "ツ", "《", "》", "£", "·", "Ā", "Ø", "Û", "×", "‿", "|", "ʞ", "ɯ", "ɹ", "ǝ", "ɐ"] },
  { label: "Symbols", chars: ["★", "☆", "✦", "♛", "♕", "⚡", "乂", "々", "丶", "ㅤ", "꧁", "꧂", "™", "°", "•", "ᴳ", "ᴼ", "ᴰ"] },
  { label: "Accented letters", chars: ["Á", "À", "Â", "Ä", "É", "È", "Ê", "Í", "Ó", "Ö", "Ô", "Ú", "Ü", "Ñ", "Ç", "ø", "ß", "Ł"] },
  { label: "Devanagari", chars: ["अ", "आ", "इ", "उ", "क", "ग", "ज", "त", "द", "न", "प", "म", "र", "ल", "श", "ष", "स", "ह", "ा", "ि", "ी", "ु", "े", "ो", "्", "ं"] },
];

// ---------- model readings cache (keeps confidences from the upload/re-read until the admin saves) ----------
const READING_PREFIX = "7xen.admin.training.reading.";
interface StoredReading {
  extraction: ExtractionResult;
  /** true until the admin saves: the editor starts from the full model output (incl. fields that weren't savable yet) */
  fresh: boolean;
}
export function saveReading(sampleId: string, extraction: ExtractionResult, fresh: boolean) {
  try {
    sessionStorage.setItem(READING_PREFIX + sampleId, JSON.stringify({ extraction, fresh } satisfies StoredReading));
  } catch {
    /* storage full/blocked: confidences just won't show */
  }
}
export function loadReading(sampleId: string): StoredReading | null {
  try {
    const raw = sessionStorage.getItem(READING_PREFIX + sampleId);
    return raw ? (JSON.parse(raw) as StoredReading) : null;
  } catch {
    return null;
  }
}

/** Attach OCR hints from a model reading to a draft built from saved labels (matched by group/player position). */
export function withHints(d: LabelDraft, ex: ExtractionResult | null): LabelDraft {
  if (!ex || ex.kind !== d.kind) return d;
  const read = draftFromExtraction(ex);
  return {
    ...d,
    groups: d.groups.map((g, gi) => {
      const rg = read.groups[gi];
      if (!rg) return g;
      return { ...g, numOcr: rg.numOcr, players: g.players.map((p, pi) => ({ ...p, nameOcr: rg.players[pi]?.nameOcr, killsOcr: rg.players[pi]?.killsOcr })) };
    }),
  };
}

// ---------- navigation order between samples (set by the samples page / upload flow) ----------
const NAV_KEY = "7xen.admin.training.nav";
export function setSampleNav(ids: string[]) {
  try {
    sessionStorage.setItem(NAV_KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}
export function getSampleNav(): string[] | null {
  try {
    const raw = sessionStorage.getItem(NAV_KEY);
    return raw ? (JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}
