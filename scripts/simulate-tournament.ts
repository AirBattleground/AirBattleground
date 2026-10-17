/**
 * 7xen phase-3 tournament simulation (end-to-end QA).
 *
 * Plays a complete 128-team tournament against a running API:
 *   admin → manager + 131 teams (rosters) → manager creates "Sim Cup" (Qualifier 8×16 top 4 → Semi 2×16 top 7 + 1 wildcard
 *   → Final 16 incl. 1 invited team) → publish → 130 concurrent registrations (128 confirmed + 2 waitlisted) → withdrawal
 *   promotes the waitlist → invite → admin closes registration → draw (time preferences) → start → every match result
 *   via the match center → promotion preview (engineered tie) → promote → snake-seeded semi → wildcard → final →
 *   admin completes → champion → team and admin views.
 *
 * Usage:   pnpm simulate:tournament                 (BASE_URL defaults to http://localhost:4100)
 *          BASE_URL=http://localhost:4100 ADMIN_USERNAME=admin ADMIN_PASSWORD=... node scripts/simulate-tournament.ts
 *          SIM_SEED=abc  (deterministic results/preferences; default random)
 *
 * NEVER point this at production: it creates ~135 accounts and a tournament. Use an isolated schema
 * (see docs/phase3/QA.md). Self-contained (no workspace imports) so it runs with plain Node 24 type stripping.
 */

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:4100").replace(/\/$/, "");
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "Admin@12345";
const PASSWORD = "SimCup@12345";
const TEAMS = 130;
const MAX_TEAMS = 128;
const LOBBY = 16;
const FIRST_SLOT = 1;
const PS = { placement: [10, 6, 5, 4, 3, 2, 1, 1], killPoints: 1 }; // DEFAULT_POINTS_SYSTEM

if (/(:|\/\/)(80|4000|8090)(\/|$)/.test(BASE_URL) && !process.env.SIM_ALLOW_ANY_PORT) {
  console.error(`Refusing to run against ${BASE_URL}: ports 80/4000/8090 are production. Set SIM_ALLOW_ANY_PORT=1 to override.`);
  process.exit(2);
}

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const green = (s: string) => (color ? `\x1b[32m${s}\x1b[0m` : s);
const red = (s: string) => (color ? `\x1b[31m${s}\x1b[0m` : s);
const yellow = (s: string) => (color ? `\x1b[33m${s}\x1b[0m` : s);
const dim = (s: string) => (color ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s: string) => (color ? `\x1b[1m${s}\x1b[0m` : s);

// ---------------------------------------------------------------- seeded rng (results are reproducible with SIM_SEED)
const SIM_SEED = process.env.SIM_SEED ?? Math.random().toString(36).slice(2, 10);
function hash(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
let rngState = hash(SIM_SEED);
function rand(): number {
  rngState = (rngState + 0x6d2b79f5) >>> 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randInt = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [b[i], b[j]] = [b[j]!, b[i]!];
  }
  return b;
}

// ---------------------------------------------------------------- http client
interface Res {
  status: number;
  body: any;
  method: string;
  path: string;
}
let requests = 0;

class Client {
  readonly name: string;
  private jar = new Map<string, string>();
  constructor(name: string) {
    this.name = name;
  }
  async req(method: string, path: string, body?: unknown, attempt = 0): Promise<Res> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.jar.size) headers.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    let r: Response;
    requests++;
    try {
      r = await fetch(BASE_URL + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
    } catch (e) {
      throw new StepError(`${method} ${path}: network error (${(e as Error).message}) — is the API running at ${BASE_URL}?`);
    }
    for (const c of r.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const eq = pair!.indexOf("=");
      const k = pair!.slice(0, eq).trim();
      const v = pair!.slice(eq + 1).trim();
      const expired = v === "" || attrs.some((a) => /^\s*max-age=0\s*$/i.test(a));
      if (expired) this.jar.delete(k);
      else this.jar.set(k, v);
    }
    if (r.status === 429 && attempt < 3) {
      const reset = Number(/reset=(\d+)/.exec(r.headers.get("ratelimit") ?? "")?.[1] ?? r.headers.get("retry-after") ?? 60);
      console.log(dim(`    (rate limited on ${path} — waiting ${reset + 1}s)`));
      await new Promise((ok) => setTimeout(ok, (reset + 1) * 1000));
      return this.req(method, path, body, attempt + 1);
    }
    const text = await r.text();
    let parsed: any = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: r.status, body: parsed, method, path };
  }
  get = (p: string) => this.req("GET", p);
  post = (p: string, b?: unknown) => this.req("POST", p, b ?? {});
  put = (p: string, b?: unknown) => this.req("PUT", p, b ?? {});
  patch = (p: string, b?: unknown) => this.req("PATCH", p, b ?? {});
  del = (p: string) => this.req("DELETE", p);
}

// ---------------------------------------------------------------- assertions / steps
class StepError extends Error {}
function describe(r: Res): string {
  const b = typeof r.body === "string" ? r.body.slice(0, 400) : JSON.stringify(r.body)?.slice(0, 400);
  return `${r.method} ${r.path} → ${r.status} ${b ?? ""}`;
}
function expectStatus(r: Res, ...ok: number[]): void {
  if (!ok.includes(r.status)) throw new StepError(`expected HTTP ${ok.join("|")}, got ${describe(r)}`);
}
function expectError(r: Res, status: number | number[], code?: string): void {
  const st = Array.isArray(status) ? status : [status];
  if (!st.includes(r.status) || (code && r.body?.error?.code !== code)) throw new StepError(`expected ${st.join("|")}${code ? ` ${code}` : ""}, got ${describe(r)}`);
}
function check(cond: unknown, msg: string, r?: Res): asserts cond {
  if (!cond) throw new StepError(r ? `${msg} — ${describe(r)}` : msg);
}

let passed = 0;
let failed = 0;
let skipped = 0;
let stepNo = 0;
let aborted = false;
const results: { n: number; title: string; ok: boolean | null; ms: number; note: string }[] = [];

async function step(title: string, fn: () => Promise<void | string>, critical = true): Promise<boolean> {
  stepNo++;
  const n = stepNo;
  const label = `${String(n).padStart(2, " ")}. ${title}`;
  if (aborted) {
    skipped++;
    results.push({ n, title, ok: null, ms: 0, note: "skipped" });
    console.log(dim(`  - ${label} (skipped)`));
    return false;
  }
  const t0 = Date.now();
  try {
    const note = (await fn()) ?? "";
    passed++;
    const ms = Date.now() - t0;
    results.push({ n, title, ok: true, ms, note });
    console.log(`${green("✓")} ${label}${note ? dim(` — ${note}`) : ""} ${dim(`${ms}ms`)}`);
    return true;
  } catch (e) {
    failed++;
    const ms = Date.now() - t0;
    results.push({ n, title, ok: false, ms, note: (e as Error).message });
    console.log(`${red("✗")} ${label} ${dim(`${ms}ms`)}\n    ${red((e as Error).message)}`);
    if (!(e instanceof StepError)) console.log(dim(String((e as Error).stack)));
    if (critical) aborted = true;
    return false;
  }
}

/** Run fn over items with at most `limit` in flight. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

// ---------------------------------------------------------------- domain helpers
function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
const placementPts = (p: number) => PS.placement[p - 1] ?? 0;
const groupLetter = (i: number) => String.fromCharCode(65 + i);
/** 0-based group index of 0-based seed s in a snake over g groups. */
const snakeGroup = (s: number, g: number) => (Math.floor(s / g) % 2 === 0 ? s % g : g - 1 - (s % g));

