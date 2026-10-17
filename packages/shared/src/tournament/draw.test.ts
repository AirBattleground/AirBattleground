import { describe, expect, it } from "vitest";
import { createRng, drawGroups, groupSizes, snakeSeed, type DrawGroup, type DrawTeam } from "./engine";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i + 1}`);

describe("createRng", () => {
  it("is deterministic per seed and in [0,1)", () => {
    const a = createRng("abc");
    const b = createRng("abc");
    const c = createRng("abd");
    const sa = Array.from({ length: 50 }, a);
    expect(sa).toEqual(Array.from({ length: 50 }, b));
    expect(sa).not.toEqual(Array.from({ length: 50 }, c));
    for (const x of sa) expect(x >= 0 && x < 1).toBe(true);
  });
  it("is roughly uniform", () => {
    const r = createRng("uniform");
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 20000; i++) buckets[Math.floor(r() * 10)]++;
    for (const n of buckets) expect(Math.abs(n - 2000)).toBeLessThan(200);
  });
});

describe("drawGroups", () => {
  const groups: DrawGroup[] = [
    { index: 0, size: 3, slotId: "S1" },
    { index: 1, size: 3, slotId: "S1" },
    { index: 2, size: 3, slotId: "S2" },
    { index: 3, size: 2, slotId: null },
  ];

  it("honours preferences in registration order and capacity", () => {
    const teams: DrawTeam[] = [
      ...ids(7).map((teamId) => ({ teamId, preferences: ["S2", "S1"] })),
      { teamId: "late", preferences: ["S2"] },
      { teamId: "any1", preferences: [] },
      { teamId: "any2", preferences: [] },
      { teamId: "any3", preferences: [] },
    ];
    const r = drawGroups(teams, groups, "seed-1", 1);
    const groupOf = new Map(r.groups.flatMap((g) => g.teams.map((t) => [t.teamId, g.index] as const)));
    expect(["t1", "t2", "t3"].map((t) => groupOf.get(t))).toEqual([2, 2, 2]);
    for (const t of ["t4", "t5", "t6", "t7"]) expect([0, 1]).toContain(groupOf.get(t));
    expect(r.unmet.map((u) => u.teamId)).toEqual(["late"]);
    expect(r.unmet[0]!.wanted).toEqual(["S2"]);
    expect(r.unmet[0]!.got === "S1" || r.unmet[0]!.got === null).toBe(true);
    for (const g of r.groups) expect(g.teams.length).toBe(groups[g.index]!.size);
    // seeds = registration order
    const all = r.groups.flatMap((g) => g.teams);
    expect(all.find((t) => t.teamId === "t1")!.seed).toBe(1);
    expect(all.find((t) => t.teamId === "any3")!.seed).toBe(11);
  });

  it("slot numbers are a shuffle of firstSlot..firstSlot+size-1", () => {
    const r = drawGroups(ids(11).map((teamId) => ({ teamId, preferences: [] })), groups, "x", 5);
    for (const g of r.groups) {
      const size = groups[g.index]!.size;
      expect(g.teams.map((t) => t.slotNumber).sort((a, b) => a - b)).toEqual(Array.from({ length: size }, (_, i) => 5 + i));
    }
  });

  it("is deterministic per seed and varies across seeds", () => {
    const teams = ids(11).map((teamId) => ({ teamId, preferences: [] }));
    expect(drawGroups(teams, groups, "same", 1)).toEqual(drawGroups(teams, groups, "same", 1));
    const outcomes = new Set(["a", "b", "c", "d", "e"].map((s) => JSON.stringify(drawGroups(teams, groups, s, 1).groups)));
    expect(outcomes.size).toBeGreaterThan(1);
  });

  it("throws when teams exceed space", () => {
    expect(() => drawGroups(ids(12).map((teamId) => ({ teamId, preferences: [] })), groups, "s", 1)).toThrow(/room for 11/);
  });

  it("property: random 128-team draws place every team once and respect sizes", () => {
    const rng = createRng("property");
    for (let iter = 0; iter < 50; iter++) {
      const nGroups = 1 + Math.floor(rng() * 10);
      const sizes = groupSizes(Math.floor(rng() * 128) + nGroups, nGroups).map((s) => Math.min(s, 25));
      const total = sizes.reduce((a, b) => a + b, 0);
      const slots = ["A", "B", "C"];
      const gs: DrawGroup[] = sizes.map((size, index) => ({ index, size, slotId: rng() < 0.1 ? null : slots[index % 3]! }));
      const nTeams = Math.floor(rng() * (total + 1));
      const teams: DrawTeam[] = ids(nTeams).map((teamId) => ({
        teamId,
        preferences: slots.filter(() => rng() < 0.4),
      }));
      const r = drawGroups(teams, gs, `s${iter}`, 1);
      const placed = r.groups.flatMap((g) => g.teams.map((t) => t.teamId));
      expect(new Set(placed).size).toBe(nTeams);
      expect(placed.length).toBe(nTeams);
      for (const g of r.groups) {
        expect(g.teams.length).toBeLessThanOrEqual(gs[g.index]!.size);
        expect(new Set(g.teams.map((t) => t.slotNumber)).size).toBe(g.teams.length);
      }
      // a team is unmet only if all its preferred slots were full when its turn came — so an earlier team can't be
      // unmet for a slot a later team got via preference... check: every unmet team's wanted slots are full
      const slotOf = new Map(gs.map((g) => [g.index, g.slotId]));
      for (const u of r.unmet) {
        for (const w of u.wanted) {
          const cap = gs.filter((g) => g.slotId === w).reduce((a, g) => a + g.size, 0);
          const filled = r.groups.filter((g) => slotOf.get(g.index) === w).reduce((a, g) => a + g.teams.length, 0);
          expect(filled).toBe(cap);
        }
      }
    }
  });

  it("128-team draw is fast", () => {
    const sizes = groupSizes(128, 8);
    const gs = sizes.map((size, index) => ({ index, size, slotId: `S${index % 4}` }));
    const teams = ids(128).map((teamId, i) => ({ teamId, preferences: [`S${i % 4}`, `S${(i + 1) % 4}`] }));
    const t = performance.now();
    drawGroups(teams, gs, "speed", 1);
    expect(performance.now() - t).toBeLessThan(50);
  });
});

describe("snakeSeed", () => {
  it("snakes A,B,C then C,B,A", () => {
    const g = snakeSeed(ids(12), [4, 4, 4], "s", 1);
    expect(g.map((x) => x.teams.map((t) => t.seed))).toEqual([
      [1, 6, 7, 12],
      [2, 5, 8, 11],
      [3, 4, 9, 10],
    ]);
    expect(g[0]!.teams[0]!.teamId).toBe("t1");
    for (const x of g) expect(x.teams.map((t) => t.slotNumber).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });

  it("handles uneven sizes (larger groups first)", () => {
    const g = snakeSeed(ids(8), [3, 3, 2], "s", 3);
    expect(g.map((x) => x.teams.map((t) => t.seed))).toEqual([
      [1, 6, 7],
      [2, 5, 8],
      [3, 4],
    ]);
    expect(g[2]!.teams.map((t) => t.slotNumber).sort()).toEqual([3, 4]);
  });

  it("deterministic per seed", () => {
    expect(snakeSeed(ids(32), [16, 16], "q", 1)).toEqual(snakeSeed(ids(32), [16, 16], "q", 1));
  });
});
