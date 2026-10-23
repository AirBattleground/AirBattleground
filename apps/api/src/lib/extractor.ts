/**
 * Screenshot reader: runs the `claude` CLI headless (`claude -p`) with the image and a JSON schema, and
 * converts its structured output to the ExtractionResult shape in packages/shared/src/phase2.ts.
 * The CLI uses whatever login `claude` has on this machine (run `claude` once to log in).
 *
 * All calls go through the exported `extractor` object so tests can stub them with vi.spyOn.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { LIVE_PLAYER_STATES, type ExtractedPlayer, type ExtractionResult, type LivePlayerState, type ScreenshotKind } from "@7xen/shared";
import { env } from "../env.js";
import { AppError } from "./errors.js";

export const OFFLINE_MESSAGE = "Screenshot reader is offline — enter results by hand or retry";

/** The reader can't run at all (CLI missing, not logged in, timed out). */
export class ExtractorOfflineError extends Error {
  constructor(cause?: unknown) {
    super(OFFLINE_MESSAGE);
    this.name = "ExtractorOfflineError";
    this.cause = cause;
  }
}

/** The reader ran but failed on this image. */
export class ExtractorHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(`Screenshot reader error (${status}): ${detail}`);
    this.name = "ExtractorHttpError";
  }
  /** 5xx / 429 are worth retrying; 4xx means the input itself is bad */
  get retryable() {
    return this.status >= 500 || this.status === 429;
  }
}

/** Roster sent with an extraction: known player names per slot. */
export interface RosterSlot {
  slot: number;
  teamName: string | null;
  players: string[];
}

const EXTRACT_TIMEOUT_MS = 180_000;
/** a live capture older than this is useless: the next one supersedes it */
const LIVE_TIMEOUT_MS = 30_000;
const STATUS_TIMEOUT_MS = 10_000;
/** names Claude flags as unsure get this, so the review screen highlights them (< 0.85) */
const UNSURE_CONFIDENCE = 0.6;
const SURE_CONFIDENCE = 0.97;

const claudeBin = () => {
  if (env.CLAUDE_BIN) return env.CLAUDE_BIN;
  const local = path.join(homedir(), ".local/bin/claude");
  return existsSync(local) ? local : "claude";
};

/** empty working dir so the CLI doesn't pick up this repo's CLAUDE.md / settings */
let workDir: string | null = null;
const cwd = () => (workDir ??= mkdtempSync(path.join(tmpdir(), "7xen-reader-")));

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function run(args: string[], stdin: string | null, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(claudeBin(), args, { cwd: cwd(), env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(stdin ?? "");
  });
}

// ---------------------------------------------------------------- prompt + schema

const SYSTEM_PROMPT = `You read Battlegrounds Mobile India (BGMI) screenshots for an esports scrim app and return structured data.
The image is either a phone screenshot or a frame captured from a live broadcast (the game picture may be scaled, letterboxed,
inside a frame, or have broadcast graphics such as a "LIVE" badge, logos, a ticker, a lower-third name strip or an organiser's
team/points panel drawn on top). Read ONLY the BGMI game screen itself; ignore every broadcast graphic, border and caption.
First decide which BGMI screen it is and set "screen":
- "custom_lobby": custom-room lobby / team list — a grid of team cards, each with a slot number and up to 4 player names.
- "tdm_lobby": Team Deathmatch room / team list — two sides (e.g. left/right or blue/red), each listing its players.
- "custom_results": custom-room results — rank blocks (rank number, up to 4 players, each with "N finishes").
- "tdm_results": Team Deathmatch results — a big "VICTORY"/"DEFEAT" banner, two big team kill totals in the top corners
  (left/blue and right/red, e.g. 40 and 17), and under each side a table of up to 4 players with "Finishes", "F/D", "Assists"
  (plus small "N Combo" and "MVP" tags).
- "classic_results": a normal (non-custom) match end screen that shows only ONE team's placement (e.g. "#3/100") and its players.
- "other": anything else (menus, loading screens, the map, spectator view without a table, etc.).
Rules:
- Copy player names exactly as shown, character for character: keep symbols, CJK, Devanagari, accents, separators like 乡 ・ | 《》 and letter case. Never "fix" spelling.
- Watch lookalikes (I/l/1, O/0, rn/m). Clan tags before the name are usually 2–5 letters/digits followed by a separator such as
  "x", "×", "|", "・" or "丶" (e.g. "G1xBee", "UP70xSkull", "TFK×Nojo"); keep digits that are clearly digits. If a character is
  genuinely ambiguous, give your best reading and set "unsure": true.
- Only report what is fully visible. Skip cards/blocks cut off by the screen edge.
- If a roster is given, set "roster_match" to the roster name (copied exactly from the roster) that is clearly the same player, else null. Never invent roster names.
- "warnings": only real problems a manager must act on (image blurry, wrong screen type, a name you could not read at all), one short plain-English sentence each. Usually empty.
  Never warn about normal things: no roster given, ranks/slots not on this screenshot, cut-off blocks you skipped, rank 1 having an icon instead of a digit, or lookalike characters (use "unsure" for those).`;

