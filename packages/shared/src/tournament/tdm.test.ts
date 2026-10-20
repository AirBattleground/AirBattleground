import { describe, expect, it } from "vitest";
import { bracketPairs, tdmFinishTime, tdmFormatError, tdmRoundName, tdmStages } from "./tdm";
import { validateFormat } from "./format";
import { planSchedule } from "./plan";

describe("tdm", () => {
  it("names rounds", () => {
    expect([64, 32, 16, 8, 4, 2].map(tdmRoundName)).toEqual(["Round of 64", "Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"]);
  });

  it("builds a 4-team bracket: two semi-finals then a final", () => {
    const s = tdmStages({ teams: 4, bestOf: 1, maps: ["WAREHOUSE"], date: "2026-10-25", startTime: "19:00", parallel: 2 });
    expect(s.map((x) => [x.name, x.teamsIn, x.groupCount, x.lobbySize, x.advancePerGroup])).toEqual([
      ["Semi-finals", 4, 2, 2, 1],
      ["Final", 2, 1, 2, 0],
    ]);
    expect(tdmFormatError(s, 4)).toBeNull();
    expect(validateFormat(s, 4).filter((i) => i.level === "error")).toEqual([]);
  });

  it("schedules every round so all its matches fit, rounds one after another", () => {
    let checked = 0;
    for (const teams of [4, 8, 16, 32, 64]) {
      for (const bestOf of [1, 3, 5]) {
        const input = { teams, bestOf, maps: ["WAREHOUSE", "HANGAR"] as const, date: "2026-10-25", startTime: "12:00", parallel: 4 };
        if (!tdmFinishTime(input)) continue; // runs past midnight: the wizard blocks this
        checked++;
        const stages = tdmStages({ ...input, maps: [...input.maps] });
        expect(tdmFormatError(stages, teams)).toBeNull();
        let prevEnd = "";
        for (const st of stages) {
          const plan = planSchedule(st.schedule!, Array.from({ length: st.groupCount }, () => 2), st.matchesPerGroup, st.maps);
          expect(plan.unscheduledGroups).toEqual([]);
          expect(st.schedule!.windows[0]!.start > prevEnd).toBe(true);
          prevEnd = st.schedule!.windows[0]!.end;
        }
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("finish time: 4 teams best-of-1 from 19:00 with 2 rooms; 64 teams best-of-5 from 20:00 doesn't fit", () => {
    // semis together 19:00–19:10, final 19:20–19:30
    expect(tdmFinishTime({ teams: 4, bestOf: 1, startTime: "19:00", parallel: 2 })).toBe("19:30");
    expect(tdmFinishTime({ teams: 64, bestOf: 5, startTime: "20:00", parallel: 1 })).toBeNull();
  });

  it("rejects non-knockout formats", () => {
    const s = tdmStages({ teams: 8, bestOf: 1, maps: ["RUINS"], date: null, startTime: "19:00", parallel: 1 });
    expect(tdmFormatError(s, 6)).toMatch(/takes/);
    expect(tdmFormatError([{ ...s[0]!, lobbySize: 4 }, ...s.slice(1)], 8)).toMatch(/knockout/);
    expect(tdmFormatError(s.slice(0, 2), 8)).not.toBeNull();
  });

  it("pairs winners in bracket order", () => {
    const g = bracketPairs(["a", "b", "c", "d"], "seed", 1);
    expect(g.map((x) => x.teams.map((t) => t.teamId))).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(g[0]!.teams.map((t) => t.slotNumber).sort()).toEqual([1, 2]);
    // a group nobody won leaves its neighbour alone
    expect(bracketPairs(["a", null], "s", 1)[0]!.teams.map((t) => t.teamId)).toEqual(["a"]);
  });
});
