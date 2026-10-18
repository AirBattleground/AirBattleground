/** Schedule packing: each group's matches form one contiguous block in one lobby, packed greedily (IST). */
import type { GameMap } from "../enums";
import type { ScheduleBlock, ScheduleConfig, SchedulePlan, TimeSlotOption } from "../phase3";
import { addDays, APP_TZ_OFFSET, weekdayOf } from "../schedule";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LAST_MINUTE = 23 * 60 + 59;
const MAX_LOBBIES = 4;
const MAX_EXTRA_DAYS = 400;

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
}
function fromMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
/** ISO instant with the IST offset, e.g. "2026-10-18T18:00:00+05:30". */
function istInstant(date: string, min: number): string {
  return `${date}T${fromMinutes(min)}:00${APP_TZ_OFFSET}`;
}
/** "Sat, 18 Oct · 6:00 PM" */
export function slotLabel(date: string, min: number): string {
  const [, mo, d] = date.split("-").map(Number) as [number, number, number];
  const h24 = Math.floor(min / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const ampm = h24 < 12 ? "AM" : "PM";
  return `${DAY_NAMES[weekdayOf(date)]}, ${d} ${MONTH_NAMES[mo - 1]} · ${h12}:${String(min % 60).padStart(2, "0")} ${ampm}`;
}
function humanDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

interface Placement {
  groupIndex: number;
  lobbyIndex: number;
  date: string;
  startMin: number;
}
interface CorePlan {
  placements: Placement[];
  unscheduled: number[];
  days: number;
  lastDate: string | null;
}

function normalisedWindows(config: ScheduleConfig): { start: number; end: number }[] {
  return config.windows
    .map((w) => ({ start: toMinutes(w.start), end: Math.min(LAST_MINUTE, toMinutes(w.end)) }))
    .filter((w) => w.end > w.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Greedy packing without suggestions. */
function packCore(config: ScheduleConfig, groupCount: number, matchesPerGroup: number): CorePlan {
  const matches = Math.max(1, matchesPerGroup);
  const blockLen = matches * config.matchMinutes + (matches - 1) * config.breakMinutes;
  const gap = config.breakMinutes;
  const lobbies = Math.max(1, Math.floor(config.parallelLobbies));
  const windows = normalisedWindows(config);
  const excluded = new Set(config.excludeDates);
  const placements: Placement[] = [];
  const usedDates: string[] = [];
  let next = 0;

  const fits = windows.some((w) => w.end - w.start >= blockLen);
  if (fits && groupCount > 0) {
    for (let date = config.startDate; date <= config.endDate && next < groupCount; date = addDays(date, 1)) {
      if (excluded.has(date)) continue;
      let usedToday = false;
      for (const w of windows) {
        if (next >= groupCount) break;
        const cursor = Array.from({ length: lobbies }, () => w.start);
        while (next < groupCount) {
          // lobby that is free earliest (lowest index on ties)
          let best = 0;
          for (let l = 1; l < lobbies; l++) if (cursor[l]! < cursor[best]!) best = l;
          const start = cursor[best]!;
          if (start + blockLen > w.end) break;
          placements.push({ groupIndex: next++, lobbyIndex: best, date, startMin: start });
          cursor[best] = start + blockLen + gap;
          usedToday = true;
        }
      }
      if (usedToday) usedDates.push(date);
    }
  }
  const unscheduled: number[] = [];
  for (let g = next; g < groupCount; g++) unscheduled.push(g);
  return { placements, unscheduled, days: usedDates.length, lastDate: usedDates[usedDates.length - 1] ?? null };
}

/** true when `b` is strictly better than `a` (fewer unscheduled groups, else fewer days). */
function better(a: CorePlan, b: CorePlan): boolean {
  if (b.unscheduled.length !== a.unscheduled.length) return b.unscheduled.length < a.unscheduled.length;
  return b.days < a.days;
}

function outcome(base: CorePlan, alt: CorePlan): string {
  if (alt.unscheduled.length < base.unscheduled.length) {
    if (alt.unscheduled.length === 0) return `fit every group in ${plural(alt.days, "day")}`;
    return `fit ${plural(base.unscheduled.length - alt.unscheduled.length, "more group")}`;
  }
  return `finish in ${plural(alt.days, "day")} instead of ${base.days}`;
}

function suggestionsFor(config: ScheduleConfig, groupCount: number, matchesPerGroup: number, base: CorePlan): string[] {
  const out: string[] = [];
  if (groupCount === 0) return out;
  const windows = normalisedWindows(config);
  const matches = Math.max(1, matchesPerGroup);
  const blockLen = matches * config.matchMinutes + (matches - 1) * config.breakMinutes;

  if (windows.length === 0) {
    out.push("Add a daily time window so matches can be scheduled.");
    return out;
  }

  // 1. Smallest window extension (15-min steps, up to +3h) that helps.
  if (base.days > 1 || base.unscheduled.length > 0) {
    for (let ext = 15; ext <= 180; ext += 15) {
      let changed = false;
      const extWindows = windows.map((w, i) => {
        const limit = Math.min(LAST_MINUTE, windows[i + 1]?.start ?? LAST_MINUTE);
        const end = Math.max(w.end, Math.min(limit, w.end + ext));
        if (end !== w.end) changed = true;
        return { start: fromMinutes(w.start), end: fromMinutes(end) };
      });
      if (!changed) break;
      const alt = packCore({ ...config, windows: extWindows }, groupCount, matchesPerGroup);
      if (better(base, alt)) {
        const what =
          windows.length === 1 ? `Extend the window to ${extWindows[0]!.end}` : `Extend each time window by ${humanDuration(ext)}`;
        out.push(`${what} to ${outcome(base, alt)}.`);
        break;
      }
    }
  }

  // 2. One more parallel lobby.
  if (config.parallelLobbies < MAX_LOBBIES) {
    const lobbies = config.parallelLobbies + 1;
    const alt = packCore({ ...config, parallelLobbies: lobbies }, groupCount, matchesPerGroup);
    if (better(base, alt)) out.push(`Run ${lobbies} lobbies at the same time to ${outcome(base, alt)}.`);
  }

  // 3. Extra days for unscheduled groups.
  if (base.unscheduled.length > 0) {
    const longest = Math.max(...windows.map((w) => w.end - w.start));
    if (longest < blockLen) {
      out.push(
        `Each group needs ${humanDuration(blockLen)} in one go, but the longest window is ${humanDuration(longest)}. Make a window longer or play fewer matches.`,
      );
    } else {
      const lo = config.endDate < config.startDate ? addDays(config.startDate, -1) : config.endDate;
      // Greedy packing is identical up to the old end date, so pack once over a long range and read off the last day.
      const alt = packCore({ ...config, endDate: addDays(lo, MAX_EXTRA_DAYS) }, groupCount, matchesPerGroup);
      if (alt.unscheduled.length === 0 && alt.lastDate) {
        const endDate = alt.lastDate;
        let extra = 0;
        for (let d = lo; d < endDate; d = addDays(d, 1)) extra++;
        out.push(
          `Add ${plural(extra, "more day")} (end on ${endDate}) to fit the remaining ${plural(base.unscheduled.length, "group")}.`,
        );
      }
    }
  }
  return out;
}

/**
 * Pack each group's matches as one contiguous block into the configured windows, lobby by lobby, day by day.
 * `groupSizesList[i]` = team count of group i (used for slot capacity). Maps give each match's map.
 * Returns blocks, slot options (merged by start instant), days used, unscheduled groups, and suggestions.
 *
 * Block `start`/`end` and match `start` are ISO instants (+05:30); TimeSlotOption.start is "HH:mm" IST.
 * Consecutive blocks in the same lobby are separated by `breakMinutes`.
 */
export function planSchedule(config: ScheduleConfig, groupSizesList: number[], matchesPerGroup: number, maps: GameMap[]): SchedulePlan {
  const groupCount = groupSizesList.length;
  const matches = Math.max(1, matchesPerGroup);
  const core = packCore(config, groupCount, matches);

  const blocks: ScheduleBlock[] = core.placements.map((p) => {
    const ms = Array.from({ length: matches }, (_, m) => ({
      number: m + 1,
      map: (maps.length ? maps[m % maps.length] : "ERANGEL") as GameMap,
      start: istInstant(p.date, p.startMin + m * (config.matchMinutes + config.breakMinutes)),
    }));
    const endMin = p.startMin + matches * config.matchMinutes + (matches - 1) * config.breakMinutes;
    return {
      groupIndex: p.groupIndex,
      lobbyIndex: p.lobbyIndex,
      date: p.date,
      start: istInstant(p.date, p.startMin),
      end: istInstant(p.date, endMin),
      matches: ms,
    };
  });

  const byId = new Map<string, TimeSlotOption>();
  for (const p of core.placements) {
    const id = istInstant(p.date, p.startMin);
    let opt = byId.get(id);
    if (!opt) {
      opt = { id, date: p.date, start: fromMinutes(p.startMin), label: slotLabel(p.date, p.startMin), groupIndexes: [], capacity: 0 };
      byId.set(id, opt);
    }
    opt.groupIndexes.push(p.groupIndex);
    opt.capacity += groupSizesList[p.groupIndex] ?? 0;
  }
  const slotOptions = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    blocks,
    days: core.days,
    slotOptions,
    unscheduledGroups: core.unscheduled,
    suggestions: suggestionsFor(config, groupCount, matches, core),
  };
}

