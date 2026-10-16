import { format, formatDistanceToNowStrict, parseISO } from "date-fns";
import {
  addDays,
  MAP_LABELS,
  occursOn,
  todayInAppTz,
  weekdayOf,
  type GameMap,
  type Recurrence,
  type ScheduleLike,
} from "@7xen/shared";

/** "20:00" → "8:00 PM" */
export function formatTime(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** "2026-10-18" → "Sat, 18 Oct" */
export function formatDate(date: string): string {
  return format(parseISO(date), "EEE, d MMM");
}

/** "2026-10-18" → "18 Oct" */
export function formatShortDate(date: string): string {
  return format(parseISO(date), "d MMM");
}

/** Local Date (from the calendar) → "YYYY-MM-DD" */
export function toDateString(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

/** "YYYY-MM-DD" → local Date at midnight (for the calendar) */
export function fromDateString(s: string): Date {
  return parseISO(s);
}

export function isWeekend(date: string): boolean {
  const wd = weekdayOf(date);
  return wd === 0 || wd === 6;
}

export function timeAgo(iso: string): string {
  return `${formatDistanceToNowStrict(new Date(iso))} ago`;
}

export function slotLabel(n: number): string {
  return `#${String(n).padStart(2, "0")}`;
}

/** "16 slots (#3–#18)" */
export function slotRangeLabel(firstSlot: number, slotCount: number): string {
  return `${slotCount} slots (#${firstSlot}–#${firstSlot + slotCount - 1})`;
}

/** "Daily · 6:00 PM" / "Sat & Sun · 8:00 PM" / "Once · Sat, 18 Oct" */
export function recurrenceLabel(s: { recurrence: Recurrence; startTime: string; startDate: string }): string {
  const t = formatTime(s.startTime);
  if (s.recurrence === "ONCE") return `Once · ${formatDate(s.startDate)} · ${t}`;
  if (s.recurrence === "DAILY") return `Daily · ${t}`;
  return `Sat & Sun · ${t}`;
}

export function dateRangeLabel(s: { recurrence: Recurrence; startDate: string; endDate: string | null }): string {
  if (s.recurrence === "ONCE") return formatDate(s.startDate);
  return s.endDate ? `${formatDate(s.startDate)} → ${formatDate(s.endDate)}` : `From ${formatDate(s.startDate)} · no end date`;
}

/** Plain-English summary used on the scrim form. */
export function scheduleSummary(s: {
  recurrence: Recurrence;
  startDate?: string;
  endDate?: string | null;
  startTime?: string;
}): string {
  const t = s.startTime ? `${formatTime(s.startTime)} IST` : "a time you pick";
  if (!s.startDate) return "Pick a start date to see when this scrim runs.";
  const from = formatShortDate(s.startDate);
  if (s.recurrence === "ONCE") return `Runs once on ${formatDate(s.startDate)} at ${t}.`;
  const when = s.recurrence === "DAILY" ? "every day" : "every Saturday and Sunday";
  const until = s.endDate ? `until ${formatShortDate(s.endDate)}` : "no end date";
  return `Runs ${when} at ${t} from ${from}, ${until}.`;
}

/** Next `count` dates on/after `from` that the schedule runs (bounded search). */
export function nextOccurrences(s: ScheduleLike, from: string, count: number, maxDays = 400): string[] {
  const out: string[] = [];
  let d = from < s.startDate ? s.startDate : from;
  for (let i = 0; i < maxDays && out.length < count; i++) {
    if (s.endDate && s.recurrence !== "ONCE" && d > s.endDate) break;
    if (s.recurrence === "ONCE" && d > s.startDate) break;
    if (occursOn(s, d)) out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

/** The date to show by default for a scrim: next occurrence from today, else its last one. */
export function defaultOccurrence(s: ScheduleLike): string {
  const next = nextOccurrences(s, todayInAppTz(), 1)[0];
  if (next) return next;
  if (s.recurrence === "ONCE") return s.startDate;
  if (s.endDate) {
    let d = s.endDate;
    for (let i = 0; i < 7; i++) {
      if (occursOn(s, d)) return d;
      d = addDays(d, -1);
    }
  }
  return s.startDate;
}

export function mapsLabel(maps: GameMap[]): string {
  return maps.map((m) => MAP_LABELS[m]).join(", ");
}

/** "2h 15m" style countdown; null if the time has passed. */
export function countdown(to: string | Date, now: number): string | null {
  const ms = new Date(to).getTime() - now;
  if (ms <= 0) return null;
  const mins = Math.floor(ms / 60_000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return "under a minute";
}
