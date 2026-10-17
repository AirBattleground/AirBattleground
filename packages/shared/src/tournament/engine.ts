/**
 * Pure tournament algorithms — no I/O, deterministic for a given seed. Used by the API (authoritative) and by
 * the UIs (live previews in the wizard). Spec: docs/phase3/TOURNAMENTS.md "Algorithms".
 * Times are IST; dates "YYYY-MM-DD"; instants are ISO strings with +05:30 offset.
 */
import type { GameMap } from "../enums";
import type { PointsSystem, TeamMatchResult } from "../points";
import type { AdvancedVia, FormatIssue, ScheduleConfig, SchedulePlan, StageSpec } from "../phase3";

/** Stage presets for the wizard. Must return a format that passes validateFormat with no errors. */
export function suggestFormat(_input: { totalTeams: number; lobbySize?: number; maps?: GameMap[] }): StageSpec[] {
  throw new Error("not implemented");
}

/** Checks the flow rule and sanity rules; errors block publishing, warnings don't. */
export function validateFormat(_stages: StageSpec[], _maxTeams: number): FormatIssue[] {
  throw new Error("not implemented");
}

/** teamsOut = groupCount × advancePerGroup + wildcardCount (0 for the last stage). */
export function teamsOut(_stage: StageSpec, _isLast: boolean): number {
  throw new Error("not implemented");
}

/** Balanced group sizes: length = groups, sum = teams, max − min ≤ 1, larger groups first. */
export function groupSizes(_teams: number, _groups: number): number[] {
  throw new Error("not implemented");
}

/** "A".."Z", then "AA", "AB", … */
export function groupName(_index: number): string {
  throw new Error("not implemented");
}

/**
 * Pack each group's matches as one contiguous block into the configured windows, lobby by lobby, day by day.
 * `groupSizesList[i]` = team count of group i (used for slot capacity). Maps give each match's map.
 * Returns blocks, slot options (merged by start instant), days used, unscheduled groups, and suggestions.
 */
export function planSchedule(_config: ScheduleConfig, _groupSizesList: number[], _matchesPerGroup: number, _maps: GameMap[]): SchedulePlan {
  throw new Error("not implemented");
}

/** Small seedable RNG (e.g. mulberry32 over a string hash). Same seed → same sequence. */
export function createRng(_seed: string): () => number {
  throw new Error("not implemented");
}

export interface DrawTeam {
  teamId: string;
  /** TimeSlotOption ids, most preferred first; [] = any time */
  preferences: string[];
}
export interface DrawGroup {
  index: number;
  size: number;
  /** TimeSlotOption id this group plays in (null if unscheduled) */
  slotId: string | null;
}
export interface DrawResult {
  groups: { index: number; teams: { teamId: string; slotNumber: number; seed: number }[] }[];
  unmet: { teamId: string; wanted: string[]; got: string | null }[];
}
/**
 * Stage-1 draw. Teams in the given order (registration order = first come first served) take their highest-ranked
 * preference slot that still has capacity (random group within that slot via rng); teams with no satisfiable
 * preference (or none given) are placed randomly into remaining space after preference holders. Slot numbers in each
 * group are a seeded shuffle of firstSlot..firstSlot+size-1. `seed` in the result = draw order (1-based).
 */
export function drawGroups(_teams: DrawTeam[], _groups: DrawGroup[], _seed: string, _firstSlot: number): DrawResult {
  throw new Error("not implemented");
}

/**
 * Snake seeding into groups of the given sizes: seeds (already ranked best-first) go A,B,C,…, then back …,C,B,A.
 * Slot numbers = seeded shuffle of firstSlot.. within each group.
 */
export function snakeSeed(_rankedTeamIds: string[], _sizes: number[], _seed: string, _firstSlot: number): DrawResult["groups"] {
  throw new Error("not implemented");
}

export interface GroupResults {
  groupIndex: number;
  teamIds: string[];
  results: TeamMatchResult[];
  /** teams already disqualified (never advance) */
  disqualified?: string[];
}
export interface RankedTeam {
  teamId: string;
  groupIndex: number;
  groupRank: number;
  matchesPlayed: number;
  totalPoints: number;
  pointsPerMatch: number;
  wins: number;
  kills: number;
  placementPoints: number;
}
/** Whole-stage order used for wildcards and next-stage seeding: group rank, then points/match, wins, placement pts, kills. */
export function rankStage(_ps: PointsSystem, _groups: GroupResults[]): RankedTeam[] {
  throw new Error("not implemented");
}

export interface PromotionResult {
  qualified: (RankedTeam & { via: AdvancedVia })[];
  eliminated: RankedTeam[];
  /** human-readable tie warnings exactly at a cut-off */
  tiesAtCutoff: string[];
}
/**
 * Top `advancePerGroup` of each group (via TOP), then `wildcardCount` best remaining by points per match (via WILDCARD).
 * `include` forces teams in (taking the place of the lowest automatic qualifier when over capacity is not allowed —
 * total qualified must stay = groupCount×advance+wildcards unless include/exclude make that impossible), `exclude`
 * forces teams out (next best replaces them). Disqualified teams never qualify.
 */
export function promote(
  _ps: PointsSystem,
  _groups: GroupResults[],
  _advancePerGroup: number,
  _wildcardCount: number,
  _overrides?: { include?: string[]; exclude?: string[] },
): PromotionResult {
  throw new Error("not implemented");
}

/** Seed list for the next stage: invited teams first (in given order), then qualifiers in rankStage order. */
export function nextStageSeeds(_qualifiedInRankOrder: string[], _invitedTeamIds: string[]): string[] {
  throw new Error("not implemented");
}
