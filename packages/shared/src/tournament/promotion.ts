/** Stage ranking, promotion (top N + wildcards + overrides) and next-stage seed lists. */
import { computeStandings, type PointsSystem, type StandingRow } from "../points";
import type { AdvancedVia } from "../phase3";
import { groupName } from "./format";
import type { GroupResults, PromotionResult, RankedTeam } from "./types";

const standingCmp = (a: StandingRow, b: StandingRow) =>
  b.totalPoints - a.totalPoints ||
  b.wins - a.wins ||
  b.placementPoints - a.placementPoints ||
  b.kills - a.kills ||
  (a.lastPlacement ?? 99) - (b.lastPlacement ?? 99);

/** Order used for wildcards: points per match, wins, placement points, kills. */
const wildcardCmp = (a: RankedTeam, b: RankedTeam) =>
  b.pointsPerMatch - a.pointsPerMatch || b.wins - a.wins || b.placementPoints - a.placementPoints || b.kills - a.kills;

/** Ranks one group: teams with results by standings, then teams without results (seed order), then disqualified. */
function rankGroup(ps: PointsSystem, g: GroupResults): RankedTeam[] {
  const dq = new Set(g.disqualified ?? []);
  const seedPos = new Map(g.teamIds.map((id, i) => [id, i] as const));
  const pos = (id: string) => seedPos.get(id) ?? Number.MAX_SAFE_INTEGER;
  const rows = computeStandings(ps, g.results);
  const byId = new Map(rows.map((r) => [r.teamId, r] as const));
  const allIds = [...g.teamIds];
  for (const r of rows) if (!seedPos.has(r.teamId)) allIds.push(r.teamId);

  const played = allIds.filter((id) => byId.has(id) && !dq.has(id));
  played.sort((a, b) => standingCmp(byId.get(a)!, byId.get(b)!) || pos(a) - pos(b) || (a < b ? -1 : 1));
  const notPlayed = allIds.filter((id) => !byId.has(id) && !dq.has(id));
  const disq = allIds.filter((id) => dq.has(id));

  return [...played, ...notPlayed, ...disq].map((teamId, i) => {
    const r = byId.get(teamId);
    const mp = r?.matchesPlayed ?? 0;
    return {
      teamId,
      groupIndex: g.groupIndex,
      groupRank: i + 1,
      matchesPlayed: mp,
      totalPoints: r?.totalPoints ?? 0,
      pointsPerMatch: mp > 0 ? r!.totalPoints / mp : 0,
      wins: r?.wins ?? 0,
      kills: r?.kills ?? 0,
      placementPoints: r?.placementPoints ?? 0,
    };
  });
}

/**
 * Whole-stage order used for wildcards and next-stage seeding: group rank, then points/match, wins, placement pts, kills.
 * Within a group, teams without results rank after those with (in `teamIds` order); disqualified teams rank last.
 */
export function rankStage(ps: PointsSystem, groups: GroupResults[]): RankedTeam[] {
  const all = groups.flatMap((g) => rankGroup(ps, g));
  return all.sort((a, b) => a.groupRank - b.groupRank || wildcardCmp(a, b) || a.groupIndex - b.groupIndex);
}

const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
};

/**
 * Top `advancePerGroup` of each group (via TOP), then `wildcardCount` best remaining by points per match (via WILDCARD).
 * `include` forces teams in (taking the place of the lowest automatic qualifier when over capacity is not allowed —
 * total qualified must stay = groupCount×advance+wildcards unless include/exclude make that impossible), `exclude`
 * forces teams out (next best replaces them). Disqualified teams never qualify.
 *
 * tiesAtCutoff messages name teams by teamId — callers may substitute team names.
 */