interface SimTeam {
  i: number;
  name: string;
  tag: string;
  username: string;
  id: string;
  client: Client;
  roster: string[];
  prefs: string[];
  entryStatus?: string;
}

interface Row {
  team: { id: string; name: string; tag: string };
  rank: number;
  slotNumber: number;
  seed: number | null;
  matchesPlayed: number;
  wins: number;
  kills: number;
  placementPoints: number;
  totalPoints: number;
  status: string;
  advancedVia: string | null;
}
interface Group {
  id: string;
  index: number;
  name: string;
  startsAt: string | null;
  teams: Row[];
  matches: { id: string; number: number; status: string; publishedAt: string | null; scheduledAt: string | null }[];
}

/** Local truth: per team aggregated results we submitted. */
interface Agg {
  mp: number;
  wins: number;
  kills: number;
  pp: number;
  total: number;
  last: number;
}
const truth = new Map<string, Map<string, Agg>>(); // stageId → teamId → agg
const fragTruth = new Map<string, Map<string, number>>(); // stageId → player name → kills
function record(stageId: string, teamId: string, placement: number, kills: number) {
  let s = truth.get(stageId);
  if (!s) truth.set(stageId, (s = new Map()));
  const a = s.get(teamId) ?? { mp: 0, wins: 0, kills: 0, pp: 0, total: 0, last: 99 };
  a.mp++;
  if (placement === 1) a.wins++;
  a.kills += kills;
  a.pp += placementPts(placement);
  a.total += placementPts(placement) + kills * PS.killPoints;
  a.last = placement;
  s.set(teamId, a);
}

