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

// ---------- scrim match plan ----------

/** IDP (room ID/password) goes out this many minutes before a match when the manager doesn't pick another value. */
export const DEFAULT_IDP_MINUTES = 15;
/** a scrim's matches must all start within this many minutes of match 1 */
export const MAX_MATCH_SPAN_MINUTES = 12 * 60;

const minutesOfDay = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** "HH:mm" + minutes, wrapping past midnight. */
export function addMinutesToTime(hhmm: string, minutes: number): string {
  const t = (((minutesOfDay(hhmm) + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/** Minutes after match 1 for each match's "HH:mm" start; a time earlier than the one before it is the next day. */
export function matchOffsets(times: string[]): number[] {
  const out: number[] = [];
  let day = 0;
  times.forEach((t, i) => {
    if (i > 0 && minutesOfDay(t) <= minutesOfDay(times[i - 1]!)) day += 1440;
    out.push(minutesOfDay(t) + day - minutesOfDay(times[0]!));
  });
  return out;
}

/** What's wrong with a list of match start times (null = fine). `index` = the offending match (0-based). */
export function matchTimesIssue(times: string[]): { index: number; message: string } | null {
  for (let i = 1; i < times.length; i++) {
    if (times[i] === times[i - 1]) return { index: i, message: `Match ${i + 1} starts at the same time as match ${i}` };
  }
  const offsets = matchOffsets(times);
  const last = offsets.length - 1;
  if (offsets[last]! > MAX_MATCH_SPAN_MINUTES) {
    return { index: last, message: `Match ${last + 1} is more than 12 hours after match 1 — check the times are in order` };
  }
  return null;
}

export interface ScrimPlanLike {
  maps: string[];
  startTime: string;
  matchTimes: string[];
  idpMinutes: number[];
}

/**
 * Each match of a scrim: map, "HH:mm" start and IDP minutes. Scrims saved before per-match times only have match 1's
 * time (startTime), so their later matches have startTime null.
 */
export function scrimMatchPlan(s: ScrimPlanLike): { number: number; map: string; startTime: string | null; idpMinutes: number }[] {
  const timed = s.matchTimes.length === s.maps.length;
  return s.maps.map((map, i) => ({
    number: i + 1,
    map,
    startTime: timed ? s.matchTimes[i]! : i === 0 ? s.startTime : null,
    idpMinutes: s.idpMinutes[i] ?? DEFAULT_IDP_MINUTES,
  }));
}

/** Start instant of match `number` (1-based) of a scrim's session on `date` (null = not timed). */
export function matchStartsAt(s: ScrimPlanLike, date: string, number: number): Date | null {
  const plan = scrimMatchPlan(s);
  if (!plan[number - 1]?.startTime) return null;
  const offset = s.matchTimes.length === s.maps.length ? matchOffsets(s.matchTimes)[number - 1]! : 0;
  return new Date(sessionStartsAt(date, plan[0]!.startTime!).getTime() + offset * 60_000);
}

/** When registration for a scrim's session on `date` closes: `closeMinutes` before match 1. */
export function registrationClosesAt(date: string, startTime: string, closeMinutes: number): Date {
  return new Date(sessionStartsAt(date, startTime).getTime() - closeMinutes * 60_000);
}
