import { APP_TIMEZONE } from "@7xen/shared";

/** 1.2 GB / 340 MB / 12 KB */
export function fmtBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** 1:05:09 / 12:04 */
export function fmtDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: APP_TIMEZONE, hour: "numeric", minute: "2-digit" });
const dayTimeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: APP_TIMEZONE, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });

const valid = (iso: string | null | undefined): iso is string => !!iso && !Number.isNaN(new Date(iso).getTime());

/** "7:45 PM" today (IST), otherwise "Sat, 18 Oct, 7:45 pm" */
export function fmtClock(iso: string | null | undefined): string {
  if (!valid(iso)) return "—";
  const d = new Date(iso);
  return dayKey.format(d) === dayKey.format(new Date()) ? timeFmt.format(d) : dayTimeFmt.format(d);
}

/** Copy text to the clipboard; falls back to a hidden textarea on insecure origins (LAN dev). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
