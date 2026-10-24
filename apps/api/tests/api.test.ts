import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addMinutesToTime } from "@7xen/shared";
import {
  adminAgent,
  http,
  newAgent,
  server,
  createAdminUser,
  createManager,
  createScrim,
  createTeam,
  prisma,
  resetDb,
  today,
  tomorrow,
  yesterday,
  type TestAgent,
} from "./helpers.js";

beforeEach(async () => {
  await resetDb();
  await createAdminUser();
});
afterAll(async () => {
  await prisma.$disconnect();
  server.close();
});

async function register(team: TestAgent, scrimId: string, date = tomorrow()) {
  return team.post("/api/team/registrations").send({ scrimId, date });
}

describe("health & errors", () => {
  it("health check and 404 shape", async () => {
    expect((await http().get("/api/health")).body).toEqual({ ok: true });
    const res = await http().get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("validation errors carry a fields map", async () => {
    const admin = await adminAgent();
    const res = await admin.post("/api/admin/managers").send({ displayName: "x", username: "A B", password: "1" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(Object.keys(res.body.error.fields)).toEqual(expect.arrayContaining(["username", "password"]));
  });
});

describe("auth", () => {
  it("logs in, returns session user, and logs out", async () => {
    const admin = await adminAgent();
    await createManager(admin, "boss");
    const agent = newAgent();
    const res = await agent.post("/api/auth/login").send({ username: "  BOSS ", password: "Manager@123" });
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]?.[0]).toMatch(/^sx_app=.*HttpOnly/i);
    expect(res.body.user).toMatchObject({ username: "boss", role: "MANAGER", team: null, player: null });

    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe("boss");

    expect((await agent.post("/api/auth/logout")).status).toBe(204);
    expect((await agent.get("/api/auth/me")).status).toBe(401);
  });

  it("rejects wrong password, admin on app login, and non-admin on admin login", async () => {
    const admin = await adminAgent();
    await createManager(admin, "boss");
    const wrong = await http().post("/api/auth/login").send({ username: "boss", password: "nope-nope" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toEqual({ code: "UNAUTHENTICATED", message: "Wrong username or password" });

    const adminOnApp = await http().post("/api/auth/login").send({ username: "admin", password: "Admin@12345" });
    expect(adminOnApp.status).toBe(401);
    expect(adminOnApp.body.error.message).toBe("Wrong username or password");

    const mgrOnAdmin = await http().post("/api/admin/auth/login").send({ username: "boss", password: "Manager@123" });
    expect(mgrOnAdmin.status).toBe(401);
  });

  it("disabled accounts can't log in and existing sessions stop working", async () => {
    const admin = await adminAgent();
    const { row, agent } = await createManager(admin, "boss");
    expect((await agent.get("/api/manager/dashboard")).status).toBe(200);
    await admin.patch(`/api/admin/managers/${row.id}`).send({ isActive: false }).expect(200);
    expect((await agent.get("/api/manager/dashboard")).status).toBe(401);
    const res = await http().post("/api/auth/login").send({ username: "boss", password: "Manager@123" });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe("This account is disabled. Contact the admin.");
  });

  it("role guards: team can't use manager routes, app cookie can't use admin routes", async () => {
    const admin = await adminAgent();
    const { agent: team } = await createTeam(admin);
    // signed in but wrong area → 403, and the session stays valid
    expect((await team.get("/api/manager/dashboard")).status).toBe(403);
    expect((await team.get("/api/auth/me")).status).toBe(200);
    // the app cookie is not an admin session at all → 401
    expect((await team.get("/api/admin/stats")).status).toBe(401);
  });
});

describe("admin", () => {
  it("lists teams with leader + member count, shows detail, disbands; team-login endpoints are gone", async () => {
    const admin = await adminAgent();
    const { row, leaderId } = await createTeam(admin, "Team  Soul", "mortal");
    const list = await admin.get("/api/admin/teams").query({ q: "SOU" });
    expect(list.body.items).toEqual([
      { id: row.id, name: "Team  Soul", tag: expect.any(String), leader: { id: leaderId, ign: "mortal", displayName: "mortal", avatarUrl: null }, memberCount: 1, registrationCount: 0, createdAt: expect.any(String) },
    ]);
    // search by a member's IGN
    expect((await admin.get("/api/admin/teams").query({ q: "morT" })).body.items).toHaveLength(1);
    const detail = await admin.get(`/api/admin/teams/${row.id}`);
    expect(detail.body).toMatchObject({ id: row.id, leader: { id: leaderId }, members: [{ id: leaderId, role: "LEADER" }], upcomingRegistrations: 0 });

    expect((await admin.post("/api/admin/teams").send({ teamName: "X", tag: "XX", username: "xx", password: "Team@1234" })).status).toBe(404);
    expect((await admin.patch(`/api/admin/teams/${row.id}`).send({ teamName: "Y" })).status).toBe(404);
    expect((await admin.get("/api/admin/team-requests")).status).toBe(404);

    const stats = await admin.get("/api/admin/stats");
    expect(stats.body).toMatchObject({ teams: { total: 1, active: 1 }, players: { total: 1, active: 1 }, teamRequests: { pending: 0 } });

    expect((await admin.delete(`/api/admin/teams/${row.id}`)).status).toBe(204);
    expect((await admin.get(`/api/admin/teams/${row.id}`)).status).toBe(404);
    expect(await prisma.teamMember.count()).toBe(0);
  });

  it("lists players and can disable one (their session ends)", async () => {
    const admin = await adminAgent();
    const { agent, leaderId } = await createTeam(admin, "Team Soul", "mortal");
    const list = await admin.get("/api/admin/players").query({ q: "soul" });
    expect(list.body.items).toEqual([
      expect.objectContaining({ id: leaderId, ign: "mortal", email: "mortal@test.dev", isActive: true, team: expect.objectContaining({ name: "Team Soul", role: "LEADER" }) }),
    ]);
    const off = await admin.patch(`/api/admin/players/${leaderId}`).send({ isActive: false });
    expect(off.body.isActive).toBe(false);
    expect((await agent.get("/api/player/me")).status).toBe(401);
    const again = await newAgent().post("/api/auth/dev-login").send({ email: "mortal@test.dev" });
    expect(again.status).toBe(403);
    expect(again.body.error.message).toBe("This account is disabled. Contact the admin.");
  });

  it("creates managers (409 on taken username) and resets passwords", async () => {
    const admin = await adminAgent();
    const { row } = await createManager(admin, "boss");
    const dup = await admin.post("/api/admin/managers").send({ displayName: "X Y", username: "BOSS", password: "Manager@123" });
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toBe("That username is already taken");
    await admin.post(`/api/admin/managers/${row.id}/reset-password`).send({ password: "NewPass@1" }).expect(204);
    expect((await http().post("/api/auth/login").send({ username: "boss", password: "NewPass@1" })).status).toBe(200);
    const list = await admin.get("/api/admin/managers");
    expect(list.body.items[0]).toMatchObject({ username: "boss", scrimCount: 0 });
    expect(list.body.items[0].lastLoginAt).not.toBeNull();
  });
});

describe("manager scrims", () => {
  it("creates a scrim and lists it on the schedule", async () => {
    const admin = await adminAgent();
    const { agent: mgr } = await createManager(admin);
    const res = await mgr.post("/api/manager/scrims").send({
      title: "Evening Scrim",
      maps: ["ERANGEL", "MIRAMAR", "SANHOK"],
      startTime: "18:00",
      recurrence: "WEEKENDS",
      startDate: "2030-01-01",
      endDate: "2030-12-31",
      slotCount: 16,
      firstSlot: 3,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: "Evening Scrim", startDate: "2030-01-01", endDate: "2030-12-31", status: "ACTIVE", firstSlot: 3 });

    // 2030-01-05 is a Saturday, 2030-01-07 a Monday
    const sat = await mgr.get("/api/manager/schedule").query({ date: "2030-01-05" });
    expect(sat.body.items).toHaveLength(1);
    expect(sat.body.items[0]).toMatchObject({
      date: "2030-01-05",
      startsAt: "2030-01-05T12:30:00.000Z",
      registrationOpen: true,
      counts: { pending: 0, approved: 0, slotsLeft: 16 },
    });
    expect((await mgr.get("/api/manager/schedule").query({ date: "2030-01-07" })).body.items).toHaveLength(0);

    const bad = await mgr.post("/api/manager/scrims").send({ title: "Bad", maps: [], startTime: "25:00", recurrence: "DAILY", startDate: "2030-01-01", slotCount: 30 });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields).toHaveProperty("maps");
    expect(bad.body.error.fields).toHaveProperty("startTime");
  });

  it("a manager can't see or modify another manager's scrim", async () => {
    const admin = await adminAgent();
    const { agent: m1 } = await createManager(admin);
    const { agent: m2 } = await createManager(admin);
    const { agent: team } = await createTeam(admin);
    const scrim = await createScrim(m1);
    expect((await m2.get(`/api/manager/scrims/${scrim.id}`)).status).toBe(404);
    expect((await m2.patch(`/api/manager/scrims/${scrim.id}`).send({ title: "Hijacked" })).status).toBe(404);
    expect((await m2.get(`/api/manager/scrims/${scrim.id}/sessions/${tomorrow()}`)).status).toBe(404);
    expect((await m2.get("/api/manager/scrims")).body.items).toHaveLength(0);
    const reg = await register(team, scrim.id);
    expect((await m2.post(`/api/manager/registrations/${reg.body.id}/approve`)).status).toBe(404);
    expect((await m2.get("/api/manager/requests")).body.items).toHaveLength(0);
  });
});

/** "HH:mm" in IST and the IST date of an instant */
function istClock(at: Date) {
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(at);
  return { time, date };
}

describe("scrim match plan, close time, drafts", () => {
  const plan = { maps: ["ERANGEL", "MIRAMAR", "RONDO"], startTime: "20:00", matchTimes: ["20:00", "20:40", "21:20"], idpMinutes: [15, 10, 15] };

  it("stores each match's time + IDP, keeps startTime = match 1, and validates the times", async () => {
    const admin = await adminAgent();
    const { agent: mgr } = await createManager(admin);
    const scrim = await createScrim(mgr, { ...plan, startTime: "19:00", registrationCloseMinutes: 30 });
    const got = (await mgr.get(`/api/manager/scrims/${scrim.id}`)).body;
    expect(got).toMatchObject({
      startTime: "20:00",
      registrationCloseMinutes: 30,
      published: true,
      matches: [
        { number: 1, map: "ERANGEL", startTime: "20:00", idpMinutes: 15 },
        { number: 2, map: "MIRAMAR", startTime: "20:40", idpMinutes: 10 },
        { number: 3, map: "RONDO", startTime: "21:20", idpMinutes: 15 },
      ],
    });
    const day = (await mgr.get("/api/manager/schedule").query({ date: tomorrow() })).body.items[0];
    expect(new Date(day.startsAt).getTime() - new Date(day.registrationClosesAt).getTime()).toBe(30 * 60_000);

    const same = await mgr.post("/api/manager/scrims").send({ ...plan, title: "Bad", matchTimes: ["20:00", "20:00", "21:00"], recurrence: "DAILY", startDate: tomorrow(), slotCount: 4 });
    expect(same.status).toBe(400);
    expect(same.body.error.fields["matchTimes.1"]).toMatch(/same time/);
    const short = await mgr.post("/api/manager/scrims").send({ ...plan, title: "Bad", matchTimes: ["20:00"], recurrence: "DAILY", startDate: tomorrow(), slotCount: 4 });
    expect(short.body.error.fields.matchTimes).toBe("Give every match a start time");

    // older clients that only move startTime shift every match
    const moved = await mgr.patch(`/api/manager/scrims/${scrim.id}`).send({ startTime: "21:00" });
    expect(moved.body.matches.map((m: { startTime: string }) => m.startTime)).toEqual(["21:00", "21:40", "22:20"]);
  });

  it("a match after midnight runs the next day; team detail shows each match's start and IDP", async () => {
    const admin = await adminAgent();
    const { agent: mgr } = await createManager(admin);
    const { agent: team } = await createTeam(admin);
    const scrim = await createScrim(mgr, { maps: ["ERANGEL", "MIRAMAR"], startTime: "23:30", matchTimes: ["23:30", "00:10"], idpMinutes: [15, 10] });
    const d = (await team.get(`/api/team/scrims/${scrim.id}`).query({ date: tomorrow() })).body;
    const [m1, m2] = d.matches;
    expect(new Date(m2.startsAt).getTime() - new Date(m1.startsAt).getTime()).toBe(40 * 60_000);
    expect(new Date(m2.startsAt).getTime() - new Date(m2.idpAt).getTime()).toBe(10 * 60_000);
  });

  it("drafts are hidden from teams until published", async () => {
    const admin = await adminAgent();
    const { agent: mgr } = await createManager(admin);
    const { agent: team } = await createTeam(admin);
    const scrim = await createScrim(mgr, { published: false });
    expect((await mgr.get("/api/manager/scrims")).body.items[0]).toMatchObject({ id: scrim.id, published: false });
    expect((await team.get("/api/team/scrims").query({ date: tomorrow() })).body.items).toEqual([]);
    expect((await team.get(`/api/team/scrims/${scrim.id}`)).status).toBe(404);
    expect((await register(team, scrim.id)).status).toBe(404);

    await mgr.patch(`/api/manager/scrims/${scrim.id}`).send({ published: true }).expect(200);
    expect((await team.get("/api/team/scrims").query({ date: tomorrow() })).body.items).toHaveLength(1);
    expect((await register(team, scrim.id)).status).toBe(201);
  });

  it("registration closes early: only registered teams keep seeing it, and nobody once every match is published", async () => {
    const admin = await adminAgent();
    const { agent: mgr } = await createManager(admin);
    const { agent: inTeam } = await createTeam(admin);
    const { agent: outTeam } = await createTeam(admin);
    // match 1 starts in 20 minutes
    const start = istClock(new Date(Date.now() + 20 * 60_000));
    const scrim = await createScrim(mgr, { recurrence: "ONCE", startDate: start.date, startTime: start.time, maps: ["ERANGEL", "MIRAMAR"], matchTimes: [start.time, addMinutesToTime(start.time, 40)] });
    const list = (agent: TestAgent) => agent.get("/api/team/scrims").query({ date: start.date });
    expect((await register(inTeam, scrim.id, start.date)).status).toBe(201);

    // close 30 min before match 1 → already closed
    await mgr.patch(`/api/manager/scrims/${scrim.id}`).send({ registrationCloseMinutes: 30 }).expect(200);
    const late = await register(outTeam, scrim.id, start.date);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe("REGISTRATION_CLOSED");
    expect((await list(outTeam)).body.items).toEqual([]);
    const mine = (await list(inTeam)).body.items;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ registrationOpen: false, myRegistration: { status: "APPROVED" } });
    // a registered team can't cancel after registration closes
    const cancel = await inTeam.delete(`/api/team/registrations/${mine[0].myRegistration.id}`);
    expect(cancel.status).toBe(409);

    // all matches published → finished
    await mgr.get(`/api/manager/scrims/${scrim.id}/sessions/${start.date}/matches`).expect(200);
    await prisma.match.updateMany({ where: { session: { scrimId: scrim.id } }, data: { status: "PUBLISHED" } });
    expect((await list(inTeam)).body.items).toEqual([]);
  });

  it("removing a match drops unplayed match rows, but not one that already started", async () => {
    const admin = await adminAgent();
    const { agent: mgr } = await createManager(admin);
    const scrim = await createScrim(mgr, plan);
    const url = `/api/manager/scrims/${scrim.id}/sessions/${tomorrow()}/matches`;
    expect((await mgr.get(url)).body.items).toHaveLength(3);

    await prisma.match.updateMany({ where: { number: 3, session: { scrimId: scrim.id } }, data: { status: "LIVE" } });
    const refused = await mgr.patch(`/api/manager/scrims/${scrim.id}`).send({ maps: ["ERANGEL", "MIRAMAR"], matchTimes: ["20:00", "20:40"], idpMinutes: [15, 15] });
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toMatch(/Match 3 on .* has already started/);

    await prisma.match.updateMany({ where: { number: 3, session: { scrimId: scrim.id } }, data: { status: "SCHEDULED" } });
    await mgr.patch(`/api/manager/scrims/${scrim.id}`).send({ maps: ["ERANGEL", "MIRAMAR"], matchTimes: ["20:00", "20:40"], idpMinutes: [15, 15] }).expect(200);
    expect((await mgr.get(url)).body.items.map((m: { number: number }) => m.number)).toEqual([1, 2]);
  });
});

describe("registrations & slots", () => {
  async function setup(teamCount: number, scrimOverrides: Record<string, unknown> = {}) {
    const admin = await adminAgent();
    const { agent: mgr } = await createManager(admin);
    const teams: { row: { id: string; name: string }; agent: TestAgent }[] = [];
    for (let i = 0; i < teamCount; i++) teams.push(await createTeam(admin));
    const scrim = await createScrim(mgr, scrimOverrides);
    return { admin, mgr, teams, scrim };
  }

  it("team joins confirmed on the lowest free slot (no approval), sees it, and can't double-register", async () => {
    const { mgr, teams, scrim } = await setup(1);
    const [t] = teams;
    const res = await register(t!.agent, scrim.id);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "APPROVED", slotNumber: 3, date: tomorrow(), scrim: { id: scrim.id, firstSlot: 3 } });

    const again = await register(t!.agent, scrim.id);
    expect(again.status).toBe(409);
    expect(again.body.error).toEqual({ code: "CONFLICT", message: "You're already registered for this scrim" });

    const list = await t!.agent.get("/api/team/scrims").query({ date: tomorrow() });
    expect(list.body.items[0]).toMatchObject({ myRegistration: { id: res.body.id, status: "APPROVED", slotNumber: 3 }, counts: { pending: 0, approved: 1 } });

    const upcoming = await t!.agent.get("/api/team/registrations").query({ scope: "upcoming" });
    expect(upcoming.body.items.map((r: { id: string }) => r.id)).toEqual([res.body.id]);

    // nothing waits for the manager any more
    expect((await mgr.get("/api/manager/requests")).body.items).toEqual([]);
  });

  it("the manager removes a team: its slot is freed for the next team, and it can't rejoin by itself", async () => {
    const { mgr, teams, scrim } = await setup(3);
    const r0 = (await register(teams[0]!.agent, scrim.id)).body;
    const r1 = (await register(teams[1]!.agent, scrim.id)).body;
    expect([r0.slotNumber, r1.slotNumber]).toEqual([3, 4]);

    const rem = await mgr.post(`/api/manager/registrations/${r0.id}/reject`).send({ reason: "No-show last time" });
    expect(rem.body).toMatchObject({ status: "REJECTED", slotNumber: null, rejectionReason: "No-show last time" });

    const r2 = (await register(teams[2]!.agent, scrim.id)).body;
    expect(r2.slotNumber).toBe(3);

    const detail = await mgr.get(`/api/manager/scrims/${scrim.id}/sessions/${tomorrow()}`);
    expect(detail.status).toBe(200);
    expect(detail.body.counts).toEqual({ pending: 0, approved: 2, slotsLeft: 2 });
    expect(detail.body.slots.map((s: { slotNumber: number; registrationId: string | null }) => [s.slotNumber, s.registrationId])).toEqual([
      [3, r2.id],
      [4, r1.id],
      [5, null],
      [6, null],
    ]);

    const back = await register(teams[0]!.agent, scrim.id);
    expect(back.status).toBe(403);
    expect(back.body.error).toEqual({ code: "FORBIDDEN", message: "The organiser removed your team from this scrim" });
    // the old approve endpoint still works (older clients): it puts the removed team back
    expect((await mgr.post(`/api/manager/registrations/${r0.id}/approve`)).body).toMatchObject({ status: "APPROVED", slotNumber: 5 });
  });

  it("teams joining at the same time never share a slot", async () => {
    const { teams, scrim } = await setup(10, { slotCount: 5, firstSlot: 1 });
    const results = await Promise.all(teams.map((t) => register(t.agent, scrim.id)));

    const ok = results.filter((r) => r.status === 201);
    const full = results.filter((r) => r.status === 409);
    expect(ok).toHaveLength(5);
    expect(full).toHaveLength(5);
    for (const r of full) expect(r.body.error.code).toBe("SLOTS_FULL");
    expect(ok.map((r) => r.body.slotNumber).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(await prisma.registration.count({ where: { status: "APPROVED" } })).toBe(5);
  });

  it("SLOTS_FULL message when the scrim is full", async () => {
    const { teams, scrim } = await setup(3, { slotCount: 2 });
    expect((await register(teams[0]!.agent, scrim.id)).status).toBe(201);
    expect((await register(teams[1]!.agent, scrim.id)).status).toBe(201);
    const res = await register(teams[2]!.agent, scrim.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({ code: "SLOTS_FULL", message: "This scrim is full — every slot is taken" });
  });

  it("team cancels; slot is freed; cancelled team can join again", async () => {
    const { mgr, teams, scrim } = await setup(2);
    const r1 = (await register(teams[0]!.agent, scrim.id)).body;
    const r2 = (await register(teams[1]!.agent, scrim.id)).body;
    expect([r1.slotNumber, r2.slotNumber]).toEqual([3, 4]);

    // can't cancel someone else's
    expect((await teams[1]!.agent.delete(`/api/team/registrations/${r1.id}`)).status).toBe(404);

    expect((await teams[0]!.agent.delete(`/api/team/registrations/${r1.id}`)).status).toBe(204);
    const row = await prisma.registration.findUniqueOrThrow({ where: { id: r1.id } });
    expect(row).toMatchObject({ status: "CANCELLED", slotNumber: null });
    expect((await teams[0]!.agent.delete(`/api/team/registrations/${r1.id}`)).status).toBe(409);

    // the old approve endpoint can't bring back a cancelled registration
    expect((await mgr.post(`/api/manager/registrations/${r1.id}/approve`)).status).toBe(409);

    const again = await register(teams[0]!.agent, scrim.id);
    expect(again.body).toMatchObject({ id: r1.id, status: "APPROVED", slotNumber: 3 });
  });

  it("registration closes once the session has started", async () => {
    const { teams, scrim } = await setup(1);
    const res = await register(teams[0]!.agent, scrim.id, yesterday());
    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({ code: "REGISTRATION_CLOSED", message: "Registration for this scrim has closed" });

    // closed and not registered: the scrim is no longer listed for this team
    const list = await teams[0]!.agent.get("/api/team/scrims").query({ date: yesterday() });
    expect(list.body.items).toEqual([]);
  });

  it("can't register for a paused scrim or a date it doesn't run", async () => {
    const { mgr, teams, scrim } = await setup(1, { recurrence: "ONCE", startDate: tomorrow() });
    expect((await register(teams[0]!.agent, scrim.id, today())).status).toBe(404);
    await mgr.patch(`/api/manager/scrims/${scrim.id}`).send({ status: "PAUSED" }).expect(200);
    const res = await register(teams[0]!.agent, scrim.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("REGISTRATION_CLOSED");
    expect((await teams[0]!.agent.get("/api/team/scrims").query({ date: tomorrow() })).body.items).toHaveLength(0);
  });

  it("shrinking slots that would orphan an approved team is refused", async () => {
    const { mgr, teams, scrim } = await setup(2);
    const r1 = (await register(teams[0]!.agent, scrim.id)).body;
    const r2 = (await register(teams[1]!.agent, scrim.id)).body;
    await mgr.post(`/api/manager/registrations/${r1.id}/approve`).expect(200); // slot 3
    await mgr.post(`/api/manager/registrations/${r2.id}/approve`).expect(200); // slot 4
    const res = await mgr.patch(`/api/manager/scrims/${scrim.id}`).send({ slotCount: 2, firstSlot: 2 }); // 2..3
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONFLICT");
    expect(res.body.error.message).toMatch(/slot #4/);
    const ok = await mgr.patch(`/api/manager/scrims/${scrim.id}`).send({ slotCount: 10 });
    expect(ok.status).toBe(200);
    expect(ok.body.slotCount).toBe(10);
  });

  it("dashboards reflect registrations", async () => {
    const { mgr, teams, scrim } = await setup(2);
    const r1 = (await register(teams[0]!.agent, scrim.id)).body;
    await register(teams[1]!.agent, scrim.id);

    const md = await mgr.get("/api/manager/dashboard");
    expect(md.body).toMatchObject({ today: today(), pendingCount: 0, activeScrims: 1, upcomingApproved: 2 });

    const td = await teams[0]!.agent.get("/api/team/dashboard");
    expect(td.body.nextMatch).toMatchObject({ id: r1.id, slotNumber: 3, status: "APPROVED" });
    expect(td.body.counts).toEqual({ approvedUpcoming: 1, pending: 0, totalPlayed: 0 });
    expect(td.body.upcoming).toHaveLength(1);
  });
});