// ---------------------------------------------------------------- flow
async function main(): Promise<void> {
  const t0 = Date.now();
  const sfx = Math.random().toString(36).slice(2, 7);
  console.log(bold(`7xen tournament simulation → ${BASE_URL}`) + dim(`  (suffix ${sfx}, SIM_SEED=${SIM_SEED})\n`));

  const admin = new Client("admin");
  const manager = new Client("manager");
  const manager2 = new Client("manager2");
  const mgr = { username: `sim_mgr_${sfx}`, displayName: `Sim Manager ${sfx}` };
  const mgr2 = { username: `sim_mgr2_${sfx}`, displayName: `Sim Other ${sfx}` };
  const teams: SimTeam[] = [];
  let invitee: SimTeam | null = null;

  const day1 = addDays(todayIST(), 3);
  let tid = "";
  let tour: any = null;
  let stageIds: string[] = [];
  let slotIds: string[] = [];
  const timings: Record<string, number> = {};
  const T = (k: string, ms: number) => (timings[k] = (timings[k] ?? 0) + ms);
  const M = (p = "") => `/api/manager/tournaments/${tid}${p}`;
  const A = (p = "") => `/api/admin/tournaments/${tid}${p}`;
  const byId = new Map<string, SimTeam>();

  await step("API health", async () => {
    const r = await admin.get("/api/health");
    expectStatus(r, 200);
  });

  await step("admin signs in", async () => {
    const r = await admin.post("/api/admin/auth/login", { username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    expectStatus(r, 200);
    check(r.body?.user?.role === "ADMIN", "not an admin", r);
  });

  await step("admin creates 2 managers", async () => {
    for (const m of [mgr, mgr2]) expectStatus(await admin.post("/api/admin/managers", { ...m, password: PASSWORD }), 200, 201);
    expectStatus(await manager.post("/api/auth/login", { username: mgr.username, password: PASSWORD }), 200);
    expectStatus(await manager2.post("/api/auth/login", { username: mgr2.username, password: PASSWORD }), 200);
    return mgr.username;
  });

  await step(`admin creates ${TEAMS + 1} teams (130 + 1 invitee)`, async () => {
    const t1 = Date.now();
    const made = await mapLimit(Array.from({ length: TEAMS + 1 }, (_, i) => i), 8, async (i) => {
      const n = String(i + 1).padStart(3, "0");
      const isInvitee = i === TEAMS;
      const t: SimTeam = {
        i,
        name: isInvitee ? `Sim Invitee ${sfx}` : `Sim Team ${n} ${sfx}`,
        tag: isInvitee ? "INV" + sfx.slice(0, 2).toUpperCase().replace(/[^A-Z0-9]/g, "X") : `S${n}`,
        username: `sim_t${n}_${sfx}`,
        id: "",
        client: new Client(`team ${n}`),
        roster: Array.from({ length: 4 }, (_, p) => `T${n}_P${p + 1}`),
        prefs: [],
      };
      const r = await admin.post("/api/admin/teams", { teamName: t.name, tag: t.tag, captainName: `Captain ${n}`, username: t.username, password: PASSWORD });
      expectStatus(r, 200, 201);
      t.id = r.body.id;
      return t;
    });
    invitee = made.pop()!;
    teams.push(...made);
    for (const t of [...teams, invitee]) byId.set(t.id, t);
    T("create teams", Date.now() - t1);
    return `${made.length + 1} teams`;
  });

  await step("all teams sign in and save a 4-player roster", async () => {
    await mapLimit([...teams, invitee!], 8, async (t) => {
      expectStatus(await t.client.post("/api/auth/login", { username: t.username, password: PASSWORD }), 200);
      const r = await t.client.put("/api/team/roster", { players: t.roster.map((ign) => ({ ign })) });
      expectStatus(r, 200);
      check(r.body?.players?.length === 4, "roster not saved", r);
    });
  });

  // ---------------------------------------------------------------- create + publish
  const schedule = (start: string, end: string, windows: { start: string; end: string }[], parallelLobbies: number) => ({
    startDate: start,
    endDate: end,
    windows,
    excludeDates: [],
    matchMinutes: 40,
    breakMinutes: 5,
    parallelLobbies,
  });
  const stagesSpec = [
    {
      name: "Qualifier", teamsIn: 128, lobbySize: LOBBY, groupCount: 8, matchesPerGroup: 4,
      maps: ["ERANGEL", "MIRAMAR", "SANHOK", "ERANGEL"], advancePerGroup: 4, wildcardCount: 0, invitedSlots: 0,
      // two 3-hour windows × 2 lobbies → 4 groups/day → 4 time slots over 2 days, 32 teams each
      schedule: schedule(day1, addDays(day1, 3), [{ start: "12:00", end: "15:00" }, { start: "18:00", end: "21:00" }], 2),
    },
    {
      name: "Semi-final", teamsIn: 32, lobbySize: LOBBY, groupCount: 2, matchesPerGroup: 6,
      maps: ["ERANGEL", "MIRAMAR", "SANHOK", "ERANGEL", "VIKENDI", "MIRAMAR"], advancePerGroup: 7, wildcardCount: 1, invitedSlots: 0,
      schedule: schedule(addDays(day1, 5), addDays(day1, 6), [{ start: "18:00", end: "23:00" }], 2),
    },
    {
      name: "Final", teamsIn: 16, lobbySize: LOBBY, groupCount: 1, matchesPerGroup: 6,
      maps: ["ERANGEL", "MIRAMAR", "SANHOK", "ERANGEL", "VIKENDI", "MIRAMAR"], advancePerGroup: 0, wildcardCount: 0, invitedSlots: 1,
      schedule: schedule(addDays(day1, 8), addDays(day1, 8), [{ start: "18:00", end: "23:00" }], 1),
    },
  ];

  await step("manager creates \"Sim Cup\" (DRAFT, 3 stages)", async () => {
    const r = await manager.post("/api/manager/tournaments", {
      title: `Sim Cup ${sfx}`,
      description: "Simulated 128-team tournament",
      prize: "₹10,000",
      maxTeams: MAX_TEAMS,
      teamSize: 4,
      firstSlot: FIRST_SLOT,
      stages: stagesSpec,
    });
    expectStatus(r, 201, 200);
    tour = r.body;
    tid = tour.id;
    check(tour.status === "DRAFT", "status should be DRAFT", r);
    check(tour.stages?.length === 3, "expected 3 stages", r);
    const errors = (tour.issues ?? []).filter((i: any) => i.level === "error");
    check(!errors.length, `format has errors: ${JSON.stringify(errors)}`);
    stageIds = tour.stages.sort((a: any, b: any) => a.order - b.order).map((s: any) => s.id);
    check(tour.stages[1].teamsOut === 15, `semi teamsOut should be 15 (2×7+1), got ${tour.stages[1].teamsOut}`);
    return `id ${tid}; nextAction ${tour.nextAction?.key}; warnings ${(tour.issues ?? []).length}`;
  });

  await step("DRAFT is invisible to teams (404)", async () => {
    expectError(await teams[0]!.client.get(`/api/team/tournaments/${tid}`), [403, 404]);
    const l = await teams[0]!.client.get(`/api/team/tournaments?scope=open`);
    expectStatus(l, 200);
    check(!l.body.items.some((x: any) => x.id === tid), "DRAFT listed for teams", l);
  }, false);

  await step("another manager can't see or act on it", async () => {
    expectError(await manager2.get(M()), [403, 404]);
    expectError(await manager2.post(M("/publish")), [403, 404]);
  }, false);

  await step("manager publishes → REGISTRATION_OPEN with time slots", async () => {
    const r = await manager.post(M("/publish"));
    expectStatus(r, 200);
    tour = r.body;
    check(tour.status === "REGISTRATION_OPEN", "not open", r);
    slotIds = (tour.slotOptions ?? []).map((o: any) => o.id);
    check(slotIds.length >= 2, "expected ≥2 stage-1 time slots", r);
    const cap = tour.slotOptions.reduce((s: number, o: any) => s + o.capacity, 0);
    check(cap >= MAX_TEAMS, `slot capacity ${cap} < ${MAX_TEAMS}`);
    const plan = tour.stages[0].plan;
    return `${slotIds.length} slots (${tour.slotOptions.map((o: any) => `${o.label}:${o.capacity}`).join(", ")}); plan ${plan?.days ?? "?"} days${plan?.suggestions?.length ? `; tips: ${plan.suggestions.join(" | ")}` : ""}`;
  });

  // ---------------------------------------------------------------- registration
  let waitlisted: SimTeam[] = [];
  await step(`${TEAMS} teams register concurrently → 128 CONFIRMED + 2 WAITLISTED`, async () => {
    for (const t of teams) {
      // ~15% "any time"; others rank 1–3 slots, skewed so the first slot is over-subscribed (≈55% want it first)
      if (rand() < 0.15) t.prefs = [];
      else {
        const order = rand() < 0.55 ? [slotIds[0]!, ...shuffle(slotIds.slice(1))] : shuffle(slotIds);
        t.prefs = order.slice(0, randInt(1, Math.min(3, slotIds.length)));
      }
    }
    const t1 = Date.now();
    const rs = await Promise.all(teams.map((t) => t.client.post(`/api/team/tournaments/${tid}/entry`, { timePreferences: t.prefs })));
    T("130 concurrent registrations", Date.now() - t1);
    const bad = rs.filter((r) => r.status !== 201 && r.status !== 200);
    check(!bad.length, `${bad.length} registrations failed, e.g. ${bad[0] && describe(bad[0])}`);
    rs.forEach((r, i) => (teams[i]!.entryStatus = r.body?.state));
    const states = rs.map((r) => r.body?.state);
    const conf = states.filter((s) => s === "CONFIRMED").length;
    const wait = states.filter((s) => s === "WAITLISTED").length;
    check(conf === 128 && wait === 2, `got ${conf} CONFIRMED / ${wait} WAITLISTED (states: ${[...new Set(states)].join(",")})`);
    waitlisted = teams.filter((t) => t.entryStatus === "WAITLISTED");
    return `${Date.now() - t1}ms for 130 requests; waitlisted: ${waitlisted.map((t) => t.name).join(", ")}`;
  });

  let entries: any[] = [];
  await step("entries list: confirmed by registration time, then waitlist #1, #2", async () => {
    const r = await manager.get(M("/entries"));
    expectStatus(r, 200);
    entries = r.body.items;
    const conf = entries.filter((e) => e.status === "CONFIRMED");
    const wl = entries.filter((e) => e.status === "WAITLISTED");
    check(conf.length === 128 && wl.length === 2, `entries ${conf.length}/${wl.length}`);
    const firstWl = entries.findIndex((e) => e.status === "WAITLISTED");
    check(firstWl === 128, "confirmed entries must come first");
    for (let i = 1; i < conf.length; i++) check(conf[i - 1].registeredAt <= conf[i].registeredAt, "confirmed not ordered by registeredAt");
    check(wl[0].waitlistPosition === 1 && wl[1].waitlistPosition === 2, `waitlist positions ${wl.map((e) => e.waitlistPosition)}`);
    check(wl.every((w: any) => w.registeredAt >= conf[conf.length - 1].registeredAt), "a waitlisted team registered before a confirmed one (FCFS broken)");
    // keep the order the API says is first-come
    waitlisted = wl.map((e: any) => byId.get(e.team.id)!);
    const tsum = await manager.get(M());
    check(tsum.body.confirmedCount === 128 && tsum.body.waitlistCount === 2, `counts ${tsum.body.confirmedCount}/${tsum.body.waitlistCount}`);
  });

  await step("duplicate registration → 409 CONFLICT", async () => {
    expectError(await teams[0]!.client.post(`/api/team/tournaments/${tid}/entry`, { timePreferences: [] }), 409);
  }, false);

  await step("waitlisted team sees WAITLISTED (position 1)", async () => {
    const r = await waitlisted[0]!.client.get(`/api/team/tournaments/${tid}`);
    expectStatus(r, 200);
    check(r.body.me?.state === "WAITLISTED", `state ${r.body.me?.state}`, r);
    check(r.body.me?.entry?.waitlistPosition === 1, `position ${r.body.me?.entry?.waitlistPosition}`);
    return `nextGoal: ${JSON.stringify(r.body.me.nextGoal)}`;
  }, false);

  let withdrawn: SimTeam | null = null;
  await step("a confirmed team withdraws → waitlist #1 auto-confirmed", async () => {
    const confirmedEntries = entries.filter((e) => e.status === "CONFIRMED");
    withdrawn = byId.get(confirmedEntries[10].team.id)!;
    expectStatus(await withdrawn.client.del(`/api/team/tournaments/${tid}/entry`), 204);
    const r = await manager.get(M("/entries"));
    entries = r.body.items;
    const promoted = entries.find((e) => e.team.id === waitlisted[0]!.id);
    check(promoted?.status === "CONFIRMED", `first waitlisted is ${promoted?.status}`);
    const wl = entries.filter((e) => e.status === "WAITLISTED");
    check(wl.length === 1 && wl[0].team.id === waitlisted[1]!.id && wl[0].waitlistPosition === 1, "remaining waitlist wrong");
    check(entries.filter((e) => e.status === "CONFIRMED").length === 128, "confirmed count != 128");
    const me = await withdrawn.client.get(`/api/team/tournaments/${tid}`);
    check(["WITHDRAWN", "NOT_REGISTERED"].includes(me.body.me?.state), `withdrawn team state ${me.body.me?.state}`);
    waitlisted[0]!.entryStatus = "CONFIRMED";
    withdrawn.entryStatus = "WITHDRAWN";
    return `${withdrawn.name} out, ${waitlisted[0]!.name} in; withdrawn sees ${me.body.me.state}`;
  });

  await step("team changes its time preferences (PUT entry)", async () => {
    const t = teams.find((x) => x.entryStatus === "CONFIRMED")!;
    t.prefs = [...slotIds].reverse().slice(0, 2);
    const r = await t.client.put(`/api/team/tournaments/${tid}/entry`, { timePreferences: t.prefs });
    expectStatus(r, 200);
    check(JSON.stringify(r.body.entry?.timePreferences) === JSON.stringify(t.prefs), "preferences not saved", r);
  }, false);

  await step("invites: stage 1 rejected, invitee into the Final accepted", async () => {
    expectError(await manager.post(M("/invites"), { teamId: invitee!.id, stageOrder: 1 }), 400);
    const r = await manager.post(M("/invites"), { teamId: invitee!.id, stageOrder: 3 });
    expectStatus(r, 200, 201);
    check(r.body.type === "INVITED" && r.body.entryStage === 3, "invite row wrong", r);
    const me = await invitee!.client.get(`/api/team/tournaments/${tid}`);
    return `invitee state ${me.body?.me?.state}`;
  });

  await step("admin list shows Sim Cup with live counts", async () => {
    const r = await admin.get("/api/admin/tournaments");
    expectStatus(r, 200);
    const s = r.body.items.find((x: any) => x.id === tid);
    check(s, "Sim Cup missing from admin list", r);
    check(s.confirmedCount === 128 && s.waitlistCount === 1, `admin counts ${s.confirmedCount}/${s.waitlistCount}`);
    check(s.manager?.id && s.manager.displayName === mgr.displayName, "manager missing on summary");
    return `${r.body.items.length} tournaments visible to admin`;
  });

  await step("admin closes registration (admin mirror) → late sign-up 409", async () => {
    const r = await admin.post(A("/close-registration"));
    expectStatus(r, 200);
    check(r.body.status === "REGISTRATION_CLOSED", `status ${r.body.status}`, r);
    expectError(await withdrawn!.client.post(`/api/team/tournaments/${tid}/entry`, { timePreferences: [] }), 409, "REGISTRATION_CLOSED");
    const ro = await admin.post(A("/reopen-registration"));
    expectStatus(ro, 200);
    check(ro.body.status === "REGISTRATION_OPEN", `reopen → ${ro.body.status}`, ro);
    const cl = await admin.post(A("/close-registration"));
    check(cl.body.status === "REGISTRATION_CLOSED", `close again → ${cl.body.status}`, cl);
    return "close → reopen → close";
  });

  // ---------------------------------------------------------------- stage 1 draw
  let s1: { groups: Group[] } & Record<string, any> = { groups: [] };
  await step("draw Qualifier → 8 groups × 16, unique slots, every confirmed team once", async () => {
    const t1 = Date.now();
    const r = await manager.post(M(`/stages/${stageIds[0]}/draw`), { seed: `sim-${SIM_SEED}` });
    T("draw stage 1", Date.now() - t1);
    expectStatus(r, 200);
    s1 = r.body;
    check(s1.stage?.status === "DRAWN", `stage status ${s1.stage?.status}`, r);
    check(s1.groups.length === 8, `groups ${s1.groups.length}`);
    const seen = new Set<string>();
    for (const g of s1.groups) {
      check(g.teams.length === LOBBY, `group ${g.name} has ${g.teams.length} teams`);
      const slots = g.teams.map((x) => x.slotNumber);
      check(new Set(slots).size === LOBBY, `group ${g.name} duplicate slots ${slots}`);
      check(slots.every((s) => s >= FIRST_SLOT && s < FIRST_SLOT + LOBBY), `group ${g.name} slot out of range ${slots}`);
      check(g.matches.length === 4, `group ${g.name} has ${g.matches.length} matches`);
      for (const x of g.teams) {
        check(!seen.has(x.team.id), `${x.team.name} drawn twice`);
        seen.add(x.team.id);
      }
    }
    const confirmed = new Set(entries.filter((e) => e.status === "CONFIRMED").map((e) => e.team.id));
    check(seen.size === 128 && [...confirmed].every((id) => seen.has(id)), "drawn teams ≠ confirmed teams");
    check(!seen.has(waitlisted[1]!.id) && !seen.has(withdrawn!.id) && !seen.has(invitee!.id), "waitlisted/withdrawn/invited team drawn into stage 1");
    expectError(await admin.post(A("/reopen-registration")), [400, 409]);
    return `seed ${s1.stage.drawSeed}; reopen after draw refused`;
  });

  await step("time preferences honoured (stats + first-come guarantee)", async () => {
    // group → slot id via block start instants
    const slotOf = new Map<string, string>(); // teamId → slot id
    const norm = (iso: string) => new Date(iso).getTime();
    const optByTime = new Map<number, string>(slotIds.map((id) => [norm(id), id]));
    for (const g of s1.groups) {
      const start = g.startsAt ?? g.matches[0]?.scheduledAt ?? null;
      check(start, `group ${g.name} has no start time`);
      const sid = optByTime.get(norm(start));
      check(sid, `group ${g.name} start ${start} matches no slot option`);
      for (const x of g.teams) slotOf.set(x.team.id, sid);
    }
    const confirmed = entries.filter((e) => e.status === "CONFIRMED").sort((a, b) => a.registeredAt.localeCompare(b.registeredAt));
    let withPrefs = 0, first = 0, any = 0, unmet = 0;
    const firstComeMiss: string[] = [];
    // per-slot capacity: first teams (by registration) must always get their first choice while it has room
    const cap = new Map<string, number>(tour.slotOptions.map((o: any) => [o.id, o.capacity]));
    const used = new Map<string, number>();
    for (const e of confirmed) {
      const t = byId.get(e.team.id)!;
      const prefs: string[] = t.prefs;
      const got = slotOf.get(t.id)!;
      if (!prefs.length) continue;
      withPrefs++;
      if (got === prefs[0]) first++;
      if (prefs.includes(got)) any++;
      else unmet++;
      // greedy expectation for the head of the queue
      const want = prefs.find((p) => (used.get(p) ?? 0) < (cap.get(p) ?? 0));
      if (want) {
        used.set(want, (used.get(want) ?? 0) + 1);
        if (got !== want) firstComeMiss.push(`${t.name} wanted ${want} got ${got}`);
      }
    }
    const apiUnmet = (s1.unmetPreferences ?? []).length;
    check(apiUnmet === unmet, `API reports ${apiUnmet} unmet preferences, computed ${unmet}`);
    check(!firstComeMiss.length, `${firstComeMiss.length} teams didn't get the slot first-come order entitles them to, e.g. ${firstComeMiss.slice(0, 3).join("; ")}`);
    return `${withPrefs} teams with preferences: ${first} got 1st choice, ${any} got a ranked choice, ${unmet} unmet (${Math.round((any / withPrefs) * 100)}%)`;
  }, false);

  await step("guards after the draw: withdraw refused, stage 2 draw refused, complete refused", async () => {
    const drawnTeam = byId.get(s1.groups[0]!.teams[0]!.team.id)!;
    expectError(await drawnTeam.client.del(`/api/team/tournaments/${tid}/entry`), [400, 409]);
    expectError(await manager.post(M(`/stages/${stageIds[1]}/draw`), {}), [400, 409]);
    expectError(await admin.post(A("/complete")), [400, 409]);
    expectError(await drawnTeam.client.put(`/api/team/tournaments/${tid}/entry`, { timePreferences: [] }), [400, 409]);
  }, false);

  await step("redraw with the same seed is identical (deterministic draw)", async () => {
    const r = await manager.post(M(`/stages/${stageIds[0]}/redraw`), { seed: `sim-${SIM_SEED}` });
    expectStatus(r, 200);
    const sig = (gs: Group[]) => gs.map((g) => g.teams.map((x) => `${x.team.id}@${x.slotNumber}`).sort().join(",")).join("|");
    check(sig(r.body.groups) === sig(s1.groups), "same seed produced a different draw");
    s1 = r.body;
  }, false);

  await step("start Qualifier → stage LIVE, tournament LIVE", async () => {
    const r = await manager.post(M(`/stages/${stageIds[0]}/start`));
    expectStatus(r, 200);
    check(r.body.stage?.status === "LIVE", `stage ${r.body.stage?.status}`, r);
    const t = await manager.get(M());
    check(t.body.status === "LIVE", `tournament ${t.body.status}`);
    s1 = r.body;
  });

  await step("playing team: PLAYING, group, slot, nextGoal, nextMatch", async () => {
    const g = s1.groups[2]!;
    const row = g.teams[0]!;
    const r = await byId.get(row.team.id)!.client.get(`/api/team/tournaments/${tid}`);
    expectStatus(r, 200);
    const me = r.body.me;
    check(me.state === "PLAYING", `state ${me.state}`, r);
    check(me.groupName === g.name && me.slotNumber === row.slotNumber, `group/slot ${me.groupName}/${me.slotNumber} vs ${g.name}/${row.slotNumber}`);
    check(me.nextGoal && /4/.test(me.nextGoal), `nextGoal ${JSON.stringify(me.nextGoal)}`);
    check(me.nextMatch?.number === 1, `nextMatch ${JSON.stringify(me.nextMatch)}`);
    check(me.assignedSlot, "assignedSlot missing");
    return `nextGoal: "${me.nextGoal}"`;
  }, false);

  // ---------------------------------------------------------------- playing matches
  /** Submit lineup (if needed), results and publish for one match. placements: teamId → [placement, kills]. */
  async function playMatch(stageId: string, group: Group, matchId: string, res: Map<string, [number, number]>) {
    const d = await manager.get(`/api/manager/matches/${matchId}`);
    expectStatus(d, 200);
    const slotTeam = new Map(group.teams.map((x) => [x.slotNumber, x.team.id]));
    if (["SCHEDULED", "LINEUP_REVIEW"].includes(d.body.match?.status)) {
      const lineup = {
        confirm: true,
        teams: [...slotTeam].map(([slotNumber, teamId]) => ({ slotNumber, players: byId.get(teamId)!.roster.map((name, p) => ({ position: p + 1, name })) })),
      };
      const l = await manager.put(`/api/manager/matches/${matchId}/lineup`, lineup);
      expectStatus(l, 200);
      const mapped = l.body.teams.filter((x: any) => x.team).length;
      check(mapped === group.teams.length, `lineup maps ${mapped}/${group.teams.length} slots to teams (match ${matchId})`, l);
      for (const x of l.body.teams) check(slotTeam.get(x.slotNumber) === x.team?.id, `slot ${x.slotNumber} mapped to wrong team in match ${matchId}`);
    }
    // split each team's kills across its 4 players (per-player kills feed the top fraggers list)
    const frags = fragTruth.get(stageId) ?? new Map<string, number>();
    fragTruth.set(stageId, frags);
    const body = {
      teams: [...slotTeam].map(([slotNumber, teamId]) => {
        const [placement, kills] = res.get(teamId)!;
        const split = [0, 0, 0, 0];
        for (let k = 0; k < kills; k++) split[randInt(0, 3)]!++;
        return { slotNumber, placement, kills, players: split.map((pk, p) => ({ position: p + 1, kills: pk })) };
      }),
    };
    const pending: [string, number][] = body.teams.flatMap((t) => t.players.map((pl) => [byId.get(slotTeam.get(t.slotNumber)!)!.roster[pl.position - 1]!, pl.kills] as [string, number]));
    expectStatus(await manager.put(`/api/manager/matches/${matchId}/results`, body), 200);
    const p = await manager.post(`/api/manager/matches/${matchId}/publish`);
    expectStatus(p, 200);
    check(p.body.match?.status === "PUBLISHED", `match not published`, p);
    for (const [teamId, [pl, k]] of res) record(stageId, teamId, pl, k);
    for (const [name, k] of pending) frags.set(name, (frags.get(name) ?? 0) + k);
  }

  function randomResults(group: Group): Map<string, [number, number]> {
    const order = shuffle(group.teams.map((x) => x.team.id));
    return new Map(order.map((id, i) => [id, [i + 1, randInt(0, 6)] as [number, number]]));
  }

  /** Engineered group: T0..T2 dominate, T3/T4 tie exactly on points, wins, placement points and kills at the 4/5 cut-off. */
  function tieResults(group: Group, matchNo: number): Map<string, [number, number]> {
    const ids = [...group.teams].sort((a, b) => a.slotNumber - b.slotNumber).map((x) => x.team.id);
    const [t0, t1, t2, t3, t4, ...rest] = ids as [string, string, string, string, string, ...string[]];
    const m = new Map<string, [number, number]>();
    const top = [t0, t1, t2];
    top.forEach((id, k) => m.set(id, [((k + matchNo) % 3) + 1, 0])); // places 1..3 rotate
    const odd = matchNo % 2 === 1;
    m.set(t3, [odd ? 5 : 6, 2]);
    m.set(t4, [odd ? 6 : 5, 2]);
    // places 4 and 7..16 for the rest; place 4 rotates among rest[0..3] (each ≤ 4 + 1 + … < 18 pts)
    const others = [4, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    const rot = rest.map((_, k) => rest[(k + matchNo - 1) % rest.length]!);
    rot.forEach((id, k) => m.set(id, [others[k]!, 0]));
    return m;
  }

  async function playStage(stageIdx: number, stage: { groups: Group[] }, opts: { holdBack?: boolean; tieGroup?: number } = {}) {
    const stageId = stageIds[stageIdx]!;
    const held: { group: Group; matchId: string; res: Map<string, [number, number]> }[] = [];
    await mapLimit(stage.groups, 8, async (g) => {
      const ms = [...g.matches].sort((a, b) => a.number - b.number);
      for (const m of ms) {
        const res = opts.tieGroup === g.index ? tieResults(g, m.number) : randomResults(g);
        if (opts.holdBack && g.index === stage.groups.length - 1 && m === ms[ms.length - 1]) {
          held.push({ group: g, matchId: m.id, res });
          continue;
        }
        await playMatch(stageId, g, m.id, res);
      }
    });
    return held;
  }

  async function verifyStandings(stageIdx: number) {
    const r = await manager.get(M(`/stages/${stageIds[stageIdx]}`));
    expectStatus(r, 200);
    const tr = truth.get(stageIds[stageIdx]!)!;
    for (const g of r.body.groups as Group[]) {
      for (const x of g.teams) {
        const a = tr.get(x.team.id);
        check(a, `no local results for ${x.team.name}`);
        check(
          x.totalPoints === a.total && x.kills === a.kills && x.wins === a.wins && x.matchesPlayed === a.mp,
          `group ${g.name} ${x.team.name}: API ${x.totalPoints}pts/${x.kills}k/${x.wins}w/${x.matchesPlayed}mp vs expected ${a.total}/${a.kills}/${a.wins}/${a.mp}`,
        );
      }
      const ranks = g.teams.map((x) => x.rank);
      for (let i = 1; i < g.teams.length; i++) check(g.teams[i - 1]!.totalPoints >= g.teams[i]!.totalPoints && ranks[i - 1]! <= ranks[i]!, `group ${g.name} standings not sorted`);
    }
    return r.body;
  }

  let held: Awaited<ReturnType<typeof playStage>> = [];
  await step("play Qualifier: 31 of 32 matches (lineup → results → publish), group A engineered tie", async () => {
    const t1 = Date.now();
    held = await playStage(0, s1, { holdBack: true, tieGroup: 0 });
    T("play stage 1", Date.now() - t1);
    return `${31} matches in ${Date.now() - t1}ms`;
  });

  await step("promotion preview blocks while a match is unpublished", async () => {
    const r = await manager.get(M(`/stages/${stageIds[0]}/promotion`));
    expectStatus(r, 200);
    check(r.body.ready === false && r.body.blockers.length > 0, "expected ready=false with blockers", r);
    expectError(await manager.post(M(`/stages/${stageIds[0]}/promote`), { include: [], exclude: [] }), [400, 409]);
    return `blocker: "${r.body.blockers[0]}"`;
  }, false);

  await step("play the last Qualifier match", async () => {
    for (const h of held) await playMatch(stageIds[0]!, h.group, h.matchId, h.res);
  });

  let s1Final: { groups: Group[] } = { groups: [] };
  await step("Qualifier standings match locally computed points (all 128 teams)", async () => {
    s1Final = await verifyStandings(0);
  });

  let preview1: any = null;
  await step("promotion preview: ready, 32 qualified (top 4 × 8), tie at cut-off flagged in Group A", async () => {
    const r = await manager.get(M(`/stages/${stageIds[0]}/promotion`));
    expectStatus(r, 200);
    preview1 = r.body;
    check(preview1.ready === true && preview1.blockers.length === 0, `not ready: ${JSON.stringify(preview1.blockers)}`, r);
    check(preview1.qualified.length === 32 && preview1.eliminated.length === 96, `qualified ${preview1.qualified.length} eliminated ${preview1.eliminated.length}`);
    check(preview1.qualified.every((c: any) => c.via === "TOP" && c.groupRank <= 4), "a qualifier isn't top-4 TOP");
    check(preview1.nextStage?.teamsIn === 32, `nextStage ${JSON.stringify(preview1.nextStage)}`);
    const gA = s1Final.groups.find((g) => g.index === 0)!;
    const [r4, r5] = [gA.teams[3]!, gA.teams[4]!];
    check(r4.totalPoints === r5.totalPoints, `engineered tie didn't happen (${r4.totalPoints} vs ${r5.totalPoints})`);
    check(preview1.tiesAtCutoff.some((s: string) => /\bA\b/.test(s) || s.includes(r4.team.name) || s.includes(r5.team.name)), `tie at Group A cut-off not flagged: ${JSON.stringify(preview1.tiesAtCutoff)}`);
    return `ties: ${JSON.stringify(preview1.tiesAtCutoff)}`;
  }, false);

  await step("promote Qualifier (double-click: 2 concurrent requests) → COMPLETED, ADVANCED/ELIMINATED", async () => {
    const pair = await Promise.all([0, 1].map(() => manager.post(M(`/stages/${stageIds[0]}/promote`), { include: [], exclude: [] })));
    const oks = pair.filter((x) => x.status === 200);
    check(oks.length === 1, `double-click promote: statuses ${pair.map((x) => x.status).join(",")} — ${pair.map(describe).join(" ;; ")}`);
    const r = oks[0]!;
    check(r.body.stages.find((s: any) => s.id === stageIds[0]).status === "COMPLETED", "stage 1 not COMPLETED", r);
    const d = await manager.get(M(`/stages/${stageIds[0]}`));
    const all = (d.body.groups as Group[]).flatMap((g) => g.teams);
    const adv = all.filter((x) => x.status === "ADVANCED").length;
    const elim = all.filter((x) => x.status === "ELIMINATED").length;
    check(adv === 32 && elim === 96, `ADVANCED ${adv} ELIMINATED ${elim}`);
    s1Final = d.body;
    return `nextAction ${r.body.nextAction?.key}`;
  });

  await step("promote twice → refused; other manager can't open a tournament match", async () => {
    expectError(await manager.post(M(`/stages/${stageIds[0]}/promote`), { include: [], exclude: [] }), [400, 409]);
    expectError(await manager2.get(`/api/manager/matches/${s1.groups[0]!.matches[0]!.id}`), [403, 404]);
    expectError(await manager2.put(`/api/manager/matches/${s1.groups[0]!.matches[0]!.id}/results`, { teams: [] }), [403, 404]);
  }, false);

  await step("team views: qualified / eliminated / waitlisted (state + nextGoal)", async () => {
    const all = s1Final.groups.flatMap((g) => g.teams);
    const q = byId.get(all.find((x) => x.status === "ADVANCED")!.team.id)!;
    const e = byId.get(all.find((x) => x.status === "ELIMINATED")!.team.id)!;
    const w = waitlisted[1]!;
    const [rq, re, rw] = await Promise.all([q, e, w].map((t) => t.client.get(`/api/team/tournaments/${tid}`)));
    const notes: string[] = [];
    check(["QUALIFIED", "PLAYING"].includes(rq!.body.me?.state), `qualified team state ${rq!.body.me?.state}`, rq);
    check(rq!.body.me.nextGoal, "qualified team has no nextGoal", rq);
    notes.push(`qualified=${rq!.body.me.state} "${rq!.body.me.nextGoal}"`);
    check(re!.body.me?.state === "ELIMINATED", `eliminated team state ${re!.body.me?.state}`, re);
    notes.push(`eliminated nextGoal=${JSON.stringify(re!.body.me.nextGoal)}`);
    check(rw!.body.me?.state === "WAITLISTED", `waitlisted team state ${rw!.body.me?.state}`, rw);
    check(rw!.body.me.canRegister === false, "waitlisted team can register after close");
    notes.push(`waitlisted nextGoal=${JSON.stringify(rw!.body.me.nextGoal)}`);
    return notes.join("; ");
  }, false);

  await step("admin removes the waitlisted team's entry (admin mirror DELETE)", async () => {
    const e = await admin.get(A("/entries"));
    const wl = e.body.items.find((x: any) => x.team.id === waitlisted[1]!.id);
    check(wl?.status === "WAITLISTED", `waitlisted entry ${wl?.status}`, e);
    expectStatus(await admin.del(A(`/entries/${wl.id}`)), 204);
    const after = await admin.get(A("/entries"));
    check(!after.body.items.some((x: any) => x.id === wl.id && x.status === "WAITLISTED"), "entry still waitlisted");
    check(after.body.items.filter((x: any) => x.status === "CONFIRMED").length >= 128, "confirmed teams changed");
    const me = await waitlisted[1]!.client.get(`/api/team/tournaments/${tid}`);
    return `removed team now sees ${me.body.me?.state}`;
  }, false);

  // ---------------------------------------------------------------- stage 2 (snake)
  let s2: { groups: Group[] } & Record<string, any> = { groups: [] };
  await step("draw Semi-final → snake seeding (A1,B1,B2,A2,…) by qualifier rank", async () => {
    // double-click: two concurrent draws must produce exactly one draw
    const pair = await Promise.all([0, 1].map(() => manager.post(M(`/stages/${stageIds[1]}/draw`), { seed: `sim2-${SIM_SEED}` })));
    const oks = pair.filter((x) => x.status === 200);
    check(oks.length >= 1, `no draw succeeded: ${pair.map(describe).join(" ;; ")}`);
    const fresh = await manager.get(M(`/stages/${stageIds[1]}`));
    const placed = (fresh.body.groups as Group[]).reduce((n, g) => n + g.teams.length, 0);
    check(oks.length === 1 && placed === 32, `double-click draw: statuses ${pair.map((x) => x.status).join(",")}, ${placed} teams placed, ${fresh.body.groups.length} groups`);
    const r = fresh;
    s2 = r.body;
    check(s2.groups.length === 2 && s2.groups.every((g) => g.teams.length === 16), `groups ${s2.groups.map((g) => g.teams.length)}`);
    const seeds = s2.groups.flatMap((g) => g.teams.map((x) => ({ seed: x.seed!, group: g.index, id: x.team.id, slot: x.slotNumber })));
    check(seeds.every((s) => typeof s.seed === "number"), "seeds missing");
    const sorted = [...seeds].sort((a, b) => a.seed - b.seed);
    check(sorted.map((s) => s.seed).join() === Array.from({ length: 32 }, (_, i) => i + 1).join(), "seeds aren't 1..32");
    for (const s of sorted) check(snakeGroup(s.seed - 1, 2) === s.group, `seed ${s.seed} in group ${groupLetter(s.group)}, snake says ${groupLetter(snakeGroup(s.seed - 1, 2))}`);
    for (const g of s2.groups) check(new Set(g.teams.map((x) => x.slotNumber)).size === 16, `group ${g.name} duplicate slots`);
    // seed bands: 1–8 = qualifier group winners, 9–16 = runners-up …, each band by points desc
    const prev = new Map(s1Final.groups.flatMap((g) => g.teams.map((x) => [x.team.id, x] as const)));
    for (let s = 0; s < 32; s++) {
      const p = prev.get(sorted[s]!.id)!;
      check(p.status === "ADVANCED", `seed ${s + 1} didn't advance from the qualifier`);
      check(p.rank === Math.floor(s / 8) + 1, `seed ${s + 1} had group rank ${p.rank}, expected ${Math.floor(s / 8) + 1}`);
      if (s % 8) check(prev.get(sorted[s - 1]!.id)!.totalPoints >= p.totalPoints, `seed ${s} → ${s + 1} not ordered by points`);
    }
    return `A seeds ${s2.groups[0]!.teams.map((x) => x.seed).sort((a, b) => a! - b!).join(",")}`;
  });

  await step("play Semi-final (12 matches) + verify standings", async () => {
    expectStatus(await manager.post(M(`/stages/${stageIds[1]}/start`)), 200);
    const t1 = Date.now();
    await playStage(1, s2);
    T("play stage 2", Date.now() - t1);
    await verifyStandings(1);
  });

  await step("promotion preview: 14 TOP + 1 WILDCARD = best 8th-or-lower by points per match", async () => {
    const r = await manager.get(M(`/stages/${stageIds[1]}/promotion`));
    expectStatus(r, 200);
    const p = r.body;
    check(p.ready, `not ready ${JSON.stringify(p.blockers)}`, r);
    const top = p.qualified.filter((c: any) => c.via === "TOP");
    const wc = p.qualified.filter((c: any) => c.via === "WILDCARD");
    check(top.length === 14 && wc.length === 1, `TOP ${top.length} WILDCARD ${wc.length}`);
    const d = await manager.get(M(`/stages/${stageIds[1]}`));
    const rest = (d.body.groups as Group[]).flatMap((g) => g.teams.filter((x) => x.rank > 7));
    const bestPpm = Math.max(...rest.map((x) => x.totalPoints / Math.max(1, x.matchesPlayed)));
    check(Math.abs(wc[0].pointsPerMatch - bestPpm) < 1e-6, `wildcard ppm ${wc[0].pointsPerMatch} but best remaining is ${bestPpm}`);
    check(p.nextStage?.invited?.some((t: any) => t.id === invitee!.id), "invitee not listed for the Final");
    const pr = await manager.post(M(`/stages/${stageIds[1]}/promote`), { include: [], exclude: [] });
    expectStatus(pr, 200);
    return `wildcard ${wc[0].team.name} (${wc[0].groupName}${wc[0].groupRank}, ${wc[0].pointsPerMatch.toFixed(2)} ppm)`;
  });

  // ---------------------------------------------------------------- final
  let s3: { groups: Group[] } & Record<string, any> = { groups: [] };
  await step("draw Final → 16 teams, invited team takes seed 1", async () => {
    const r = await manager.post(M(`/stages/${stageIds[2]}/draw`), { seed: `sim3-${SIM_SEED}` });
    expectStatus(r, 200);
    s3 = r.body;
    check(s3.groups.length === 1 && s3.groups[0]!.teams.length === 16, `final shape ${s3.groups.map((g) => g.teams.length)}`);
    const inv = s3.groups[0]!.teams.find((x) => x.team.id === invitee!.id);
    check(inv, "invitee not in the Final");
    check(inv.seed === 1, `invitee seed ${inv.seed}`);
  });

  await step("play Final (6 matches) + verify standings", async () => {
    expectStatus(await manager.post(M(`/stages/${stageIds[2]}/start`)), 200);
    await playStage(2, s3);
    s3 = await verifyStandings(2);
  });

  await step("finish Final (promote last stage) → COMPLETED, nextAction COMPLETE", async () => {
    const p = await manager.get(M(`/stages/${stageIds[2]}/promotion`));
    expectStatus(p, 200);
    check(p.body.ready && p.body.nextStage === null, `final preview ${JSON.stringify({ ready: p.body.ready, next: p.body.nextStage })}`, p);
    const r = await manager.post(M(`/stages/${stageIds[2]}/promote`), { include: [], exclude: [] });
    expectStatus(r, 200);
    check(r.body.stages.every((s: any) => s.status === "COMPLETED"), "not all stages completed", r);
    return `nextAction ${r.body.nextAction?.key}`;
  });

  let champion: SimTeam | null = null;
  await step("admin completes the tournament → champion = Final #1", async () => {
    const r = await admin.post(A("/complete"));
    expectStatus(r, 200);
    check(r.body.status === "COMPLETED", `status ${r.body.status}`, r);
    const top = s3.groups[0]!.teams.find((x) => x.rank === 1)!;
    check(r.body.champion?.id === top.team.id, `champion ${r.body.champion?.name} but Final #1 is ${top.team.name}`);
    champion = byId.get(top.team.id)!;
    return `🏆 ${champion.name} (${top.totalPoints} pts)`;
  });

  await step("team views after the final: CHAMPION / ELIMINATED, completed list", async () => {
    const r = await champion!.client.get(`/api/team/tournaments/${tid}`);
    check(r.body.me?.state === "CHAMPION", `champion sees ${r.body.me?.state}`, r);
    const loser = byId.get(s3.groups[0]!.teams.find((x) => x.rank === 16)!.team.id)!;
    const l = await loser.client.get(`/api/team/tournaments/${tid}`);
    check(l.body.me?.state === "ELIMINATED", `final loser sees ${l.body.me?.state}`, l);
    const list = await loser.client.get(`/api/team/tournaments?scope=completed`);
    expectStatus(list, 200);
    check(list.body.items.some((x: any) => x.id === tid), "not in completed list", list);
    const mine = await loser.client.get(`/api/team/tournaments?scope=mine`);
    check(mine.body.items.some((x: any) => x.id === tid), "not in mine list", mine);
  }, false);

  await step("public stage view + published scorecard visible to any team", async () => {
    const outsider = withdrawn!;
    const st = await outsider.client.get(`/api/team/tournaments/${tid}/stages/${stageIds[0]}`);
    expectStatus(st, 200);
    check(st.body.groups.length === 8, "public stage groups", st);
    const mid = s3.groups[0]!.matches[0]!.id;
    const sc = await outsider.client.get(`/api/team/matches/${mid}`);
    expectStatus(sc, 200);
    const tf = st.body.topFraggers ?? [];
    check(tf.length > 0, "no top fraggers although per-player kills were published", st);
    const best = Math.max(...fragTruth.get(stageIds[0]!)!.values());
    check(tf[0].kills === best, `top fragger has ${tf[0].kills} kills, expected ${best}`);
    check(fragTruth.get(stageIds[0]!)!.get(tf[0].name) === tf[0].kills, `top fragger ${tf[0].name} kills mismatch`);
    check((st.body.topTeams ?? []).length > 0, "no top teams");
    return `top fragger ${tf[0].name} ${tf[0].kills} kills; ${tf.length} fraggers, ${st.body.topTeams.length} top teams`;
  }, false);

  await step("admin views: detail, entries, every stage", async () => {
    const d = await admin.get(A());
    expectStatus(d, 200);
    check(d.body.champion?.id === champion!.id && d.body.nextAction?.key === "DONE", `detail champion/nextAction ${d.body.champion?.name}/${d.body.nextAction?.key}`, d);
    const e = await admin.get(A("/entries"));
    expectStatus(e, 200);
    for (const sid of stageIds) expectStatus(await admin.get(A(`/stages/${sid}`)), 200);
    const l = await admin.get("/api/admin/tournaments");
    check(l.body.items.find((x: any) => x.id === tid)?.status === "COMPLETED", "admin list status");
  }, false);

  await step("admin can cancel any manager's tournament (separate draft)", async () => {
    const c = await manager2.post("/api/manager/tournaments", { title: `Sim Cancel ${sfx}`, maxTeams: 16, stages: [{ ...stagesSpec[2], teamsIn: 16, invitedSlots: 0 }] });
    expectStatus(c, 201, 200);
    const r = await admin.post(`/api/admin/tournaments/${c.body.id}/cancel`);
    expectStatus(r, 200);
    check(r.body.status === "CANCELLED", `status ${r.body.status}`, r);
  }, false);

  await step("broken format → issues with errors, publish refused (400)", async () => {
    const bad = { ...stagesSpec[1], teamsIn: 30, schedule: stagesSpec[0]!.schedule }; // 30 ≠ 2×16 groups and ≠ maxTeams
    const c = await manager2.post("/api/manager/tournaments", { title: `Sim Broken ${sfx}`, maxTeams: 32, stages: [bad, { ...stagesSpec[2], teamsIn: 15, invitedSlots: 0 }] });
    expectStatus(c, 201, 200);
    check((c.body.issues ?? []).some((i: any) => i.level === "error"), `no format errors reported: ${JSON.stringify(c.body.issues)}`, c);
    expectError(await manager2.post(`/api/manager/tournaments/${c.body.id}/publish`), 400);
    return (c.body.issues ?? []).filter((i: any) => i.level === "error").map((i: any) => i.message).join(" | ");
  }, false);

  await step("race: 2 simultaneous withdrawals with 2 waitlisted → both promoted, still full", async () => {
    const final1 = {
      name: "Final", teamsIn: 4, lobbySize: 4, groupCount: 1, matchesPerGroup: 1, maps: ["ERANGEL"], advancePerGroup: 0, wildcardCount: 0, invitedSlots: 0,
      schedule: schedule(addDays(day1, 10), addDays(day1, 10), [{ start: "18:00", end: "20:00" }], 1),
    };
    const c = await manager2.post("/api/manager/tournaments", { title: `Sim Race ${sfx}`, maxTeams: 4, stages: [final1] });
    expectStatus(c, 201, 200);
    const rid = c.body.id;
    expectStatus(await manager2.post(`/api/manager/tournaments/${rid}/publish`), 200);
    const six = teams.slice(40, 46);
    for (const t of six) expectStatus(await t.client.post(`/api/team/tournaments/${rid}/entry`, { timePreferences: [] }), 201, 200);
    // double-click register from one team: one entry only
    const dbl = await Promise.all([0, 1].map(() => teams[50]!.client.post(`/api/team/tournaments/${rid}/entry`, { timePreferences: [] })));
    check(dbl.filter((x) => x.status === 201 || x.status === 200).length === 1, `double-click register: ${dbl.map((x) => x.status).join(",")}`);
    expectStatus(await teams[50]!.client.del(`/api/team/tournaments/${rid}/entry`), 204);
    expectError(await teams[51]!.client.post(`/api/team/tournaments/${rid}/entry`, { timePreferences: ["not-a-slot"] }), 400);
    const [w1, w2] = await Promise.all([six[0]!, six[1]!].map((t) => t.client.del(`/api/team/tournaments/${rid}/entry`)));
    expectStatus(w1!, 204);
    expectStatus(w2!, 204);
    const e = await manager2.get(`/api/manager/tournaments/${rid}/entries`);
    const conf = e.body.items.filter((x: any) => x.status === "CONFIRMED").map((x: any) => x.team.id);
    const wl = e.body.items.filter((x: any) => x.status === "WAITLISTED");
    check(conf.length === 4 && wl.length === 0, `after race: ${conf.length} confirmed, ${wl.length} waitlisted`, e);
    check(six.slice(2).every((t) => conf.includes(t.id)), "wrong teams confirmed");
    const t = await manager2.get(`/api/manager/tournaments/${rid}`);
    check(t.body.confirmedCount === 4 && t.body.waitlistCount === 0, `counts ${t.body.confirmedCount}/${t.body.waitlistCount}`);
  }, false);

  // ---------------------------------------------------------------- summary
  const total = Date.now() - t0;
  console.log(`\n${bold("Timings")}`);
  for (const [k, v] of Object.entries(timings)) console.log(`  ${k.padEnd(30)} ${(v / 1000).toFixed(2)}s`);
  console.log(`  ${"total".padEnd(30)} ${(total / 1000).toFixed(2)}s  (${requests} HTTP requests)`);
  console.log(`\n${failed ? red("FAILED") : green("PASSED")}  ${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ""}`);
  if (process.env.SIM_JSON) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(process.env.SIM_JSON, JSON.stringify({ baseUrl: BASE_URL, seed: SIM_SEED, totalMs: total, requests, timings, results }, null, 2));
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(red(`fatal: ${(e as Error).stack ?? e}`));
  process.exit(1);
});

void yellow;
