/**
 * Pure merge logic: fold one ExtractionResult into a match draft (no DB access, unit-tested directly).
 * Rules (docs/phase2/ARCHITECTURE.md "Merging extraction"):
 *  SLOT_LIST → per extracted team with a slot: replace that slot's players (name = roster match ?? OCR),
 *              teamId = the session's approved team on that slot. Never touches a confirmed lineup.
 *  RESULTS   → per row: slot = inferredSlot (or our own fuzzy match against the lineup), placement = rank,
 *              player kills matched by name, team kills = sum. Repeated ranks across screenshots overwrite
 *              (never add), so ranks 1–2 shown on every screenshot aren't double counted.
 *  Anything that can't be mapped becomes a plain-English warning.
 */
import type { ExtractedPlayer, ExtractionResult } from "@7xen/shared";

export interface DraftPlayer {
  position: number;
  name: string;
  ocrName: string | null;
  ocrConfidence: number | null;
  kills: number | null;
}
export interface DraftTeam {
  slotNumber: number;
  teamId: string | null;
  players: DraftPlayer[];
  placement: number | null;
  kills: number | null;
}
interface MergeContext {
  /** session's approved registrations: slot → team id */
  slotToTeam: Map<number, string>;
  /** known roster names per slot (TeamPlayer), used to infer slots for result rows */
  rosterBySlot?: Map<number, string[]>;
  /** lineup confirmed (status ≥ LIVE): SLOT_LIST screenshots must not change it */
  lineupLocked?: boolean;
  /** results published: RESULTS screenshots must not change them */
  resultsLocked?: boolean;
}
interface MergeOutcome {
  teams: DraftTeam[];
  changedSlots: Set<number>;
  warnings: string[];
}

export const TEAM_SIZE = 4;
/** A squad is 4, but substitutes who played still get a row (their finishes count for the team). */
const MAX_MATCH_PLAYERS = 8;
/** A results name is the same player as a lobby name when at least this alike (same team, same match). */
export const SAME_PLAYER = 0.85;
const MAX_SLOT = 100;

// ---------------------------------------------------------------- name matching

/** Normalise a player name for comparison: NFKC, lowercase, letters/digits only, common lookalikes folded. */
export function normName(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "")
    .replace(/0/g, "o")
    .replace(/[1l|!]/g, "i");
}

