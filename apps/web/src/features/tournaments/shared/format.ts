import { addDays, APP_TIMEZONE, todayInAppTz } from "@7xen/shared";

/** Tournament times are ISO instants; always display them in IST (the app timezone). */
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: APP_TIMEZONE, hour: "numeric", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: APP_TIMEZONE, weekday: "short", day: "numeric", month: "short" });
const shortDayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: APP_TIMEZONE, day: "numeric", month: "short" });

const valid = (iso: string | null | undefined): iso is string => !!iso && !Number.isNaN(new Date(iso).getTime());

/** ISO instant → "YYYY-MM-DD" in IST. */
export function istDateKey(iso: string): string {
  return dayKeyFmt.format(new Date(iso));
}

/** "6:00 PM" */
export function fmtTime(iso: string | null | undefined): string {
  return valid(iso) ? timeFmt.format(new Date(iso)) : "—";
}

/** "Sat, 18 Oct" */
export function fmtDay(iso: string | null | undefined): string {
  if (!valid(iso)) return "TBA";
  const parts = Object.fromEntries(dayFmt.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${parts.weekday}, ${parts.day} ${parts.month}`;
}

/** "18 Oct" */
export function fmtShortDay(iso: string | null | undefined): string {
  return valid(iso) ? shortDayFmt.format(new Date(iso)) : "TBA";
}

/** "Today" / "Tomorrow" / "Sat, 18 Oct" */
export function relDay(iso: string | null | undefined): string {
  if (!valid(iso)) return "TBA";
  const key = istDateKey(iso);
  const today = todayInAppTz();
  if (key === today) return "Today";
  if (key === addDays(today, 1)) return "Tomorrow";
  if (key === addDays(today, -1)) return "Yesterday";
  return fmtDay(iso);
}

/** "Today · 6:00 PM" */
export function fmtWhen(iso: string | null | undefined): string {
  return valid(iso) ? `${relDay(iso)} · ${fmtTime(iso)}` : "Time to be announced";
}

/** "18 Oct – 20 Oct" (or a single day) */
export function fmtRange(from: string | null | undefined, to: string | null | undefined): string {
  if (!valid(from)) return "Dates TBA";
  if (!valid(to) || istDateKey(from) === istDateKey(to)) return fmtDay(from);
  return `${fmtShortDay(from)} – ${fmtShortDay(to)}`;
}

/** Prize as entered; a bare number ("10000") reads as rupees ("₹10,000"). */
export function fmtPrize(prize: string): string {
  const p = prize.trim();
  return /^\d+$/.test(p) ? `₹${Number(p).toLocaleString("en-IN")}` : p;
}

export const slot2 = (n: number) => `#${String(n).padStart(2, "0")}`;

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** 0 → "A", 25 → "Z", 26 → "AA" */
export function groupLetter(index: number): string {
  let s = "";
  let n = index;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}
