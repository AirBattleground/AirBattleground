import type { TeamMatchResult } from "../points";
import type { AdvancedVia } from "../phase3";

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

export interface PromotionResult {
  qualified: (RankedTeam & { via: AdvancedVia })[];
  eliminated: RankedTeam[];
  /** human-readable tie warnings exactly at a cut-off */
  tiesAtCutoff: string[];
}
