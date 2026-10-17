/** Tiny JSON-lines logger (journald / `journalctl --user -u 7xen-station` picks up stdout). */
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const min = ORDER[(process.env.LOG_LEVEL as Level) ?? "info"] ?? 20;

function write(level: Level, msg: string, extra?: Record<string, unknown>) {
  if (ORDER[level] < min || (process.env.VITEST && !process.env.STATION_LOG)) return;
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(extra ?? {})) fields[k] = v instanceof Error ? v.message : v;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields });
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line + "\n");
}

export const log = {
  debug: (msg: string, extra?: Record<string, unknown>) => write("debug", msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => write("info", msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => write("warn", msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => write("error", msg, extra),
};
