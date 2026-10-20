import { useMemo } from "react";
import { format, parse, parseISO } from "date-fns";
import { hi as dfHi } from "date-fns/locale";
import { addDays, weekdayOf, type Language } from "@7xen/shared";
import { useLocale } from "@/i18n/core";

const DAY_WORDS: Record<Language, { today: string; tomorrow: string; yesterday: string }> = {
  en: { today: "Today", tomorrow: "Tomorrow", yesterday: "Yesterday" },
  // "कल" means both tomorrow and yesterday in Hindi, so yesterday shows the plain date instead
  hi: { today: "आज", tomorrow: "कल", yesterday: "" },
  hinglish: { today: "Aaj", tomorrow: "Kal", yesterday: "" },
};

/** "20:00" → "8:00 PM" */
export function formatTime(hhmm: string): string {
  try {
    return format(parse(hhmm, "HH:mm", new Date(2000, 0, 1)), "h:mm a");
  } catch {
    return hhmm;
  }
}

/** "2026-10-18" → "Sat, 18 Oct" (Hindi day/month names when lang is "hi") */
export function formatDate(date: string, pattern = "EEE, d MMM", lang: Language = "en"): string {
  return format(parseISO(date), pattern, lang === "hi" ? { locale: dfHi } : undefined);
}

/** "Today" / "Tomorrow" / "Yesterday" / "Sat, 18 Oct" */
export function dayLabel(date: string, today: string, lang: Language = "en"): string {
  const w = DAY_WORDS[lang];
  if (date === today) return w.today;
  if (date === addDays(today, 1)) return w.tomorrow;
  if (w.yesterday && date === addDays(today, -1)) return w.yesterday;
  return formatDate(date, undefined, lang);
}

/** "Today · 8:00 PM" */
export function whenLabel(date: string, startTime: string, today: string, lang: Language = "en"): string {
  return `${dayLabel(date, today, lang)} · ${formatTime(startTime)}`;
}

/** Date helpers bound to the current portal language. */
export function useDayFormat() {
  const { lang } = useLocale();
  return useMemo(
    () => ({
      lang,
      formatDate: (date: string, pattern = "EEE, d MMM") => formatDate(date, pattern, lang),
      dayLabel: (date: string, today: string) => dayLabel(date, today, lang),
      whenLabel: (date: string, startTime: string, today: string) => whenLabel(date, startTime, today, lang),
    }),
    [lang],
  );
}

export function isWeekend(date: string): boolean {
  const wd = weekdayOf(date);
  return wd === 0 || wd === 6;
}

export const pad2 = (n: number) => String(n).padStart(2, "0");

interface Remaining {
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
