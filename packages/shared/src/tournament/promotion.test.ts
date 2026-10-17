import { describe, expect, it } from "vitest";
import { DEFAULT_POINTS_SYSTEM as PS, type TeamMatchResult } from "../points";
import { createRng, nextStageSeeds, promote, rankStage, type GroupResults } from "./engine";

/** Build results from per-match finishing orders: orders[m] = teamIds best-first; kills[teamId] per match. */
function results(orders: string[][], kills: Record<string, number> = {}): TeamMatchResult[] {
  return orders.flatMap((order, m) => order.map((teamId, i) => ({ teamId, matchNumber: m + 1, placement: i + 1, kills: kills[teamId] ?? 0 })));
}

describe("rankStage", () => {
  it("orders by group rank, then points per match; teams without results last in seed order", () => {
    const groups: GroupResults[] = [
      { groupIndex: 0, teamIds: ["a1", "a2", "a3", "a4"], results: results([["a2", "a1", "a3"]]) },
      { groupIndex: 1, teamIds: ["b1", "b2", "b3"], results: results([["b1", "b2", "b3"], ["b1", "b3", "b2"]]) },
    ];
    const r = rankStage(PS, groups);
    // rank 1: a2 and b1 both 10/match, b1 has more wins; rank 3: a3 and b2 both 5/match, b2 more placement points
    expect(r.map((t) => `${t.teamId}:${t.groupRank}`)).toEqual(["b1:1", "a2:1", "a1:2", "b3:2", "b2:3", "a3:3", "a4:4"]);
    expect(r.find((t) => t.teamId === "a4")).toMatchObject({ matchesPlayed: 0, pointsPerMatch: 0 });
    expect(r.find((t) => t.teamId === "b3")).toMatchObject({ matchesPlayed: 2, totalPoints: 11, pointsPerMatch: 5.5 });
  });

  it("disqualified teams rank last in their group", () => {
    const r = rankStage(PS, [{ groupIndex: 0, teamIds: ["x", "y"], results: results([["x", "y"]]), disqualified: ["x"] }]);
    expect(r.map((t) => [t.teamId, t.groupRank])).toEqual([["y", 1], ["x", 2]]);
  });
});