export function promote(
  ps: PointsSystem,
  groups: GroupResults[],
  advancePerGroup: number,
  wildcardCount: number,
  overrides?: { include?: string[]; exclude?: string[] },
): PromotionResult {
  const ranked = rankStage(ps, groups);
  const order = new Map(ranked.map((t, i) => [t.teamId, i] as const));
  const dq = new Set(groups.flatMap((g) => g.disqualified ?? []));
  const exclude = new Set(overrides?.exclude ?? []);
  const include = (overrides?.include ?? []).filter((id) => order.has(id) && !dq.has(id) && !exclude.has(id));
  const blocked = (id: string) => dq.has(id) || exclude.has(id);

  const via = new Map<string, AdvancedVia>();
  const ties: string[] = [];
  const sameStats = (a: RankedTeam, b: RankedTeam, perMatch: boolean) =>
    (perMatch ? a.pointsPerMatch === b.pointsPerMatch : a.totalPoints === b.totalPoints) &&
    a.wins === b.wins &&
    a.placementPoints === b.placementPoints &&
    a.kills === b.kills;
  const overridden = (id: string) => exclude.has(id) || include.includes(id);

  // 1. top N per group (excluded / disqualified skipped → next best moves up)
  const byGroup = new Map<number, RankedTeam[]>();
  for (const t of ranked) {
    const list = byGroup.get(t.groupIndex) ?? [];
    list.push(t);
    byGroup.set(t.groupIndex, list);
  }
  for (const g of groups) {
    const list = (byGroup.get(g.groupIndex) ?? []).slice().sort((a, b) => a.groupRank - b.groupRank);
    const eligible = list.filter((t) => !blocked(t.teamId));
    const top = eligible.slice(0, Math.max(0, advancePerGroup));
    top.forEach((t) => via.set(t.teamId, "TOP"));
    const last = top[top.length - 1];
    if (last && top.length === advancePerGroup && last.matchesPlayed > 0) {
      const tied = eligible.slice(advancePerGroup).filter((t) => t.matchesPlayed > 0 && sameStats(last, t, false));
      if (tied.length > 0 && !overridden(last.teamId) && !tied.some((t) => overridden(t.teamId))) {
        ties.push(
          `Group ${groupName(g.groupIndex)}: ${last.teamId} (in) and ${tied.map((t) => t.teamId).join(", ")} (out) are tied for ${ordinal(
            advancePerGroup,
          )} place on ${fmtNum(last.totalPoints)} ${last.totalPoints === 1 ? "point" : "points"}, ${last.wins} ${last.wins === 1 ? "win" : "wins"}, ${last.placementPoints} placement points and ${last.kills} kills. Check the tie-break before promoting.`,
        );
      }
    }
  }

  // 2. wildcards: best remaining by points per match
  const pool = ranked.filter((t) => !via.has(t.teamId) && !blocked(t.teamId)).sort((a, b) => wildcardCmp(a, b) || order.get(a.teamId)! - order.get(b.teamId)!);
  const wild = pool.slice(0, Math.max(0, wildcardCount));
  wild.forEach((t) => via.set(t.teamId, "WILDCARD"));
  const lastWild = wild[wild.length - 1];
  if (lastWild && wild.length === wildcardCount && lastWild.matchesPlayed > 0) {
    const tied = pool.slice(wildcardCount).filter((t) => t.matchesPlayed > 0 && sameStats(lastWild, t, true));
    if (tied.length > 0 && !overridden(lastWild.teamId) && !tied.some((t) => overridden(t.teamId))) {
      ties.push(
        `Last wildcard: ${lastWild.teamId} (in) and ${tied.map((t) => t.teamId).join(", ")} (out) are tied on ${fmtNum(
          lastWild.pointsPerMatch,
        )} points per match, ${lastWild.wins} ${lastWild.wins === 1 ? "win" : "wins"}, ${lastWild.placementPoints} placement points and ${lastWild.kills} kills. Check the tie-break before promoting.`,
      );
    }
  }

  // 3. forced includes replace the lowest-ranked automatic qualifier (last in rankStage order)
  const forced = new Set<string>();
  for (const id of include) {
    if (via.has(id)) {
      forced.add(id);
      continue;
    }
    const auto = [...via.keys()].filter((q) => !forced.has(q));
    const victim = auto.sort((a, b) => order.get(b)! - order.get(a)!)[0];
    let v: AdvancedVia = "WILDCARD";
    if (victim) {
      v = via.get(victim)!;
      via.delete(victim);
    }
    via.set(id, v);
    forced.add(id);
  }

  const qualified: PromotionResult["qualified"] = [];
  const eliminated: RankedTeam[] = [];
  for (const t of ranked) {
    const v = via.get(t.teamId);
    if (v) qualified.push({ ...t, via: v });
    else eliminated.push(t);
  }
  return { qualified, eliminated, tiesAtCutoff: ties };
}

/** Seed list for the next stage: invited teams first (in given order), then qualifiers in rankStage order. */
export function nextStageSeeds(qualifiedInRankOrder: string[], invitedTeamIds: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...invitedTeamIds, ...qualifiedInRankOrder]) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
