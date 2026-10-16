import type { Recurrence } from "./enums";

/**
 * All scheduling is done in a single app timezone (IST). Dates travel as "YYYY-MM-DD"
 * strings and times as "HH:mm" strings so nothing shifts across client timezones.
 */
export const APP_TIMEZONE = "Asia/Kolkata";
export const APP_TZ_OFFSET = "+05:30";

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD string (timezone independent). */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Today's date in the app timezone. */
export function todayInAppTz(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export interface ScheduleLike {
  recurrence: Recurrence;
  startDate: string;
  endDate: string | null;
}

/** Does a scrim with this schedule run on `date`? */
export function occursOn(s: ScheduleLike, date: string): boolean {
  if (date < s.startDate) return false;
  if (s.recurrence === "ONCE") return date === s.startDate;
  if (s.endDate && date > s.endDate) return false;
  if (s.recurrence === "DAILY") return true;
  const wd = weekdayOf(date);
  return wd === 0 || wd === 6;
}

/** Absolute instant a session starts (date + "HH:mm" in IST). */
export function sessionStartsAt(date: string, startTime: string): Date {
  return new Date(`${date}T${startTime}:00${APP_TZ_OFFSET}`);
}

/** Slot numbers a scrim offers, e.g. firstSlot 3, slotCount 4 → [3,4,5,6]. */
export function slotRange(firstSlot: number, slotCount: number): number[] {
  return Array.from({ length: slotCount }, (_, i) => firstSlot + i);
}

/** Normalised key used to enforce case/space-insensitive unique team names. */
export function teamNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}
