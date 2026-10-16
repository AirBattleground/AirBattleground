/**
 * Points table rules (shared by API and UIs so everyone computes the same numbers).
 * Default = the common BGMI scrim system: placement points for top 8 + 1 point per finish.
 */
export interface PointsSystem {
  /** placement[0] = points for 1st place, placement[1] = 2nd, … ; places beyond the array score 0 */
  placement: number[];
  /** points per finish (kill) */
  killPoints: number;
}

export const DEFAULT_POINTS_SYSTEM: PointsSystem = {
  placement: [10, 6, 5, 4, 3, 2, 1, 1],
  killPoints: 1,
};

export function placementPoints(ps: PointsSystem, placement: number): number {
  return ps.placement[placement - 1] ?? 0;
}

export function matchPoints(ps: PointsSystem, placement: number, kills: number) {
  const p = placementPoints(ps, placement);
  const k = kills * ps.killPoints;
  return { placementPoints: p, killPoints: k, totalPoints: p + k };
}

/** One team's result in one published match. */
export interface TeamMatchResult {
  teamId: string;
  matchNumber: number;
  placement: number;
  kills: number;
}

export interface StandingRow {
  teamId: string;
  rank: number;
  matchesPlayed: number;
  wins: number;
  kills: number;
  placementPoints: number;
  killPoints: number;
  totalPoints: number;
  /** placement in the most recent match the team played (tie-breaker) */
  lastPlacement: number | null;
}

/**
 * Aggregate match results into a standings table.
 * Tie-breakers (in order): total points → wins (chicken dinners) → placement points → kills →
 * better placement in the latest match. Teams still tied share the same rank.
 */
export function computeStandings(ps: PointsSystem, results: TeamMatchResult[]): StandingRow[] {
  const byTeam = new Map<string, StandingRow & { lastMatch: number }>();
  for (const r of results) {
    const row = byTeam.get(r.teamId) ?? {
      teamId: r.teamId, rank: 0, matchesPlayed: 0, wins: 0, kills: 0,
      placementPoints: 0, killPoints: 0, totalPoints: 0, lastPlacement: null, lastMatch: -1,
    };
    const pts = matchPoints(ps, r.placement, r.kills);
    row.matchesPlayed++;
    if (r.placement === 1) row.wins++;
    row.kills += r.kills;
    row.placementPoints += pts.placementPoints;
    row.killPoints += pts.killPoints;
    row.totalPoints += pts.totalPoints;
    if (r.matchNumber > row.lastMatch) {
      row.lastMatch = r.matchNumber;
      row.lastPlacement = r.placement;
    }
    byTeam.set(r.teamId, row);
  }
  const cmp = (a: StandingRow, b: StandingRow) =>
    b.totalPoints - a.totalPoints ||
    b.wins - a.wins ||
    b.placementPoints - a.placementPoints ||
    b.kills - a.kills ||
    (a.lastPlacement ?? 99) - (b.lastPlacement ?? 99);
  const rows = [...byTeam.values()].map(({ lastMatch: _l, ...r }) => r).sort(cmp);
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.rank = prev && cmp(prev, r) === 0 ? prev.rank : i + 1;
  });
  return rows;
}
