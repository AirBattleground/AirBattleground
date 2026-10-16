import { describe, expect, it } from "vitest";
import { computeStandings, DEFAULT_POINTS_SYSTEM as PS, matchPoints } from "./points";

describe("points", () => {
  it("match points", () => {
    expect(matchPoints(PS, 1, 13)).toEqual({ placementPoints: 10, killPoints: 13, totalPoints: 23 });
    expect(matchPoints(PS, 8, 0).totalPoints).toBe(1);
    expect(matchPoints(PS, 9, 4).totalPoints).toBe(4);
  });
  it("standings with tie-breakers", () => {
    const rows = computeStandings(PS, [
      { teamId: "a", matchNumber: 1, placement: 1, kills: 2 }, // 12
      { teamId: "b", matchNumber: 1, placement: 2, kills: 6 }, // 12, 0 wins
      { teamId: "c", matchNumber: 1, placement: 3, kills: 0 }, // 5
      { teamId: "c", matchNumber: 2, placement: 4, kills: 3 }, // 7 → 12, 0 wins, fewer placement pts? 9 vs b 6
    ]);
    expect(rows.map((r) => [r.teamId, r.rank, r.totalPoints])).toEqual([
      ["a", 1, 12],
      ["c", 2, 12],
      ["b", 3, 12],
    ]);
    expect(rows[0]).toMatchObject({ wins: 1, matchesPlayed: 1, lastPlacement: 1 });
  });
  it("full ties share a rank", () => {
    const rows = computeStandings(PS, [
      { teamId: "x", matchNumber: 1, placement: 9, kills: 1 },
      { teamId: "y", matchNumber: 1, placement: 9, kills: 1 },
    ]);
    expect(rows.map((r) => r.rank)).toEqual([1, 1]);
  });
});
