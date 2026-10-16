/**
 * 7xen phase-1 API smoke test.
 *
 * Runs the whole scrim flow against a running API:
 *   admin → managers/teams → manager scrim → team registrations → approvals/slots →
 *   rejection/cancellation → cross-manager isolation → logout.
 *
 * Usage:   pnpm smoke                       (BASE_URL defaults to http://localhost:4000)
 *          BASE_URL=http://localhost:8080 pnpm smoke
 *          ADMIN_USERNAME=admin ADMIN_PASSWORD=Admin@12345 pnpm smoke
 *
 * Self-contained (no workspace imports) so it runs with plain Node 24 type stripping.
 * Every run uses random suffixes, so it is safe to re-run against the same database.
 */

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:4000").replace(/\/$/, "");
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "Admin@12345";
const PASSWORD = "Smoke@12345";

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const green = (s: string) => (color ? `\x1b[32m${s}\x1b[0m` : s);
const red = (s: string) => (color ? `\x1b[31m${s}\x1b[0m` : s);
const dim = (s: string) => (color ? `\x1b[2m${s}\x1b[0m` : s);

// ---------------------------------------------------------------- http client
interface Res {
  status: number;
  body: any;
  method: string;
  path: string;
}

/** A logged-in "browser": keeps its own cookie jar. */
class Client {
  readonly name: string;
  private jar = new Map<string, string>();

  constructor(name: string) {
    this.name = name;
  }

  async req(method: string, path: string, body?: unknown, retried = false): Promise<Res> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.jar.size) headers.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    let r: Response;
    try {
      r = await fetch(BASE_URL + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
      });
    } catch (e) {
      throw new StepError(`${method} ${path}: network error (${(e as Error).message}) — is the API running at ${BASE_URL}?`);
    }
    for (const c of r.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const eq = pair!.indexOf("=");
      const k = pair!.slice(0, eq).trim();
      const v = pair!.slice(eq + 1).trim();
      const expired =
        v === "" ||
        attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) ||
        attrs.some((a) => {
          const m = /^\s*expires=(.*)$/i.exec(a);
          return m ? new Date(m[1]!).getTime() <= Date.now() : false;
        });
      if (expired) this.jar.delete(k);
      else this.jar.set(k, v);
    }
    if (r.status === 429 && path.endsWith("/login") && !retried) {
      // login is rate limited per IP (e.g. 10/min); wait for the window instead of failing
      const reset = Number(/reset=(\d+)/.exec(r.headers.get("ratelimit") ?? "")?.[1] ?? r.headers.get("retry-after") ?? 60);
      console.log(dim(`    (login rate limited — waiting ${reset + 1}s)`));
      await new Promise((ok) => setTimeout(ok, (reset + 1) * 1000));
      return this.req(method, path, body, true);
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
  patch = (p: string, b?: unknown) => this.req("PATCH", p, b ?? {});
  del = (p: string) => this.req("DELETE", p);
}

// ---------------------------------------------------------------- assertions
class StepError extends Error {}

function describe(r: Res): string {
  const b = typeof r.body === "string" ? r.body.slice(0, 300) : JSON.stringify(r.body)?.slice(0, 300);
  return `${r.method} ${r.path} → ${r.status} ${b ?? ""}`;
}

function expectStatus(r: Res, ...ok: number[]): void {
  if (!ok.includes(r.status)) throw new StepError(`expected HTTP ${ok.join("|")}, got ${describe(r)}`);
}

function expectError(r: Res, status: number, code: string): void {
  if (r.status !== status || r.body?.error?.code !== code) {
    throw new StepError(`expected ${status} ${code}, got ${describe(r)}`);
  }
}

function check(cond: unknown, msg: string, r?: Res): asserts cond {
  if (!cond) throw new StepError(r ? `${msg} — ${describe(r)}` : msg);
}

let passed = 0;
let failed = 0;
let skipped = 0;
let stepNo = 0;
let aborted = false;

