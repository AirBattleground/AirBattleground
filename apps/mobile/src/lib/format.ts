/** Formatters (pure, unit tested). Plain words, phone-friendly. */
import { MAP_LABELS, type GameMap, type LiveMatchCard, type RoomDetails } from "@7xen/shared";

const pad = (n: number) => String(n).padStart(2, "0");
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "7:30 PM" in the phone's time zone. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "Time not set";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Time not set";
  const h = d.getHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(d.getMinutes())} ${h < 12 ? "AM" : "PM"}`;
}

/** "Today", "Tomorrow" or "Sat, 18 Oct". */
export function formatDay(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(d) - startOf(now)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/**
 * Countdown to a start time: "in 45s", "in 12m", "in 1h 05m", "in 2d 3h"; after the start "started 5m ago".
 * Returns null when there is no start time.
 */
export function formatCountdown(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const diff = t - now;
  const span = compactSpan(Math.abs(diff));
  if (Math.abs(diff) < 30_000) return "starting now";
  return diff > 0 ? `in ${span}` : `started ${span} ago`;
}

/** 45s · 12m · 1h 05m · 2d 3h */
export function compactSpan(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${pad(m % 60)}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/** Stopwatch style: 4:07 or 1:02:09. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** 0 B · 812 KB · 312.4 MB · 1.25 GB */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = i === 0 ? 0 : i === 1 ? 1 : 2;
  return `${v.toFixed(digits)} ${units[i]}`;
}

/** 0..100, safe for zero/unknown totals. */
export function percent(done: number, total: number | null | undefined): number {
  if (!total || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

export function mapLabel(map: GameMap | string): string {
  return (MAP_LABELS as Record<string, string>)[map] ?? map;
}

/** "Slots 3–20" */
export function slotRangeLabel(r: { first: number; last: number } | null | undefined): string {
  if (!r) return "";
  return r.first === r.last ? `Slot ${r.first}` : `Slots ${r.first}–${r.last}`;
}

/** Minutes between reveal and start, for prefilling the editor (null = shown immediately). */
export function revealMinutesBefore(room: RoomDetails | null, startsAt: string | null): number | null {
  if (!room) return 15;
  if (!room.revealAt) return null;
  if (!startsAt) return 15;
  const m = Math.round((Date.parse(startsAt) - Date.parse(room.revealAt)) / 60_000);
  return Number.isFinite(m) && m >= 0 ? Math.min(240, m) : 15;
}

/** When teams will see the room, in words. */
export function revealLabel(room: RoomDetails | null, now = Date.now()): string {
  if (!room) return "Not set";
  if (!room.revealAt) return "Teams can see it now";
  const t = Date.parse(room.revealAt);
  if (t <= now) return "Teams can see it now";
  return `Teams see it at ${formatTime(room.revealAt)} (${formatCountdown(room.revealAt, now)})`;
}

/** WhatsApp-ready room message (uses *bold*). */
export function roomShareText(match: Pick<LiveMatchCard, "title" | "subtitle" | "number" | "map" | "startsAt" | "slotRange">, room: { roomId: string; password: string }): string {
  const lines = [
    `*7XEN · ${match.title}*`,
    `Match ${match.number} · ${mapLabel(match.map)}${match.startsAt ? ` · ${formatDay(match.startsAt)} ${formatTime(match.startsAt)}` : ""}`,
    "",
    `Room ID: *${room.roomId}*`,
    `Password: *${room.password}*`,
  ];
  if (match.slotRange) lines.push("", `${slotRangeLabel(match.slotRange)} — join your own slot, on time.`);
  lines.push("Good luck! 🔥");
  return lines.join("\n");
}
