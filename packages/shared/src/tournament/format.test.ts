import { describe, expect, it } from "vitest";
import { stageSpecSchema, MAX_STAGES, type StageSpec } from "../phase3";
import { groupName, groupSizes, suggestFormat, teamsOut, validateFormat } from "./engine";

const errors = (stages: StageSpec[], max: number) => validateFormat(stages, max).filter((i) => i.level === "error");

function stage(p: Partial<StageSpec>): StageSpec {
  const matches = p.matchesPerGroup ?? 4;
  return {
    name: "Qualifier",
    teamsIn: 128,
    lobbySize: 16,
    groupCount: 8,
    matchesPerGroup: matches,
    maps: Array.from({ length: matches }, () => "ERANGEL" as const),
    advancePerGroup: 4,
    wildcardCount: 0,
    invitedSlots: 0,
    schedule: null,
    ...p,
  };
}

const worked = (): StageSpec[] => [
  stage({ name: "Qualifier", teamsIn: 128, groupCount: 8, advancePerGroup: 4 }),
  stage({ name: "Semi-final", teamsIn: 32, groupCount: 2, advancePerGroup: 8, matchesPerGroup: 6 }),
  stage({ name: "Final", teamsIn: 16, groupCount: 1, advancePerGroup: 0, matchesPerGroup: 6 }),
];

describe("groupSizes", () => {
  it("balances and puts larger groups first", () => {
    expect(groupSizes(128, 8)).toEqual(Array(8).fill(16));
    expect(groupSizes(100, 7)).toEqual([15, 15, 14, 14, 14, 14, 14]);
    expect(groupSizes(5, 0)).toEqual([]);
    expect(groupSizes(3, 5)).toEqual([1, 1, 1, 0, 0]);
  });
  it("invariants over a range", () => {
    for (let t = 0; t <= 1024; t++) {
      for (let g = 1; g <= 64; g++) {
        const s = groupSizes(t, g);
        const ok =
          s.length === g &&
          s.reduce((a, b) => a + b, 0) === t &&
          Math.max(...s) - Math.min(...s) <= 1 &&
          s.every((x, i) => i === 0 || x <= s[i - 1]!);
        if (!ok) throw new Error(`groupSizes(${t}, ${g}) = ${s}`);
      }
    }
  });
});

describe("groupName", () => {
  it("letters then double letters", () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(groupName)).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"]);
  });
});

describe("teamsOut", () => {
  it("is 0 for the last stage", () => {
    const s = worked();
    expect(teamsOut(s[0]!, false)).toBe(32);
    expect(teamsOut({ ...s[1]!, wildcardCount: 2 }, false)).toBe(18);
    expect(teamsOut(s[2]!, true)).toBe(0);
  });
});