describe("promote", () => {
  const g = (groupIndex: number, prefix: string, n: number, orders: number[][], extra: Partial<GroupResults> = {}): GroupResults => {
    const teamIds = Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
    return { groupIndex, teamIds, results: results(orders.map((o) => o.map((i) => teamIds[i - 1]!))), ...extra };
  };

  it("top N per group then wildcards by points per match across uneven groups", () => {
    // group A plays 2 matches, group B plays 1 → wildcard must use points per match, not totals
    const A = g(0, "a", 4, [[1, 2, 3, 4], [1, 2, 4, 3]]); // a3: 5+3=8 (4/match), a4: 4+5=9 (4.5/match)
    const B = g(1, "b", 3, [[1, 2, 3]]); // b3: 5 points in 1 match
    const r = promote(PS, [A, B], 2, 1);
    expect(r.qualified.map((q) => [q.teamId, q.via])).toEqual([
      ["a1", "TOP"],
      ["b1", "TOP"],
      ["a2", "TOP"],
      ["b2", "TOP"],
      ["b3", "WILDCARD"],
    ]);
    expect(r.eliminated.map((e) => e.teamId)).toEqual(["a4", "a3"]);
    expect(r.tiesAtCutoff).toEqual([]);
  });

  it("flags ties exactly at the group cut-off", () => {
    // t2 and t3 both: one 2nd and one 3rd place → 11 points, 0 wins, same kills (t3 ahead on latest placement only)
    const G = g(0, "t", 4, [[1, 2, 3, 4], [1, 3, 2, 4]]);
    const r = promote(PS, [G], 2, 0);
    expect(r.qualified.map((q) => q.teamId)).toEqual(["t1", "t3"]);
    expect(r.tiesAtCutoff).toHaveLength(1);
    expect(r.tiesAtCutoff[0]).toBe(
      "Group A: t3 (in) and t2 (out) are tied for 2nd place on 11 points, 0 wins, 11 placement points and 0 kills. Check the tie-break before promoting.",
    );
    // an override on the tied teams clears the warning
    const r2 = promote(PS, [G], 2, 0, { include: ["t2"], exclude: ["t3"] });
    expect(r2.qualified.map((q) => q.teamId)).toEqual(["t1", "t2"]);
    expect(r2.tiesAtCutoff).toEqual([]);
  });

  it("flags ties at the wildcard cut-off", () => {
    const A = g(0, "a", 3, [[1, 2, 3]]);
    const B = g(1, "b", 3, [[1, 2, 3]]);
    const r = promote(PS, [A, B], 1, 1);
    expect(r.qualified).toHaveLength(3);
    expect(r.tiesAtCutoff).toHaveLength(1);
    expect(r.tiesAtCutoff[0]).toMatch(/^Last wildcard: a2 \(in\) and b2 \(out\) are tied on 6 points per match/);
  });

  it("disqualified teams never qualify and are replaced", () => {
    const A = g(0, "a", 4, [[1, 2, 3, 4]], { disqualified: ["a1"] });
    const r = promote(PS, [A], 2, 1);
    expect(r.qualified.map((q) => [q.teamId, q.via])).toEqual([
      ["a2", "TOP"],
      ["a3", "TOP"],
      ["a4", "WILDCARD"],
    ]);
    expect(r.eliminated.map((e) => e.teamId)).toEqual(["a1"]);
    // include can't bring a DQ team back
    expect(promote(PS, [A], 2, 0, { include: ["a1"] }).qualified.map((q) => q.teamId)).toEqual(["a2", "a3"]);
  });

  it("exclude → next best replaces; include → replaces the lowest automatic qualifier", () => {
    const A = g(0, "a", 5, [[1, 2, 3, 4, 5]]);
    const B = g(1, "b", 5, [[1, 2, 3, 4, 5]]);
    const ex = promote(PS, [A, B], 2, 1, { exclude: ["a1"] });
    expect(ex.qualified.map((q) => [q.teamId, q.via]).sort()).toEqual([
      ["a2", "TOP"],
      ["a3", "TOP"],
      ["b1", "TOP"],
      ["b2", "TOP"],
      ["b3", "WILDCARD"],
    ]);
    const inc = promote(PS, [A, B], 2, 1, { include: ["b5"] });
    expect(inc.qualified).toHaveLength(5);
    expect(inc.qualified.map((q) => q.teamId)).toContain("b5");
    // lowest-ranked automatic qualifier was the wildcard (a3 or b3)
    expect(inc.qualified.filter((q) => q.teamId === "a3" || q.teamId === "b3")).toHaveLength(0);
    expect(inc.qualified.find((q) => q.teamId === "b5")!.via).toBe("WILDCARD");
    // more includes than spots: everyone included still qualifies
    const many = promote(PS, [A], 1, 0, { include: ["a4", "a5"] });
    expect(many.qualified.map((q) => q.teamId).sort()).toEqual(["a4", "a5"]);
  });

  it("property: qualified count = groups×advance+wildcards, no team twice", () => {
    const rng = createRng("promo");
    for (let iter = 0; iter < 200; iter++) {
      const nGroups = 1 + Math.floor(rng() * 6);
      const groups: GroupResults[] = [];
      let all: string[] = [];
      let minSize = Infinity;
      for (let gi = 0; gi < nGroups; gi++) {
        const size = 4 + Math.floor(rng() * 13);
        minSize = Math.min(minSize, size);
        const teamIds = Array.from({ length: size }, (_, i) => `g${gi}t${i}`);
        all = all.concat(teamIds);
        const matches = Math.floor(rng() * 5);
        const res: TeamMatchResult[] = [];
        for (let m = 1; m <= matches; m++) {
          const order = teamIds.slice().sort(() => rng() - 0.5);
          order.forEach((teamId, p) => res.push({ teamId, matchNumber: m, placement: p + 1, kills: Math.floor(rng() * 5) }));
        }
        groups.push({ groupIndex: gi, teamIds, results: res, disqualified: rng() < 0.2 ? [teamIds[0]!] : [] });
      }
      const advance = 1 + Math.floor(rng() * (minSize - 2));
      const pool = all.length - nGroups * advance - nGroups; // leave room for DQs
      const wild = Math.floor(rng() * Math.max(0, Math.min(pool, 6)));
      const exclude = all.filter(() => rng() < 0.03);
      const r = promote(PS, groups, advance, wild, { exclude });
      const q = r.qualified.map((x) => x.teamId);
      expect(new Set(q).size).toBe(q.length);
      expect(q.length + r.eliminated.length).toBe(all.length);
      const dq = new Set(groups.flatMap((x) => x.disqualified ?? []));
      for (const id of q) {
        expect(dq.has(id)).toBe(false);
        expect(exclude.includes(id)).toBe(false);
      }
      expect(q.length).toBe(nGroups * advance + wild);
      for (const x of groups) {
        expect(r.qualified.filter((t) => t.groupIndex === x.groupIndex && t.via === "TOP")).toHaveLength(advance);
      }
    }
  });
});

describe("nextStageSeeds", () => {
  it("invited first, then qualifiers, no duplicates", () => {
    expect(nextStageSeeds(["q1", "q2", "inv2"], ["inv1", "inv2"])).toEqual(["inv1", "inv2", "q1", "q2"]);
  });
});
