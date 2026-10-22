import { describe, expect, it } from "vitest";
import { computePlayerStats, gradeFor, MIN_RATED_MATCHES, type PlayerMatchRow } from "./playerStats";

const row = (i: number, placement: number | null, kills: number | null, teamKills: number | null = 8, map = "ERANGEL"): PlayerMatchRow => ({
  matchId: `m${i}`,
  playedAt: new Date(Date.UTC(2026, 9, 1 + i)).toISOString(),
  map,
  kind: "SCRIM",
  eventTitle: "Daily",
  teamName: "Team Soul",
  placement,
  kills,
  teamKills,
  teamPoints: 10,
});

describe("computePlayerStats", () => {
  it("is empty and unrated with no matches", () => {
    const s = computePlayerStats([]);
    expect(s).toMatchObject({ matches: 0, kills: 0, killsPerMatch: 0, winRate: 0, avgPlacement: null, killShare: null, best: null, rating: null, grade: null });
    expect(s.recent).toEqual([]);
  });

  it("counts wins, top 5, kills, kill share and averages", () => {
    const s = computePlayerStats([row(1, 1, 4), row(2, 3, 2), row(3, 10, 0), row(4, null, 2, null)]);
    expect(s.matches).toBe(4);
    expect(s.wins).toBe(1);
    expect(s.top5).toBe(2);
    expect(s.kills).toBe(8);
    expect(s.killsPerMatch).toBe(2);
    expect(s.winRate).toBeCloseTo(1 / 3);
    expect(s.avgPlacement).toBe(4.7);
    // kill share only over matches with team kills: 6 of 24
    expect(s.killShare).toBeCloseTo(0.25);
    expect(s.best?.matchId).toBe("m1");
    expect(s.rating).toBeNull();
  });

  it("rates from MIN_RATED_MATCHES and keeps recent newest first", () => {
    const rows = Array.from({ length: MIN_RATED_MATCHES + 7 }, (_, i) => row(i, (i % 6) + 1, i % 4, 10, i % 2 ? "MIRAMAR" : "ERANGEL"));
    const s = computePlayerStats(rows);
    expect(s.rating).not.toBeNull();
    expect(s.grade).toBe(gradeFor(s.rating!));
    expect(s.recent).toHaveLength(10);
    expect(s.recent[0]!.matchId).toBe(`m${rows.length - 1}`);
    expect(s.trend.at(-1)!.playedAt).toBe(rows.at(-1)!.playedAt);
    expect(s.maps.map((m) => m.map).sort()).toEqual(["ERANGEL", "MIRAMAR"]);
    for (const v of Object.values(s.radar)) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(100);
  });

  it("grades by rating bands", () => {
    expect([95, 85, 72, 60, 45, 10].map(gradeFor)).toEqual(["SS", "S", "A", "B", "C", "D"]);
  });
});