describe("validateFormat", () => {
  it("accepts the worked example (only the missing-schedule warning)", () => {
    const issues = validateFormat(worked(), 128);
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toMatch(/no schedule/);
  });

  it("explains a broken flow rule with the numbers", () => {
    const s = worked();
    s[0]!.advancePerGroup = 3;
    const e = errors(s, 128);
    expect(e).toHaveLength(1);
    expect(e[0]!.stage).toBe(1);
    expect(e[0]!.message).toBe("Semi-final expects 32 teams but the Qualifier sends 24 (8 groups × top 3).");
  });

  it("mentions wildcards and invited teams in flow messages", () => {
    const s = worked();
    s[0]!.advancePerGroup = 3;
    s[0]!.wildcardCount = 2;
    s[1]!.invitedSlots = 4;
    expect(errors(s, 128)[0]!.message).toBe(
      "Semi-final expects 32 teams but the Qualifier sends 26 (8 groups × top 3 + 2 wildcards), plus 4 invited teams makes 30.",
    );
  });

  it("flags every structural error", () => {
    const msgs = (s: StageSpec[], max = 128) => errors(s, max).map((e) => e.message).join("\n");
    expect(msgs(worked(), 120)).toMatch(/Qualifier is set for 128 teams but the tournament takes 120 teams/);
    const a = worked();
    a[0]!.groupCount = 7;
    expect(msgs(a)).toMatch(/only room for 112 \(7 groups × 16\)/);
    const b = [stage({ name: "Final", teamsIn: 3, groupCount: 4, advancePerGroup: 0 })];
    expect(msgs(b, 3)).toMatch(/more groups \(4\) than teams \(3\)/);
    const c = worked();
    c[1]!.maps = ["ERANGEL"];
    expect(msgs(c)).toMatch(/plays 6 matches per group but has 1 map/);
    const d = [stage({ teamsIn: 20, groupCount: 4, advancePerGroup: 6 }), stage({ name: "Final", teamsIn: 24, groupCount: 2, advancePerGroup: 0 })];
    expect(msgs(d, 20)).toMatch(/top 6 can't advance from groups of only 5 teams/);
    const e = [stage({ teamsIn: 20, groupCount: 4, advancePerGroup: 4, wildcardCount: 5 }), stage({ name: "Final", teamsIn: 21, groupCount: 2, advancePerGroup: 0 })];
    expect(msgs(e, 20)).toMatch(/5 wildcards but only 4 teams miss out/);
    const f = worked();
    f[0]!.invitedSlots = 2;
    expect(msgs(f)).toMatch(/first stage, so it can't have invited teams/);
    const g = worked();
    g[2]!.advancePerGroup = 2;
    expect(msgs(g)).toMatch(/last stage, so no teams can advance/);
    const h = worked();
    h[2]!.lobbySize = 26;
    expect(msgs(h)).toMatch(/at most 25 teams/);
    expect(errors([], 10)[0]!.message).toMatch(/at least one stage/);
  });

  it("warnings", () => {
    const w = (s: StageSpec[], max: number) => validateFormat(s, max).filter((i) => i.level === "warning").map((i) => i.message).join("\n");
    const a = worked();
    a[2] = stage({ name: "Final", teamsIn: 16, groupCount: 2, advancePerGroup: 0, matchesPerGroup: 6 });
    expect(w(a, 128)).toMatch(/Final has 2 groups/);
    const b = [stage({ teamsIn: 40, groupCount: 8, advancePerGroup: 2 }), stage({ name: "Final", teamsIn: 16, groupCount: 1, advancePerGroup: 0 })];
    expect(w(b, 40)).toMatch(/groups of 5 fill less than half/);
    const c = [stage({ teamsIn: 32, groupCount: 4, advancePerGroup: 8 }), stage({ name: "Final", teamsIn: 32, lobbySize: 25, groupCount: 2, advancePerGroup: 0 })];
    expect(w(c, 32)).toMatch(/nobody is eliminated/);
  });
});

describe("suggestFormat", () => {
  it("matches the presets", () => {
    const f16 = suggestFormat({ totalTeams: 16 });
    expect(f16.map((s) => s.name)).toEqual(["Final"]);
    expect(f16[0]!.matchesPerGroup).toBe(6);
    expect(f16[0]!.maps).toEqual(["ERANGEL", "MIRAMAR", "SANHOK", "ERANGEL", "VIKENDI", "MIRAMAR"]);

    const f64 = suggestFormat({ totalTeams: 64 });
    expect(f64.map((s) => [s.name, s.teamsIn, s.groupCount, s.advancePerGroup, s.wildcardCount])).toEqual([
      ["Qualifier", 64, 4, 4, 0],
      ["Final", 16, 1, 0, 0],
    ]);

    const f128 = suggestFormat({ totalTeams: 128 });
    expect(f128.map((s) => [s.name, s.teamsIn, s.groupCount, s.advancePerGroup, s.matchesPerGroup])).toEqual([
      ["Qualifier", 128, 8, 4, 4],
      ["Semi-final", 32, 2, 8, 6],
      ["Final", 16, 1, 0, 6],
    ]);

    const f1024 = suggestFormat({ totalTeams: 1024 });
    expect(f1024.map((s) => s.name)).toEqual(["Qualifier", "Round 1", "Quarter-final", "Semi-final", "Final"]);
    expect(f1024[0]!.schedule).toBeNull();
  });

  it("uses wildcards only when the numbers need them", () => {
    const f96 = suggestFormat({ totalTeams: 96 });
    expect(f96[0]).toMatchObject({ groupCount: 6, advancePerGroup: 5, wildcardCount: 2 });
    expect(suggestFormat({ totalTeams: 48 })[0]).toMatchObject({ groupCount: 3, advancePerGroup: 5, wildcardCount: 1 });
    expect(suggestFormat({ totalTeams: 32 })[0]).toMatchObject({ groupCount: 2, advancePerGroup: 8, wildcardCount: 0 });
  });

  it("uses given maps", () => {
    const f = suggestFormat({ totalTeams: 10, maps: ["LIVIK", "NUSA"] });
    expect(f[0]!.maps).toEqual(["LIVIK", "NUSA", "LIVIK", "NUSA", "LIVIK", "NUSA"]);
  });

  it("passes validation for every team count 2..1024 and lobby size 2..25", () => {
    let checked = 0;
    for (let lobby = 2; lobby <= 25; lobby++) {
      for (let total = 2; total <= 1024; total++) {
        const f = suggestFormat({ totalTeams: total, lobbySize: lobby });
        const e = errors(f, total);
        if (e.length) throw new Error(`total=${total} lobby=${lobby}: ${e.map((x) => x.message).join(" | ")}`);
        const last = f[f.length - 1]!;
        expect(last.groupCount).toBe(1);
        expect(last.teamsIn).toBe(Math.min(total, lobby));
        checked++;
      }
    }
    expect(checked).toBe(24 * 1023);
  });

  it("standard lobby sizes stay within 6 stages and never warn about elimination", () => {
    for (const lobby of [12, 16, 20, 25]) {
      for (let total = 2; total <= 1024; total++) {
        const f = suggestFormat({ totalTeams: total, lobbySize: lobby });
        expect(f.length).toBeLessThanOrEqual(6);
        const warns = validateFormat(f, total).filter((i) => i.level === "warning" && /nobody is eliminated/.test(i.message));
        expect(warns).toEqual([]);
      }
    }
  });

  it("fits the input schema (≤ 6 stages, ≤ 128 groups) for lobby sizes 8..25", () => {
    for (let lobby = 8; lobby <= 25; lobby++) {
      for (let total = 2; total <= 1024; total += 7) {
        const f = suggestFormat({ totalTeams: total, lobbySize: lobby });
        expect(f.length).toBeLessThanOrEqual(MAX_STAGES);
        for (const st of f) expect(stageSpecSchema.safeParse(st).success).toBe(true);
      }
    }
  });
});
