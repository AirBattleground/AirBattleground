import { addDays, type ScheduleConfig } from "@7xen/shared";
import { toMinutes } from "./format";

/**
 * Turn one of the engine's plain-English schedule tips into a one-click change, when we recognise it.
 * e.g. "Extend the window to 23:30 to finish in 2 days instead of 4." → last window ends 23:30.
 */
export function suggestionPatch(text: string, cfg: ScheduleConfig): ScheduleConfig | null {
  const t = text.toLowerCase();

  const lobbies = t.match(/(\d)\s+(?:parallel\s+)?lobbies/) ?? (/(add|use|run)\s+(a|an|one|another|a second|more)?\s*(parallel\s+)?lobb/.test(t) ? ["", String(cfg.parallelLobbies + 1)] : null);
  if (lobbies && /lobb/.test(t)) {
    const n = Math.min(4, Math.max(1, Number(lobbies[1])));
    return n !== cfg.parallelLobbies ? { ...cfg, parallelLobbies: n } : null;
  }

  const days = t.match(/add\s+(\d+)\s+(?:more\s+)?(?:day|evening|date)/);
  if (days) return { ...cfg, endDate: addDays(cfg.endDate, Number(days[1])) };
  if (/add\s+(?:a|one|another)\s+(?:more\s+)?(?:day|evening)/.test(t)) return { ...cfg, endDate: addDays(cfg.endDate, 1) };

  const until = t.match(/end\s+(?:on|date\s+to)\s+(\d{4}-\d{2}-\d{2})/);
  if (until) return { ...cfg, endDate: until[1]! };

  // "Extend each time window by 1h 15m …" — each window grows, but never past the next window's start or 23:59
  const by = t.match(/extend each time window by\s+(?:(\d+)h)?\s*(?:(\d+)\s*m(?:in)?)?/);
  if (by && (by[1] || by[2])) {
    const ext = Number(by[1] ?? 0) * 60 + Number(by[2] ?? 0);
    const windows = cfg.windows.map((w, i) => {
      const limit = Math.min(23 * 60 + 59, cfg.windows[i + 1] ? toMinutes(cfg.windows[i + 1]!.start) : 23 * 60 + 59);
      const end = Math.max(toMinutes(w.end), Math.min(limit, toMinutes(w.end) + ext));
      return { ...w, end: `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}` };
    });
    return { ...cfg, windows };
  }

  const time = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (time && cfg.windows.length) {
    const hhmm = `${time[1]!.padStart(2, "0")}:${time[2]}`;
    if (/start|earlier|begin/.test(t)) {
      const w = cfg.windows[0]!;
      if (toMinutes(hhmm) >= toMinutes(w.end)) return null;
      return { ...cfg, windows: [{ ...w, start: hhmm }, ...cfg.windows.slice(1)] };
    }
    if (/extend|end|until|later|window/.test(t)) {
      const i = cfg.windows.length - 1;
      const w = cfg.windows[i]!;
      if (toMinutes(hhmm) <= toMinutes(w.start)) return null;
      return { ...cfg, windows: cfg.windows.map((x, j) => (j === i ? { ...x, end: hhmm } : x)) };
    }
  }

  const brk = t.match(/break\s+(?:to|of)\s+(\d+)/);
  if (brk) return { ...cfg, breakMinutes: Number(brk[1]) };

  return null;
}
