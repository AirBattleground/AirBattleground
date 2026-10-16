import { describe, expect, it } from "vitest";
import { addDays, occursOn, slotRange, teamNameKey, weekdayOf } from "./schedule";

describe("schedule", () => {
  it("weekday", () => {
    expect(weekdayOf("2026-10-17")).toBe(6); // Saturday
    expect(weekdayOf("2026-10-18")).toBe(0);
  });
  it("occursOn", () => {
    const once = { recurrence: "ONCE" as const, startDate: "2026-10-17", endDate: null };
    expect(occursOn(once, "2026-10-17")).toBe(true);
    expect(occursOn(once, "2026-10-18")).toBe(false);
    const wk = { recurrence: "WEEKENDS" as const, startDate: "2026-10-16", endDate: "2026-10-31" };
    expect(occursOn(wk, "2026-10-16")).toBe(false);
    expect(occursOn(wk, "2026-10-17")).toBe(true);
    expect(occursOn(wk, "2026-11-01")).toBe(false);
    const daily = { recurrence: "DAILY" as const, startDate: "2026-10-16", endDate: null };
    expect(occursOn(daily, "2027-01-01")).toBe(true);
    expect(occursOn(daily, "2026-10-15")).toBe(false);
  });
  it("helpers", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(slotRange(3, 3)).toEqual([3, 4, 5]);
    expect(teamNameKey("  Team   Soul ")).toBe("team soul");
  });
});
