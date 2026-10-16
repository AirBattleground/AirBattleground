import { format, parse, parseISO } from "date-fns";
import { addDays, weekdayOf } from "@7xen/shared";

/** "20:00" → "8:00 PM" */
export function formatTime(hhmm: string): string {
  try {
    return format(parse(hhmm, "HH:mm", new Date(2000, 0, 1)), "h:mm a");
  } catch {
    return hhmm;
  }
}

/** "2026-10-18" → "Sat, 18 Oct" */
export function formatDate(date: string, pattern = "EEE, d MMM"): string {
  return format(parseISO(date), pattern);
}

/** "Today" / "Tomorrow" / "Yesterday" / "Sat, 18 Oct" */
export function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  if (date === addDays(today, -1)) return "Yesterday";
  return formatDate(date);
}

/** "Today · 8:00 PM" */
export function whenLabel(date: string, startTime: string, today: string): string {
  return `${dayLabel(date, today)} · ${formatTime(startTime)}`;
}

export function isWeekend(date: string): boolean {
  const wd = weekdayOf(date);
  return wd === 0 || wd === 6;
}

export const pad2 = (n: number) => String(n).padStart(2, "0");

export interface Remaining {
  totalMs: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export function remaining(targetIso: string, now: number): Remaining {
  const totalMs = Math.max(0, new Date(targetIso).getTime() - now);
  const s = Math.floor(totalMs / 1000);
  return {
    totalMs,
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
  };
}

/** Compact human countdown: "2d 4h", "3h 12m", "12m 05s", "45s". */
export function shortCountdown(r: Remaining): string {
  if (r.days > 0) return `${r.days}d ${r.hours}h`;
  if (r.hours > 0) return `${r.hours}h ${pad2(r.minutes)}m`;
  if (r.minutes > 0) return `${r.minutes}m ${pad2(r.seconds)}s`;
  return `${r.seconds}s`;
}