function levenshtein(a: string, b: string): number {
  const A = [...a];
  const B = [...b];
  if (!A.length) return B.length;
  if (!B.length) return A.length;
  let prev = Array.from({ length: B.length + 1 }, (_, i) => i);
  for (let i = 1; i <= A.length; i++) {
    const cur = [i];
    for (let j = 1; j <= B.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (A[i - 1] === B[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[B.length]!;
}

/** 0..1 similarity of two names after normalisation. */
export function nameSimilarity(a: string, b: string): number {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  return 1 - levenshtein(x, y) / Math.max([...x].length, [...y].length);
}

const playerLabel = (p: ExtractedPlayer) => p.name;
const namesOf = (players: ExtractedPlayer[]) => players.map(playerLabel).filter(Boolean).join(", ") || "no names read";

function clone(teams: DraftTeam[]): DraftTeam[] {
  return teams.map((t) => ({ ...t, players: t.players.map((p) => ({ ...p })) }));
}

function sortTeams(teams: DraftTeam[]) {
  teams.sort((a, b) => a.slotNumber - b.slotNumber);
  for (const t of teams) t.players.sort((a, b) => a.position - b.position);
  return teams;
}

function majority(values: (number | null)[]): number | null {
  const counts = new Map<number, number>();
  for (const v of values) if (v != null) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: number | null = null;
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

// ---------------------------------------------------------------- SLOT_LIST

export function mergeSlotList(draft: DraftTeam[], ex: ExtractionResult, ctx: MergeContext): MergeOutcome {
  const teams = clone(draft);
  const changedSlots = new Set<number>();
  const warnings: string[] = [];
  const extracted = ex.teams.filter((t) => t.players.length > 0);

  if (ctx.lineupLocked) {
    if (extracted.length) warnings.push("The lineup was already confirmed, so this team list screenshot wasn't applied");
    return { teams, changedSlots, warnings };
  }

  const seen = new Set<number>();
  for (const t of extracted) {
    const slot = t.slot ?? majority(t.players.map((p) => p.matchedSlot));
    if (slot == null || slot < 1 || slot > MAX_SLOT) {
      warnings.push(`Couldn't read the slot number for a team (${namesOf(t.players)})`);
      continue;
    }
    if (seen.has(slot)) {
      warnings.push(`Slot ${slot} appears twice on the same screenshot — check it`);
      continue;
    }
    seen.add(slot);

    const players: DraftPlayer[] = t.players.slice(0, 6).map((p, i) => ({
      position: i + 1,
      // what the screenshot said — accounts are linked later (linkMatchPlayers, ≥95%), never by snapping names here
      name: p.name.trim() || p.name,
      ocrName: p.name,
      ocrConfidence: p.confidence,
      kills: null,
    }));
    let team = teams.find((x) => x.slotNumber === slot);
    if (!team) {
      team = { slotNumber: slot, teamId: ctx.slotToTeam.get(slot) ?? null, players: [], placement: null, kills: null };
      teams.push(team);
    }
    team.teamId = ctx.slotToTeam.get(slot) ?? null;
    // the same slot read again (overlapping screenshots): keep the more complete reading
    if (team.players.length > players.length) {
      changedSlots.add(slot);
      continue;
    }
    team.players = players;
    changedSlots.add(slot);
  }
  return { teams: sortTeams(teams), changedSlots, warnings };
}

// ---------------------------------------------------------------- RESULTS

/** Best slot for a results row by fuzzy-matching its names against the lineup + rosters. */
export function inferSlot(players: ExtractedPlayer[], teams: DraftTeam[], rosterBySlot?: Map<number, string[]>): number | null {
  const candidates = new Map<number, Set<string>>();
  for (const t of teams) {
    const set = candidates.get(t.slotNumber) ?? new Set<string>();
    for (const p of t.players) set.add(p.name);
    candidates.set(t.slotNumber, set);
  }
  if (rosterBySlot) {
    for (const [slot, names] of rosterBySlot) {
      const set = candidates.get(slot) ?? new Set<string>();
      for (const n of names) set.add(n);
      candidates.set(slot, set);
    }
  }
  const votes = new Map<number, { n: number; score: number }>();
  for (const p of players) {
    let bestSlot: number | null = null;
    let best = 0;
    for (const [slot, names] of candidates) {
      for (const n of names) {
        const s = Math.max(nameSimilarity(p.name, n), p.rosterMatch ? nameSimilarity(p.rosterMatch, n) : 0);
        if (s > best) {
          best = s;
          bestSlot = slot;
        }
      }
    }
    if (bestSlot != null && best >= 0.75) {
      const v = votes.get(bestSlot) ?? { n: 0, score: 0 };
      v.n++;
      v.score += best;
      votes.set(bestSlot, v);
    }
  }
  let winner: number | null = null;
  let top = { n: 0, score: 0 };
  for (const [slot, v] of votes) {
    if (v.n > top.n || (v.n === top.n && v.score > top.score)) {
      winner = slot;
      top = v;
    }
  }
  return winner;
}

export function mergeResults(draft: DraftTeam[], ex: ExtractionResult, ctx: MergeContext): MergeOutcome {
  const teams = clone(draft);
  const changedSlots = new Set<number>();
  const warnings: string[] = [];

  if (ctx.resultsLocked) {
    if (ex.rows.length) warnings.push("Results are already published, so this screenshot wasn't applied. Unpublish to change them.");
    return { teams, changedSlots, warnings };
  }

  // a rank can only appear once per screenshot: keep the most complete reading
  const byRank = new Map<number, ExtractionResult["rows"][number]>();
  for (const row of ex.rows) {
    if (row.rank == null || row.rank < 1) {
      if (row.players.length) warnings.push(`A results row had no readable rank and was skipped (${namesOf(row.players)})`);
      continue;
    }
    const prev = byRank.get(row.rank);
    if (!prev || row.players.length > prev.players.length || (row.players.length === prev.players.length && row.rankConfidence > prev.rankConfidence)) {
      byRank.set(row.rank, row);
    }
  }

  const known = (slot: number) => teams.some((t) => t.slotNumber === slot) || ctx.slotToTeam.has(slot) || ctx.rosterBySlot?.has(slot);

  for (const [rank, row] of [...byRank].sort((a, b) => a[0] - b[0])) {
    let slot = row.inferredSlot != null && known(row.inferredSlot) ? row.inferredSlot : null;
    slot ??= inferSlot(row.players, teams, ctx.rosterBySlot);
    if (slot == null) {
      warnings.push(`Couldn't match rank ${rank} to a team in the lineup (${namesOf(row.players)})`);
      continue;
    }

    let team = teams.find((t) => t.slotNumber === slot);
    if (!team) {
      team = { slotNumber: slot, teamId: ctx.slotToTeam.get(slot) ?? null, players: [], placement: null, kills: null };
      teams.push(team);
    }
    const other = teams.find((t) => t !== team && t.placement === rank);
    if (other) warnings.push(`Rank ${rank} was read for both slot ${other.slotNumber} and slot ${slot} — check it`);
    if (team.placement != null && team.placement !== rank) {
      warnings.push(`Slot ${slot} was read as rank ${team.placement} and rank ${rank} — using rank ${rank}`);
    }
    team.placement = rank;

    // player kills by name
    const free = new Set(team.players);
    const pick = (p: ExtractedPlayer): DraftPlayer | null => {
      const pool = [...free];
      const exact = pool.find((d) => d.name === p.name || d.ocrName === p.name);
      if (exact) return exact;
      const norm = pool.find((d) => normName(d.name) === normName(p.name));
      if (norm) return norm;
      let best: DraftPlayer | null = null;
      let bestScore = 0;
      for (const d of pool) {
        const s = nameSimilarity(d.name, p.name);
        if (s > bestScore) {
          best = d;
          bestScore = s;
        }
      }
      return bestScore >= SAME_PLAYER ? best : null;
    };
    for (const p of row.players) {
      const target = pick(p);
      if (target) {
        free.delete(target);
        target.kills = p.kills;
        continue;
      }
      if (team.players.length < MAX_MATCH_PLAYERS) {
        const position = Math.max(0, ...team.players.map((x) => x.position)) + 1;
        team.players.push({ position, name: playerLabel(p), ocrName: p.name, ocrConfidence: p.confidence, kills: p.kills });
      } else {
        warnings.push(`Couldn't match player "${p.name}" to slot ${slot}'s lineup`);
      }
    }
    // Team finishes = sum over ALL of the team's players, not just this row: a block cut off at the
    // panel edge (2 of 4 players visible) must not wipe out finishes read from another screenshot.
    const playerKills = team.players.map((p) => p.kills).filter((k): k is number => k != null);
    if (playerKills.length) team.kills = playerKills.reduce((sum, k) => sum + k, 0);
    changedSlots.add(slot);
  }
  return { teams: sortTeams(teams), changedSlots, warnings };
}
