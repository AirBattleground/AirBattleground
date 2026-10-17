import type { LiveMatchCard } from "@7xen/shared";
import { compactSpan, formatBytes, formatCountdown, formatDay, formatElapsed, formatTime, percent, revealLabel, revealMinutesBefore, roomShareText, slotRangeLabel } from "@/lib/format";

// tests run in the machine's zone; build ISO strings from local dates
const local = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi).toISOString();

describe("time formatting", () => {
  it("formats 12-hour times", () => {
    expect(formatTime(local(2026, 10, 17, 19, 5))).toBe("7:05 PM");
    expect(formatTime(local(2026, 10, 17, 0, 30))).toBe("12:30 AM");
    expect(formatTime(local(2026, 10, 17, 12, 0))).toBe("12:00 PM");
    expect(formatTime(null)).toBe("Time not set");
  });
  it("names days relative to today", () => {
    const now = new Date(2026, 9, 17, 10, 0);
    expect(formatDay(local(2026, 10, 17, 23, 0), now)).toBe("Today");
    expect(formatDay(local(2026, 10, 18, 1, 0), now)).toBe("Tomorrow");
    expect(formatDay(local(2026, 10, 20, 1, 0), now)).toBe("Tue, 20 Oct");
  });
  it("counts down and up", () => {
    const now = Date.parse("2026-10-17T10:00:00Z");
    expect(formatCountdown("2026-10-17T10:12:00Z", now)).toBe("in 12m");
    expect(formatCountdown("2026-10-17T11:05:00Z", now)).toBe("in 1h 05m");
    expect(formatCountdown("2026-10-19T13:00:00Z", now)).toBe("in 2d 3h");
    expect(formatCountdown("2026-10-17T09:55:00Z", now)).toBe("started 5m ago");
    expect(formatCountdown("2026-10-17T10:00:10Z", now)).toBe("starting now");
    expect(formatCountdown(null, now)).toBeNull();
    expect(compactSpan(45_000)).toBe("45s");
  });
  it("formats elapsed stopwatch time", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(247_000)).toBe("4:07");
    expect(formatElapsed(3_729_000)).toBe("1:02:09");
  });
});

describe("numbers", () => {
  it("formats bytes", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(812 * 1024)).toBe("812 KB");
    expect(formatBytes(312.4 * 1024 * 1024)).toBe("312.4 MB");
    expect(formatBytes(1.25 * 1024 ** 3)).toBe("1.25 GB");
  });
  it("computes safe percentages", () => {
    expect(percent(5, 0)).toBe(0);
    expect(percent(50, 200)).toBe(25);
    expect(percent(300, 200)).toBe(100);
  });
  it("labels slot ranges", () => {
    expect(slotRangeLabel({ first: 3, last: 20 })).toBe("Slots 3–20");
    expect(slotRangeLabel({ first: 5, last: 5 })).toBe("Slot 5");
  });
});

describe("room", () => {
  const card = { title: "Daily Evening Showdown", subtitle: "", number: 2, map: "ERANGEL", startsAt: local(2026, 10, 17, 19, 30), slotRange: { first: 3, last: 20 } } as unknown as LiveMatchCard;
  it("builds a WhatsApp-ready message", () => {
    const text = roomShareText(card, { roomId: "4417302", password: "7xen" });
    expect(text).toContain("*7XEN · Daily Evening Showdown*");
    expect(text).toContain("Match 2 · Erangel");
    expect(text).toContain("7:30 PM");
    expect(text).toContain("Room ID: *4417302*");
    expect(text).toContain("Password: *7xen*");
    expect(text).toContain("Slots 3–20");
  });
  it("derives reveal minutes for the editor", () => {
    const startsAt = "2026-10-17T14:00:00Z";
    expect(revealMinutesBefore(null, startsAt)).toBe(15);
    expect(revealMinutesBefore({ roomId: "1", password: "p", revealAt: null, updatedAt: "" }, startsAt)).toBeNull();
    expect(revealMinutesBefore({ roomId: "1", password: "p", revealAt: "2026-10-17T13:30:00Z", updatedAt: "" }, startsAt)).toBe(30);
  });
  it("describes when teams see the room", () => {
    const now = Date.parse("2026-10-17T13:00:00Z");
    expect(revealLabel(null, now)).toBe("Not set");
    expect(revealLabel({ roomId: "1", password: "p", revealAt: "2026-10-17T12:00:00Z", updatedAt: "" }, now)).toBe("Teams can see it now");
    expect(revealLabel({ roomId: "1", password: "p", revealAt: "2026-10-17T13:45:00Z", updatedAt: "" }, now)).toMatch(/^Teams see it at .* \(in 45m\)$/);
  });
});