const SLOT_LIST_PROMPT = `This should be a TEAM LIST (lobby) screen.
- custom_lobby: a grid of dark team cards. Each card has a coloured slot number (e.g. 05, 13) and up to 4 player names (ignore
  "0 Eliminations" text). Return every visible card in reading order (row by row, left to right) with its slot number as an
  integer and its player names in order.
- tdm_lobby: return two teams. Use the slot number shown on screen if there is one; otherwise slot 1 for the first side
  (left/top/blue) and slot 2 for the second side (right/bottom/red). List each side's players in order.
- Any other screen: return no teams and one warning saying it isn't a team list screen.`;

const RESULTS_PROMPT = `This should be a match RESULTS screen.
- custom_results: the left panel shows rank 1 (wings/trophy icon, may have no digit) and rank 2. The right panel shows more rank
  blocks, each with a big rank number, up to 4 player names, and each player's "N finishes" (finishes = kills). Return every
  fully visible rank block (including ranks 1 and 2 on the left) with rank as an integer and each player's name and kills.
- tdm_results: two sides, left (blue) and right (red), each with up to 4 players. The winner is the side with the larger big
  team kill total in its top corner — NOT the side the VICTORY/DEFEAT banner seems to belong to (the banner is from the
  screenshot taker's view). Return two rows: rank 1 = the side with more team kills, rank 2 = the other side. For each player,
  kills = the "Finishes" number. Ignore F/D (a ratio, e.g. 2.9), Assists, "N Combo" and "MVP" tags — they are not kills and not
  part of the name. If the two totals are equal, rank left first and add the warning "Draw — both teams have the same kills".
- classic_results: return one row with the placement number shown (e.g. #3 → rank 3) and that team's players and kills, plus
  the warning "This screen shows only one team — capture the full results table if there is one".
- Any other screen: return no rows and one warning saying it isn't a results screen.`;

const playerSchema = (withKills: boolean) => ({
  type: "object",
  properties: {
    name: { type: "string" },
    ...(withKills ? { kills: { type: ["integer", "null"] } } : {}),
    unsure: { type: "boolean" },
    roster_match: { type: ["string", "null"] },
  },
  required: ["name", "unsure", "roster_match", ...(withKills ? ["kills"] : [])],
});

/** BGMI screen families the reader tells apart (see SYSTEM_PROMPT). */
export const SCREENS = ["custom_lobby", "tdm_lobby", "custom_results", "tdm_results", "classic_results", "other"] as const;

const SCHEMAS: Record<ScreenshotKind, object> = {
  SLOT_LIST: {
    type: "object",
    properties: {
      teams: {
        type: "array",
        items: {
          type: "object",
          properties: { slot: { type: ["integer", "null"] }, players: { type: "array", items: playerSchema(false) } },
          required: ["slot", "players"],
        },
      },
      screen: { type: "string", enum: SCREENS },
      warnings: { type: "array", items: { type: "string" } },
    },
    required: ["screen", "teams", "warnings"],
  },
  RESULTS: {
    type: "object",
    properties: {
      rows: {
        type: "array",
        items: {
          type: "object",
          properties: { rank: { type: ["integer", "null"] }, players: { type: "array", items: playerSchema(true) } },
          required: ["rank", "players"],
        },
      },
      screen: { type: "string", enum: SCREENS },
      warnings: { type: "array", items: { type: "string" } },
    },
    required: ["screen", "rows", "warnings"],
  },
};