/** Run one step. Critical steps abort the run on failure (later steps depend on them). */
async function step(title: string, fn: () => Promise<void | string>, critical = true): Promise<boolean> {
  stepNo++;
  const label = `${String(stepNo).padStart(2, " ")}. ${title}`;
  if (aborted) {
    skipped++;
    console.log(dim(`  - ${label} (skipped)`));
    return false;
  }
  const t0 = Date.now();
  try {
    const note = await fn();
    passed++;
    console.log(`${green("✓")} ${label}${note ? dim(` — ${note}`) : ""} ${dim(`${Date.now() - t0}ms`)}`);
    return true;
  } catch (e) {
    failed++;
    console.log(`${red("✗")} ${label}\n    ${red((e as Error).message)}`);
    if (!(e instanceof StepError)) console.log(dim(String((e as Error).stack)));
    if (critical) aborted = true;
    return false;
  }
}

// ---------------------------------------------------------------- helpers
/** Today's date in IST as YYYY-MM-DD. */
function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const sfx = Math.random().toString(36).slice(2, 7);
const tomorrow = addDays(todayIST(), 1);

interface TeamCtx {
  key: "A" | "B" | "C";
  name: string;
  tag: string;
  username: string;
  id?: string;
  client: Client;
  registrationId?: string;
}

