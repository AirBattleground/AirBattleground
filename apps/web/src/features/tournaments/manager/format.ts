import { APP_TIMEZONE, APP_TZ_OFFSET } from "@7xen/shared";
import { formatDate, formatTime } from "@/features/manager/format";

const dateFmt = new Intl.DateTimeFormat("en-GB", { timeZone: APP_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: APP_TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** ISO instant → { date: "YYYY-MM-DD", time: "HH:mm" } in IST. */
export function istParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const [dd, mm, yyyy] = dateFmt.format(d).split("/");
  return { date: `${yyyy}-${mm}-${dd}`, time: timeFmt.format(d) };
}

/** "YYYY-MM-DD" + "HH:mm" (IST) → ISO instant with +05:30. */
export function istIso(date: string, time: string): string {
  return `${date}T${time}:00${APP_TZ_OFFSET}`;
}

/** ISO → "Sat, 18 Oct · 6:00 PM" */
export function formatInstant(iso: string | null | undefined): string {
  if (!iso) return "—";
  const p = istParts(iso);
  return `${formatDate(p.date)} · ${formatTime(p.time)}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "18:00" + minutes → "HH:mm" (may exceed 24h; clamps to 23:59 for display). */
export function addMinutes(hhmm: string, mins: number): string {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  const t = Math.min(23 * 60 + 59, Math.max(0, h * 60 + m + mins));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

export function toMinutes(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function timeRange(start: string, end: string): string {
  return `${formatTime(start)}–${formatTime(end)}`;
}

/** "HH:mm" from either "HH:mm" or an ISO instant with the IST offset (ScheduleBlock times are ISO). */
export function hm(s: string): string {
  if (!s.includes("T")) return s;
  return s.endsWith("+05:30") ? s.slice(11, 16) : istParts(s).time;
}