function promptText(kind: ScreenshotKind, roster?: RosterSlot[]) {
  const base = kind === "RESULTS" ? RESULTS_PROMPT : SLOT_LIST_PROMPT;
  if (!roster?.length) return base;
  const lines = roster.map((r) => `slot ${r.slot}${r.teamName ? ` (${r.teamName})` : ""}: ${JSON.stringify(r.players)}`);
  return `${base}\n\nRoster (registered players per slot):\n${lines.join("\n")}`;
}

// ---------------------------------------------------------------- output → ExtractionResult

type Obj = Record<string, unknown>;
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Obj[]) : []);
const intOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Build the result from Claude's structured output; roster matches are checked against the real roster. */
export function toExtractionResult(raw: unknown, kind: ScreenshotKind, model: string, roster?: RosterSlot[], ms = 0): ExtractionResult {
  const r = (raw && typeof raw === "object" ? raw : {}) as Obj;
  const slotOf = new Map<string, number>();
  for (const s of roster ?? []) for (const p of s.players) if (!slotOf.has(p)) slotOf.set(p, s.slot);

  let unsure = false;
  const toPlayer = (p: Obj, withKills: boolean): ExtractedPlayer => {
    const match = typeof p.roster_match === "string" && slotOf.has(p.roster_match) ? p.roster_match : null;
    if (p.unsure === true) unsure = true;
    const conf = p.unsure === true ? UNSURE_CONFIDENCE : SURE_CONFIDENCE;
    const kills = withKills ? intOrNull(p.kills) : null;
    return {
      name: str(p.name).trim().normalize("NFC"),
      confidence: conf,
      source: "claude",
      rosterMatch: match,
      matchedSlot: match ? slotOf.get(match)! : null,
      kills: kills != null ? Math.max(0, kills) : null,
      killsConfidence: kills != null ? conf : null,
    };
  };

  const teams =
    kind === "SLOT_LIST"
      ? arr(r.teams).map((t) => {
          const slot = intOrNull(t.slot);
          return { slot, slotConfidence: slot != null ? SURE_CONFIDENCE : 0, players: arr(t.players).map((p) => toPlayer(p, false)).filter((p) => p.name) };
        })
      : [];

  const seenRanks = new Set<number>();
  const rows =
    kind === "RESULTS"
      ? arr(r.rows)
          .map((row) => {
            const rank = intOrNull(row.rank);
            const players = arr(row.players).map((p) => toPlayer(p, true)).filter((p) => p.name);
            return { rank, rankConfidence: rank != null ? SURE_CONFIDENCE : 0, players, inferredSlot: majoritySlot(players) };
          })
          .filter((row) => row.rank == null || (!seenRanks.has(row.rank) && seenRanks.add(row.rank)))
      : [];

  const warnings = Array.isArray(r.warnings) ? r.warnings.filter((w): w is string => typeof w === "string" && w.trim() !== "") : [];
  const unmatched = !!roster?.length && [...teams.flatMap((t) => t.players), ...rows.flatMap((x) => x.players)].some((p) => !p.rosterMatch);
  return {
    imageId: "",
    kind,
    modelVersion: `claude-${model}`,
    teams,
    rows,
    needsReview: unsure || unmatched || warnings.length > 0,
    warnings,
    timingsMs: { total: ms },
    ...(typeof r.screen === "string" ? { screen: r.screen } : {}),
  };
}

function majoritySlot(players: ExtractedPlayer[]): number | null {
  const counts = new Map<number, number>();
  for (const p of players) if (p.matchedSlot != null) counts.set(p.matchedSlot, (counts.get(p.matchedSlot) ?? 0) + 1);
  let best: number | null = null;
  let bestN = 0;
  for (const [slot, n] of counts) if (n > bestN) [best, bestN] = [slot, n];
  return best;
}