// ---------------------------------------------------------------- flow
async function main(): Promise<void> {
  console.log(`7xen smoke test → ${BASE_URL}  (suffix ${sfx}, session date ${tomorrow} IST)\n`);

  const admin = new Client("admin");
  const manager = new Client("manager");
  const manager2 = new Client("manager2");
  const m1 = { username: `smoke_mgr_${sfx}`, displayName: `Smoke Manager ${sfx}` };
  const m2 = { username: `smoke_mgr2_${sfx}`, displayName: `Smoke Manager Two ${sfx}` };
  const teams: TeamCtx[] = (["A", "B", "C"] as const).map((k) => ({
    key: k,
    name: `Smoke ${k} ${sfx}`,
    tag: `S${k}${sfx.slice(0, 2).toUpperCase()}`.replace(/[^A-Z0-9]/g, "X").slice(0, 5),
    username: `smoke_${k.toLowerCase()}_${sfx}`,
    client: new Client(`team ${k}`),
  }));
  const [A, B, C] = teams as [TeamCtx, TeamCtx, TeamCtx];
  let scrimId = "";
  let otherScrimId = "";
  let raceScrimId = "";
  const managerIds: string[] = [];

  await step("GET /api/health is ok", async () => {
    const r = await admin.get("/api/health");
    expectStatus(r, 200);
    check(r.body?.ok === true, "body.ok should be true", r);
  });

  await step("protected endpoints reject anonymous requests (401)", async () => {
    expectError(await admin.get("/api/admin/auth/me"), 401, "UNAUTHENTICATED");
    expectError(await admin.get("/api/auth/me"), 401, "UNAUTHENTICATED");
  }, false);

  await step("admin login with wrong password → 401", async () => {
    const r = await new Client("x").post("/api/admin/auth/login", { username: ADMIN_USERNAME, password: "wrong-password" });
    expectStatus(r, 401);
  }, false);

  await step(`admin logs in (${ADMIN_USERNAME})`, async () => {
    const r = await admin.post("/api/admin/auth/login", { username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    expectStatus(r, 200);
    check(r.body?.user?.role === "ADMIN", "user.role should be ADMIN", r);
    const me = await admin.get("/api/admin/auth/me");
    expectStatus(me, 200);
    check(me.body?.user?.username === ADMIN_USERNAME, "me.user.username mismatch", me);
  });

  await step("admin session cannot use the app API (separate cookies)", async () => {
    expectStatus(await admin.get("/api/manager/scrims"), 401, 403);
  }, false);

  await step("admin creates manager + second manager", async () => {
    for (const m of [m1, m2]) {
      const r = await admin.post("/api/admin/managers", { ...m, password: PASSWORD });
      expectStatus(r, 200, 201);
      check(r.body?.username === m.username && r.body?.isActive === true, "ManagerRow mismatch", r);
      managerIds.push(r.body.id);
    }
    return `${m1.username}, ${m2.username}`;
  });

  await step("duplicate manager username → 409 CONFLICT", async () => {
    expectError(await admin.post("/api/admin/managers", { ...m1, password: PASSWORD }), 409, "CONFLICT");
  }, false);

  await step("admin creates 3 teams (A, B, C)", async () => {
    for (const t of teams) {
      const r = await admin.post("/api/admin/teams", {
        teamName: t.name,
        tag: t.tag,
        captainName: `Captain ${t.key}`,
        username: t.username,
        password: PASSWORD,
      });
      expectStatus(r, 200, 201);
      check(r.body?.name === t.name && r.body?.username === t.username, "TeamRow mismatch", r);
      t.id = r.body.id;
    }
    return teams.map((t) => t.name).join(", ");
  });

  await step("duplicate team name with different case/spacing → 409 CONFLICT", async () => {
    const r = await admin.post("/api/admin/teams", {
      teamName: `  ${A.name.toUpperCase().replace(/ /g, "   ")} `,
      tag: "DUP",
      username: `smoke_dup_${sfx}`,
      password: PASSWORD,
    });
    expectError(r, 409, "CONFLICT");
  }, false);

  await step("invalid team payload → 400 VALIDATION_ERROR with fields", async () => {
    const r = await admin.post("/api/admin/teams", { teamName: "x", tag: "!", username: "A B", password: "short" });
    expectError(r, 400, "VALIDATION_ERROR");
    check(r.body.error.fields && typeof r.body.error.fields === "object", "error.fields missing", r);
  }, false);

  await step("admin lists teams with ?q= search", async () => {
    const r = await admin.get(`/api/admin/teams?q=${encodeURIComponent(sfx)}`);
    expectStatus(r, 200);
    check(Array.isArray(r.body?.items) && r.body.items.length === 3, "expected exactly 3 teams for suffix", r);
  }, false);

  await step("team login is rejected on the admin login endpoint", async () => {
    const r = await new Client("x").post("/api/admin/auth/login", { username: A.username, password: PASSWORD });
    expectStatus(r, 401, 403);
  }, false);

  await step("manager logs in", async () => {
    const r = await manager.post("/api/auth/login", { username: m1.username, password: PASSWORD });
    expectStatus(r, 200);
    check(r.body?.user?.role === "MANAGER", "user.role should be MANAGER", r);
  });

  await step("manager session has no access to the admin API", async () => {
    expectStatus(await manager.get("/api/admin/stats"), 401, 403);
  }, false);

  await step(`manager creates a ONCE scrim for ${tomorrow} (slotCount 2, firstSlot 3)`, async () => {
    const r = await manager.post("/api/manager/scrims", {
      title: `Smoke Scrim ${sfx}`,
      maps: ["ERANGEL", "MIRAMAR"],
      startTime: "21:00",
      recurrence: "ONCE",
      startDate: tomorrow,
      slotCount: 2,
      firstSlot: 3,
    });
    expectStatus(r, 200, 201);
    check(r.body?.id && r.body.recurrence === "ONCE" && r.body.slotCount === 2 && r.body.firstSlot === 3, "Scrim mismatch", r);
    check(r.body.status === "ACTIVE", "new scrim should be ACTIVE", r);
    scrimId = r.body.id;
  });

  await step("scrim validation: slots past #25 → 400 VALIDATION_ERROR", async () => {
    const r = await manager.post("/api/manager/scrims", {
      title: "Bad scrim",
      maps: ["ERANGEL"],
      startTime: "21:00",
      recurrence: "ONCE",
      startDate: tomorrow,
      slotCount: 10,
      firstSlot: 20,
    });
    expectError(r, 400, "VALIDATION_ERROR");
  }, false);

  await step("manager schedule for tomorrow includes the scrim", async () => {
    const r = await manager.get(`/api/manager/schedule?date=${tomorrow}`);
    expectStatus(r, 200);
    check(r.body?.items?.some((s: any) => s.scrim?.id === scrimId), "scrim missing from schedule", r);
  }, false);

  for (const t of teams) {
    await step(`team ${t.key} logs in, sees the scrim on ${tomorrow}, registers`, async () => {
      const login = await t.client.post("/api/auth/login", { username: t.username, password: PASSWORD });
      expectStatus(login, 200);
      check(login.body?.user?.role === "TEAM" && login.body.user.team?.name === t.name, "login user/team mismatch", login);

      const list = await t.client.get(`/api/team/scrims?date=${tomorrow}`);
      expectStatus(list, 200);
      const row = list.body?.items?.find((s: any) => s.scrim?.id === scrimId);
      check(row, "scrim not listed for tomorrow", list);
      check(row.registrationOpen === true, "registrationOpen should be true", list);
      check(row.myRegistration === null, "myRegistration should be null before registering", list);

      const reg = await t.client.post("/api/team/registrations", { scrimId, date: tomorrow });
      expectStatus(reg, 200, 201);
      check(reg.body?.status === "PENDING" && reg.body.slotNumber === null, "new registration should be PENDING, no slot", reg);
      t.registrationId = reg.body.id;
    });
  }

  await step("double registration → 409 CONFLICT", async () => {
    expectError(await A.client.post("/api/team/registrations", { scrimId, date: tomorrow }), 409, "CONFLICT");
  }, false);

  await step("registering for a date the scrim doesn't run → 4xx", async () => {
    const r = await A.client.post("/api/team/registrations", { scrimId, date: addDays(tomorrow, 1) });
    check(r.status >= 400 && r.status < 500, "expected a 4xx", r);
  }, false);

  await step("manager sees 3 pending requests", async () => {
    const r = await manager.get("/api/manager/requests");
    expectStatus(r, 200);
    const mine = (r.body?.items ?? []).filter((p: any) => p.scrim?.id === scrimId);
    check(mine.length === 3, `expected 3 requests for the scrim, got ${mine.length}`, r);
    const ids = new Set(mine.map((p: any) => p.registration?.id));
    check(teams.every((t) => ids.has(t.registrationId)), "request ids don't match registrations", r);
  });

  const approve = async (t: TeamCtx, slot: number) => {
    const r = await manager.post(`/api/manager/registrations/${t.registrationId}/approve`);
    expectStatus(r, 200);
    check(r.body?.status === "APPROVED", "status should be APPROVED", r);
    check(r.body.slotNumber === slot, `expected slot ${slot}, got ${r.body.slotNumber}`, r);
    return `slot #${slot}`;
  };

  await step("approve team A → slot 3", () => approve(A, 3));
  await step("approve team B → slot 4", () => approve(B, 4));
  await step("approve team C → 409 SLOTS_FULL", async () => {
    expectError(await manager.post(`/api/manager/registrations/${C.registrationId}/approve`), 409, "SLOTS_FULL");
  });

  await step("reject team A (frees slot 3)", async () => {
    const r = await manager.post(`/api/manager/registrations/${A.registrationId}/reject`, { reason: "Smoke test" });
    expectStatus(r, 200);
    check(r.body?.status === "REJECTED" && r.body.slotNumber === null, "should be REJECTED with no slot", r);
    check(r.body.rejectionReason === "Smoke test", "rejectionReason not stored", r);
  });

  await step("approve team C → slot 3 (lowest free)", () => approve(C, 3));

  await step("team C sees APPROVED slot 3; team A sees REJECTED", async () => {
    const rc = await C.client.get("/api/team/registrations?scope=upcoming");
    expectStatus(rc, 200);
    const c = rc.body?.items?.find((x: any) => x.id === C.registrationId);
    check(c?.status === "APPROVED" && c.slotNumber === 3, "team C registration should be APPROVED #3", rc);
    check(c.date === tomorrow && c.scrim?.id === scrimId, "team C registration date/scrim mismatch", rc);

    const ra = await A.client.get("/api/team/registrations?scope=upcoming");
    expectStatus(ra, 200);
    const a = ra.body?.items?.find((x: any) => x.id === A.registrationId);
    check(a?.status === "REJECTED" && a.slotNumber === null, "team A registration should be REJECTED", ra);
    check(a.rejectionReason === "Smoke test", "team A should see the rejection reason", ra);

    const list = await C.client.get(`/api/team/scrims?date=${tomorrow}`);
    const row = list.body?.items?.find((s: any) => s.scrim?.id === scrimId);
    check(row?.myRegistration?.status === "APPROVED" && row.myRegistration.slotNumber === 3, "team scrims myRegistration mismatch", list);
  });

  await step("team cannot cancel another team's registration", async () => {
    const r = await A.client.del(`/api/team/registrations/${B.registrationId}`);
    expectStatus(r, 403, 404);
  }, false);

  await step("team B cancels its registration (204)", async () => {
    expectStatus(await B.client.del(`/api/team/registrations/${B.registrationId}`), 204);
  });

  await step("session detail: slot 3 = team C, slot 4 free", async () => {
    const r = await manager.get(`/api/manager/scrims/${scrimId}/sessions/${tomorrow}`);
    expectStatus(r, 200);
    const slots = r.body?.slots as any[];
    check(Array.isArray(slots) && slots.length === 2, "expected 2 slots", r);
    const s3 = slots.find((s) => s.slotNumber === 3);
    const s4 = slots.find((s) => s.slotNumber === 4);
    check(s3?.team?.id === C.id && s3.registrationId === C.registrationId, "slot 3 should hold team C", r);
    check(s4 && s4.team === null && s4.registrationId === null, "slot 4 should be free", r);
    check(r.body.counts?.approved === 1 && r.body.counts?.slotsLeft === 1, "counts should be approved 1 / slotsLeft 1", r);
    const b = r.body.registrations?.find((x: any) => x.id === B.registrationId);
    check(b?.status === "CANCELLED", "team B registration should be CANCELLED", r);
  });

  await step("session detail for a date the scrim doesn't run → 404", async () => {
    expectError(await manager.get(`/api/manager/scrims/${scrimId}/sessions/${addDays(tomorrow, 3)}`), 404, "NOT_FOUND");
  }, false);

  await step("concurrency: 3 simultaneous approvals on a 2-slot session → slots 1 & 2 + one SLOTS_FULL", async () => {
    const r = await manager.post("/api/manager/scrims", {
      title: `Smoke Race ${sfx}`,
      maps: ["LIVIK"],
      startTime: "22:00",
      recurrence: "ONCE",
      startDate: tomorrow,
      slotCount: 2,
    });
    expectStatus(r, 200, 201);
    raceScrimId = r.body.id;
    const ids: string[] = [];
    for (const t of teams) {
      const reg = await t.client.post("/api/team/registrations", { scrimId: r.body.id, date: tomorrow });
      expectStatus(reg, 200, 201);
      ids.push(reg.body.id);
    }
    const results = await Promise.all(ids.map((id) => manager.post(`/api/manager/registrations/${id}/approve`)));
    const ok = results.filter((x) => x.status === 200);
    const full = results.filter((x) => x.status === 409 && x.body?.error?.code === "SLOTS_FULL");
    const slots = ok.map((x) => x.body.slotNumber).sort();
    check(ok.length === 2 && full.length === 1, `expected 2 approved + 1 SLOTS_FULL, got ${results.map((x) => x.status).join(",")}`);
    check(slots[0] === 1 && slots[1] === 2, `expected slots [1,2], got [${slots}]`);
    return "slots 1, 2 + SLOTS_FULL";
  }, false);

  await step("second manager creates a scrim; manager 1 cannot access it", async () => {
    const login = await manager2.post("/api/auth/login", { username: m2.username, password: PASSWORD });
    expectStatus(login, 200);
    const r = await manager2.post("/api/manager/scrims", {
      title: `Smoke Other ${sfx}`,
      maps: ["SANHOK"],
      startTime: "18:30",
      recurrence: "DAILY",
      startDate: tomorrow,
      slotCount: 4,
    });
    expectStatus(r, 200, 201);
    otherScrimId = r.body.id;

    expectStatus(await manager.get(`/api/manager/scrims/${otherScrimId}`), 403, 404);
    expectStatus(await manager.patch(`/api/manager/scrims/${otherScrimId}`, { title: "Hijacked" }), 403, 404);
    expectStatus(await manager.get(`/api/manager/scrims/${otherScrimId}/sessions/${tomorrow}`), 403, 404);
    const list = await manager.get("/api/manager/scrims");
    expectStatus(list, 200);
    check(!list.body?.items?.some((s: any) => s.id === otherScrimId), "other manager's scrim leaked into list", list);
  });

  await step("second manager cannot approve/reject manager 1's registrations", async () => {
    expectStatus(await manager2.post(`/api/manager/registrations/${A.registrationId}/approve`), 403, 404);
    expectStatus(await manager2.post(`/api/manager/registrations/${C.registrationId}/reject`, {}), 403, 404);
  }, false);

  await step("wrong role → 403 FORBIDDEN and the session survives (manager → team API, team → manager API)", async () => {
    expectError(await manager2.get("/api/team/dashboard"), 403, "FORBIDDEN");
    expectStatus(await manager2.get("/api/auth/me"), 200);
    expectError(await C.client.get("/api/manager/requests"), 403, "FORBIDDEN");
    expectStatus(await C.client.get("/api/auth/me"), 200);
  }, false);

  await step("dashboards respond (manager, team, admin stats)", async () => {
    expectStatus(await manager.get("/api/manager/dashboard"), 200);
    const td = await C.client.get("/api/team/dashboard");
    expectStatus(td, 200);
    check(td.body?.team?.id === C.id, "team dashboard team mismatch", td);
    const st = await admin.get("/api/admin/stats");
    expectStatus(st, 200);
    check(typeof st.body?.teams?.total === "number", "stats.teams.total missing", st);
  }, false);

  await step("deactivated team cannot log in", async () => {
    const r = await admin.patch(`/api/admin/teams/${B.id}`, { isActive: false });
    expectStatus(r, 200);
    check(r.body?.isActive === false, "isActive should be false", r);
    const login = await new Client("x").post("/api/auth/login", { username: B.username, password: PASSWORD });
    expectStatus(login, 401, 403);
  }, false);

  await step("cleanup: archive the smoke scrims", async () => {
    // re-login if an earlier failing step lost a session, so cleanup still happens
    for (const [c, m] of [[manager, m1], [manager2, m2]] as const) {
      if ((await c.get("/api/auth/me")).status !== 200) await c.post("/api/auth/login", { username: m.username, password: PASSWORD });
    }
    for (const [c, id] of [[manager, scrimId], [manager, raceScrimId], [manager2, otherScrimId]] as const) {
      if (id) expectStatus(await c.patch(`/api/manager/scrims/${id}`, { status: "ARCHIVED" }), 200);
    }
  }, false);

  await step("logout clears the app session (me → 401)", async () => {
    expectStatus(await manager.get("/api/auth/me"), 200);
    expectStatus(await manager.post("/api/auth/logout"), 204);
    expectError(await manager.get("/api/auth/me"), 401, "UNAUTHENTICATED");
    expectStatus(await A.client.post("/api/auth/logout"), 204);
    expectError(await A.client.get("/api/auth/me"), 401, "UNAUTHENTICATED");
  });

  await step("cleanup: deactivate the smoke accounts", async () => {
    for (const id of managerIds) expectStatus(await admin.patch(`/api/admin/managers/${id}`, { isActive: false }), 200);
    for (const t of [A, C]) if (t.id) expectStatus(await admin.patch(`/api/admin/teams/${t.id}`, { isActive: false }), 200);
  }, false);

  await step("deactivated user's existing session is revoked immediately", async () => {
    expectError(await C.client.get("/api/team/dashboard"), 401, "UNAUTHENTICATED");
  }, false);

  await step("admin logout clears the admin session (me → 401)", async () => {
    expectStatus(await admin.post("/api/admin/auth/logout"), 204);
    expectError(await admin.get("/api/admin/auth/me"), 401, "UNAUTHENTICATED");
  });

  console.log(
    `\n${failed ? red("FAILED") : green("PASSED")}  ${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ""}`,
  );
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(red(`fatal: ${(e as Error).stack ?? e}`));
  process.exit(1);
});
