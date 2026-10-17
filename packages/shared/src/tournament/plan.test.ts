import { describe, expect, it } from "vitest";
import type { ScheduleConfig } from "../phase3";
import { groupSizes, planSchedule } from "./engine";

const MAPS = ["ERANGEL", "MIRAMAR", "SANHOK", "VIKENDI"] as const;
const cfg = (p: Partial<ScheduleConfig> = {}): ScheduleConfig => ({
  startDate: "2026-10-17",
  endDate: "2026-10-31",
  windows: [{ start: "18:00", end: "23:00" }],
  excludeDates: [],
  matchMinutes: 40,
  breakMinutes: 5,
  parallelLobbies: 1,
  ...p,
});

describe("planSchedule", () => {
  it("doc example: 8 groups × 4 matches, 18:00–23:00, one lobby", () => {
    const plan = planSchedule(cfg(), groupSizes(128, 8), 4, [...MAPS]);
    expect(plan.days).toBe(8);
    expect(plan.unscheduledGroups).toEqual([]);
    const b0 = plan.blocks[0]!;
    expect(b0).toMatchObject({ groupIndex: 0, lobbyIndex: 0, date: "2026-10-17", start: "2026-10-17T18:00:00+05:30", end: "2026-10-17T20:55:00+05:30" });
    expect(b0.matches.map((m) => m.start)).toEqual([
      "2026-10-17T18:00:00+05:30",
      "2026-10-17T18:45:00+05:30",
      "2026-10-17T19:30:00+05:30",
      "2026-10-17T20:15:00+05:30",
    ]);
    expect(b0.matches.map((m) => m.map)).toEqual([...MAPS]);
    expect(plan.blocks.map((b) => b.date)).toEqual(Array.from({ length: 8 }, (_, i) => `2026-10-${17 + i}`));
    expect(plan.slotOptions).toHaveLength(8);
    expect(plan.slotOptions[0]).toEqual({
      id: "2026-10-17T18:00:00+05:30",
      date: "2026-10-17",
      start: "18:00",
      label: "Sat, 17 Oct · 6:00 PM",
      groupIndexes: [0],
      capacity: 16,
    });
    // two 175-min blocks + 5-min gap need until 23:55 → the 15-min step caps at 23:59
    expect(plan.suggestions).toContain("Extend the window to 23:59 to finish in 4 days instead of 8.");
    expect(plan.suggestions).toContain("Run 2 lobbies at the same time to finish in 4 days instead of 8.");
  });

  it("doc example with two lobbies merges parallel blocks into one slot option", () => {
    const plan = planSchedule(cfg({ parallelLobbies: 2 }), groupSizes(128, 8), 4, [...MAPS]);
    expect(plan.days).toBe(4);
    expect(plan.blocks.slice(0, 2).map((b) => [b.groupIndex, b.lobbyIndex, b.date])).toEqual([
      [0, 0, "2026-10-17"],
      [1, 1, "2026-10-17"],
    ]);
    expect(plan.slotOptions).toHaveLength(4);
    expect(plan.slotOptions[0]).toMatchObject({ groupIndexes: [0, 1], capacity: 32 });
    expect(plan.suggestions).toContain("Run 3 lobbies at the same time to finish in 3 days instead of 4.");
  });

  it("suggests the smallest window extension that saves days", () => {
    const plan = planSchedule(cfg({ windows: [{ start: "17:00", end: "22:00" }] }), groupSizes(128, 8), 4, [...MAPS]);
    expect(plan.days).toBe(8);
    expect(plan.suggestions[0]).toBe("Extend the window to 23:00 to finish in 4 days instead of 8.");
  });

  it("packs several blocks per window and uses multiple windows", () => {
    const plan = planSchedule(
      cfg({ windows: [{ start: "18:00", end: "23:00" }, { start: "12:00", end: "15:00" }], matchMinutes: 30, breakMinutes: 0 }),
      groupSizes(64, 4),
      3,
      [...MAPS],
    );
    // block = 90 min; 12:00–15:00 fits 2, 18:00–23:00 fits 3 → 5 per day
    expect(plan.days).toBe(1);
    expect(plan.blocks.map((b) => b.start.slice(11, 16))).toEqual(["12:00", "13:30", "18:00", "19:30"]);
    expect(plan.suggestions).toEqual([]);
  });

  it("skips excluded dates and reports unscheduled groups with an add-days tip", () => {
    const plan = planSchedule(
      cfg({ startDate: "2026-10-17", endDate: "2026-10-20", excludeDates: ["2026-10-18"] }),
      groupSizes(96, 6),
      4,
      [...MAPS],
    );
    expect(plan.blocks.map((b) => b.date)).toEqual(["2026-10-17", "2026-10-19", "2026-10-20"]);
    expect(plan.unscheduledGroups).toEqual([3, 4, 5]);
    expect(plan.days).toBe(3);
    expect(plan.suggestions).toContain("Add 3 more days (end on 2026-10-23) to fit the remaining 3 groups.");
    expect(plan.suggestions).toContain("Run 2 lobbies at the same time to fit every group in 3 days.");
  });

  it("explains when a group can never fit a window and never suggests useless days", () => {
    const plan = planSchedule(cfg({ windows: [{ start: "20:00", end: "21:00" }], endDate: "2026-10-18" }), [16, 16], 4, [...MAPS]);
    expect(plan.blocks).toEqual([]);
    expect(plan.unscheduledGroups).toEqual([0, 1]);
    expect(plan.suggestions.some((s) => /more day/.test(s))).toBe(false);
    expect(plan.suggestions.some((s) => /lobbies/.test(s))).toBe(false);
    expect(plan.suggestions).toContain("Each group needs 2h 55m in one go, but the longest window is 1h. Make a window longer or play fewer matches.");
  });

  it("no suggestions when everything fits in one day", () => {
    const plan = planSchedule(cfg(), [16], 4, [...MAPS]);
    expect(plan.days).toBe(1);
    expect(plan.suggestions).toEqual([]);
  });

  it("is fast for 1024 teams", () => {
    const t = performance.now();
    const plan = planSchedule(cfg({ endDate: "2026-12-31" }), groupSizes(1024, 64), 4, [...MAPS]);
    expect(plan.unscheduledGroups).toEqual([]);
    expect(plan.days).toBe(64);
    expect(performance.now() - t).toBeLessThan(200);
  });

  it("PM/AM labels", () => {
    const plan = planSchedule(cfg({ windows: [{ start: "09:30", end: "12:30" }] }), [10], 1, ["ERANGEL"]);
    expect(plan.slotOptions[0]!.label).toBe("Sat, 17 Oct · 9:30 AM");
    const noon = planSchedule(cfg({ windows: [{ start: "12:00", end: "13:00" }] }), [10], 1, ["ERANGEL"]);
    expect(noon.slotOptions[0]!.label).toBe("Sat, 17 Oct · 12:00 PM");
  });
});