// ---------------------------------------------------------------- live status (auto capture)

const LIVE_SYSTEM_PROMPT = `You read live Battlegrounds Mobile India (BGMI) broadcast frames for an esports scrim app and return structured data.
Read only what the game itself shows; ignore broadcast graphics, borders and captions. Only report what is fully visible.`;

const LIVE_PROMPT = `This is a frame from a live BGMI esports broadcast, captured every few seconds. Find the game's own
SPECTATOR/OBSERVER team status panel: a list of teams (usually down one side of the screen), each row with a slot or rank number,
a team name or tag, and up to 4 small bars or icons — one per player.
- A bright/solid/filled bar = "alive". A red, flashing, half-filled or cross-marked bar = "knocked" (down but not out).
  A grey, dark, empty or skull bar = "eliminated". A whole row greyed out or struck through = every player eliminated.
- Return every fully visible team row in order: its slot number (integer, null if none is shown), its name or tag exactly as shown
  (null if none), and one state per bar in the order shown. Set "unsure": true for a row whose bars you can't read clearly.
- Ignore every broadcast graphic drawn on top of the game, ESPECIALLY a team status / "alive" board added by the broadcaster:
  it mirrors data we already have and must never be read. Read only the game's own HUD.
- If there is no spectator team panel (lobby, map, results, a replay, a camera shot), set "screen" to "other" and return no teams.`;

const LIVE_SCHEMA = {
  type: "object",
  properties: {
    screen: { type: "string", enum: ["spectator_hud", "other"] },
    teams: {
      type: "array",
      items: {
        type: "object",
        properties: {
          slot: { type: ["integer", "null"] },
          name: { type: ["string", "null"] },
          players: { type: "array", items: { type: "string", enum: LIVE_PLAYER_STATES } },
          unsure: { type: "boolean" },
        },
        required: ["slot", "name", "players", "unsure"],
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["screen", "teams", "warnings"],
};

/** What the reader saw on a live capture. */
export interface LiveReadResult {
  screen: "spectator_hud" | "other";
  teams: { slot: number | null; name: string | null; players: LivePlayerState[]; confidence: number }[];
  warnings: string[];
  modelVersion: string;
  ms: number;
}

export function toLiveReadResult(raw: unknown, model: string, ms = 0): LiveReadResult {
  const r = (raw && typeof raw === "object" ? raw : {}) as Obj;
  const states = new Set<string>(LIVE_PLAYER_STATES);
  return {
    screen: r.screen === "spectator_hud" ? "spectator_hud" : "other",
    teams: arr(r.teams).map((t) => ({
      slot: intOrNull(t.slot),
      name: str(t.name).trim() || null,
      players: (Array.isArray(t.players) ? t.players : []).filter((p): p is LivePlayerState => typeof p === "string" && states.has(p)).slice(0, 4),
      confidence: t.unsure === true ? UNSURE_CONFIDENCE : SURE_CONFIDENCE,
    })),
    warnings: Array.isArray(r.warnings) ? r.warnings.filter((w): w is string => typeof w === "string" && w.trim() !== "") : [],
    modelVersion: `claude-${model}`,
    ms,
  };
}

// ---------------------------------------------------------------- calls

const AUTH_ERROR = /log ?in|logged|api key|auth|credential|401|403/i;

interface ExtractorHealth {
  online: boolean;
  serviceVersion: string | null;
  activeModel: string | null;
  ocrReady: boolean;
  vlmEnabled: boolean;
}

/** One `claude -p` call with an image: the structured output, the model and how long it took. */
async function ask(image: Buffer, mime: string, system: string, prompt: string, schema: object, timeoutMs: number): Promise<{ structured: unknown; model: string; ms: number }> {
  const model = env.CLAUDE_MODEL;
  const message = {
    type: "user",
    message: {
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mime, data: image.toString("base64") } },
        { type: "text", text: prompt },
      ],
    },
  };
  const args = [
    "-p",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--model", model,
    "--tools", "",
    "--system-prompt", system,
    "--json-schema", JSON.stringify(schema),
    "--no-session-persistence",
    "--strict-mcp-config",
  ];
  const started = Date.now();
  let out: RunResult;
  try {
    out = await run(args, JSON.stringify(message) + "\n", timeoutMs);
  } catch (e) {
    throw new ExtractorOfflineError(e); // ENOENT: claude not installed / not on PATH
  }
  if (out.timedOut) throw new ExtractorHttpError(504, "took too long");

  let result: Obj | null = null;
  for (const line of out.stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line) as Obj;
      if (o.type === "result") result = o;
    } catch {
      /* non-JSON noise */
    }
  }
  const detail = (result && str(result.result)) || out.stderr.trim().split("\n").pop() || `claude exited with code ${out.code}`;
  if (!result || result.is_error === true || result.subtype !== "success") {
    if (AUTH_ERROR.test(detail)) throw new ExtractorOfflineError(new Error(detail));
    throw new ExtractorHttpError(502, detail.slice(0, 200));
  }
  let structured = result.structured_output;
  if (structured == null && typeof result.result === "string") {
    try {
      structured = JSON.parse(result.result);
    } catch {
      throw new ExtractorHttpError(502, "reader returned no data");
    }
  }
  return { structured, model, ms: Date.now() - started };
}

