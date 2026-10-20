/**
 * TDM battles (phase 7): a knockout bracket of 2-team matches, run on the tournament engine (Tournament.mode "TDM").
 *   4 teams → Semi-finals (M1, M2) → Final. 8 → Quarter-finals → Semi-finals → Final. …
 * Every round: groups of 2 (one per pairing), best-of-N matches, the winner advances. Points = match wins
 * (TDM_POINTS), so the winner of a best-of-odd series always has more points. From round 2 on, winners are paired in
 * bracket order: winner of M1 vs winner of M2, M3 vs M4, … (bracketPairs). BG coins go to the champion only.
 */
import { createRng, shuffle } from "./rng";
import type { DrawResult } from "./types";
import { TDM_MAPS, type GameMap } from "../enums";
import type { PointsSystem } from "../points";
import type { ScheduleConfig, StageSpec } from "../phase3";

export const TOURNAMENT_MODES = ["BR", "TDM"] as const;
export type TournamentMode = (typeof TOURNAMENT_MODES)[number];

export const TDM_TEAM_COUNTS = [4, 8, 16, 32, 64] as const;
export const TDM_BEST_OF = [1, 3, 5] as const;
/** a match win = 1 point; kills don't count */
export const TDM_POINTS: PointsSystem = { placement: [1, 0], killPoints: 0 };
export const TDM_MATCH_MINUTES = 10;
export const TDM_BREAK_MINUTES = 5;

/** "Final", "Semi-finals", "Quarter-finals", "Round of 16", … for a round that starts with `teams` teams. */
export function tdmRoundName(teams: number): string {
  if (teams <= 2) return "Final";
  if (teams === 4) return "Semi-finals";
  if (teams === 8) return "Quarter-finals";
  return `Round of ${teams}`;
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const LAST_MIN = 23 * 60 + 59;

export interface TdmPlanInput {
  teams: number;
  bestOf: number;
  /** map rotation for every series (match 1 = maps[0], …) */
  maps: GameMap[];
  /** "YYYY-MM-DD" IST; null = no schedule yet */
  date: string | null;
  /** "HH:mm" IST, first round starts */
  startTime: string;
  /** matches played at the same time (rooms) */
  parallel: number;
}

/** Each round's [start, end] in minutes after midnight (unclamped — may run past the day). */
function roundTimes(input: Pick<TdmPlanInput, "teams" | "bestOf" | "startTime" | "parallel">): { teams: number; start: number; end: number }[] {
  const bestOf = Math.max(1, input.bestOf);
  const parallel = Math.max(1, Math.min(4, input.parallel));
  const seriesMin = bestOf * TDM_MATCH_MINUTES + (bestOf - 1) * TDM_BREAK_MINUTES;
  const out: { teams: number; start: number; end: number }[] = [];
  let at = toMin(input.startTime);
  for (let n = input.teams; n >= 2; n = n / 2) {
    const waves = Math.ceil(n / 2 / parallel);
    const end = at + waves * seriesMin + (waves - 1) * TDM_BREAK_MINUTES;
    out.push({ teams: n, start: at, end });
    at = end + TDM_BREAK_MINUTES * 2;
  }
  return out;
}

/** "HH:mm" the final ends, or null when the bracket doesn't fit before midnight (start earlier / more rooms). */
export function tdmFinishTime(input: Pick<TdmPlanInput, "teams" | "bestOf" | "startTime" | "parallel">): string | null {
  const last = roundTimes(input).at(-1);
  return last && last.end <= LAST_MIN ? toHhmm(last.end) : null;
}

/** Round-by-round stage specs for a bracket; every round gets its own time window, one after the other on `date`. */
export function tdmStages(input: TdmPlanInput): StageSpec[] {
  const bestOf = Math.max(1, input.bestOf);
  const maps = Array.from({ length: bestOf }, (_, i) => input.maps[i % Math.max(1, input.maps.length)] ?? TDM_MAPS[0]);
  const parallel = Math.max(1, Math.min(4, input.parallel));
  const stages: StageSpec[] = [];
  for (const { teams: n, start: at, end: rawEnd } of roundTimes(input)) {
    const groups = n / 2;
    const end = Math.min(LAST_MIN, rawEnd);
    const schedule: ScheduleConfig | null = input.date
      ? {
          startDate: input.date,
          endDate: input.date,
          windows: [{ start: toHhmm(Math.min(at, LAST_MIN - 1)), end: toHhmm(Math.max(end, Math.min(at, LAST_MIN - 1) + 1)) }],
          excludeDates: [],
          matchMinutes: TDM_MATCH_MINUTES,
          breakMinutes: TDM_BREAK_MINUTES,
          parallelLobbies: parallel,
        }
      : null;
    stages.push({
      name: tdmRoundName(n),
      teamsIn: n,
      lobbySize: 2,
      groupCount: groups,
      matchesPerGroup: bestOf,
      maps,
      advancePerGroup: n === 2 ? 0 : 1,
      wildcardCount: 0,
      invitedSlots: 0,
      schedule,
    });
  }
  return stages;
}

/** Why a stage list isn't a valid TDM bracket for `maxTeams` (null = fine). */
export function tdmFormatError(stages: Pick<StageSpec, "teamsIn" | "lobbySize" | "groupCount" | "advancePerGroup" | "wildcardCount" | "invitedSlots">[], maxTeams: number): string | null {
  if (!(TDM_TEAM_COUNTS as readonly number[]).includes(maxTeams)) return `A TDM battle takes ${TDM_TEAM_COUNTS.join(", ")} teams`;
  let n = maxTeams;
  for (const [i, s] of stages.entries()) {
    const last = i === stages.length - 1;
    if (s.teamsIn !== n || s.lobbySize !== 2 || s.groupCount !== n / 2 || s.advancePerGroup !== (last ? 0 : 1) || s.wildcardCount || s.invitedSlots) {
      return "A TDM battle is a knockout: 2 teams per match and the winner goes through";
    }
    n /= 2;
  }
  return n === 1 ? null : "A TDM battle needs every round down to the final";
}

/**
 * Next-round pairings in bracket order. `winners[i]` = the team that won group i of the previous round (null when
 * nobody advanced, e.g. both teams disqualified). Group k gets the winners of groups 2k and 2k+1; a lone winner plays
 * nobody that round. Slot numbers firstSlot / firstSlot+1 are shuffled by `seed`.
 */
export function bracketPairs(winners: (string | null)[], seed: string, firstSlot: number): DrawResult["groups"] {
  const rng = createRng(seed);
  const out: DrawResult["groups"] = [];
  let seedNo = 1;
  for (let k = 0; k * 2 < winners.length; k++) {
    const pair = [winners[k * 2], winners[k * 2 + 1]].filter((t): t is string => !!t);
    const slots = shuffle(rng, [firstSlot, firstSlot + 1]);
    out.push({ index: k, teams: pair.map((teamId, i) => ({ teamId, slotNumber: slots[i]!, seed: seedNo++ })) });
  }
  return out;
}