export const extractor = {
  /** Read one screenshot. `roster` lets Claude map names to registered players (slot → known names). */
  async extract(image: Buffer, mime: string, kind: ScreenshotKind, roster?: RosterSlot[], _filename = "image"): Promise<ExtractionResult> {
    const { structured, model, ms } = await ask(image, mime, SYSTEM_PROMPT, promptText(kind, roster), SCHEMAS[kind], EXTRACT_TIMEOUT_MS);
    return toExtractionResult(structured, kind, model, roster, ms);
  },

  /** Read a live auto capture: each team's player states from the spectator HUD. `teams` = registered slots + names. */
  async readLive(image: Buffer, mime: string, teams: { slot: number; name: string; tag: string }[]): Promise<LiveReadResult> {
    const list = teams.map((t) => `slot ${t.slot}: ${JSON.stringify(t.name)} (tag ${JSON.stringify(t.tag)})`).join("\n");
    const prompt = teams.length ? `${LIVE_PROMPT}\n\nRegistered teams:\n${list}` : LIVE_PROMPT;
    const { structured, model, ms } = await ask(image, mime, LIVE_SYSTEM_PROMPT, prompt, LIVE_SCHEMA, LIVE_TIMEOUT_MS);
    return toLiveReadResult(structured, model, ms);
  },

  /** Is the CLI installed and logged in? Never throws. */
  async status(): Promise<ExtractorHealth> {
    const offline: ExtractorHealth = { online: false, serviceVersion: null, activeModel: null, ocrReady: false, vlmEnabled: false };
    try {
      const [version, auth] = await Promise.all([
        run(["--version"], null, STATUS_TIMEOUT_MS),
        run(["auth", "status", "--json"], null, STATUS_TIMEOUT_MS),
      ]);
      if (version.code !== 0) return offline;
      let loggedIn = false;
      try {
        loggedIn = (JSON.parse(auth.stdout) as Obj).loggedIn === true;
      } catch {
        /* older CLI without `auth status` */
      }
      return { online: loggedIn, serviceVersion: version.stdout.trim() || null, activeModel: env.CLAUDE_MODEL, ocrReady: loggedIn, vlmEnabled: false };
    } catch {
      return offline;
    }
  },
};

/** Convert reader failures into API errors for request handlers (admin preview/prefill). */
function extractorToAppError(e: unknown): unknown {
  if (e instanceof ExtractorOfflineError) {
    return new AppError("EXTRACTOR_OFFLINE", "Screenshot reader is offline. Check that `claude` is installed and logged in on the server.");
  }
  if (e instanceof ExtractorHttpError) return new AppError("EXTRACTOR_OFFLINE", `Screenshot reader failed: ${e.detail}`);
  return e;
}

/** Run a reader call from a request handler, mapping failures to API errors. */
export async function viaExtractor<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw extractorToAppError(e);
  }
}
