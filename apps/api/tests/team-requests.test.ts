import { beforeEach, describe, expect, it } from "vitest";
import { adminAgent, appAgent, createAdminUser, createManager, createTeam, http, resetDb } from "./helpers.js";

const req = (teamName: string, username: string) => ({ teamName, tag: "TST", username, password: "Team@1234", captainName: "Cap" });

beforeEach(async () => {
  await resetDb();
  await createAdminUser();
});

describe("manager team requests → admin approval", () => {
  it("full lifecycle: request, login blocked, approve, login works", async () => {
    const admin = await adminAgent();
    const { agent: mgr, row: mgrRow } = await createManager(admin);

    const created = await mgr.post("/api/manager/team-requests").send(req("Hydra Esports", "hydra"));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: "PENDING", teamName: "Hydra Esports", tag: "TST", username: "hydra", teamId: null });
    expect(created.body.manager.id).toBe(mgrRow.id);
    expect(created.body).not.toHaveProperty("passwordHash");

    // can't log in yet — but gets a helpful message with the right password
    const early = await http().post("/api/auth/login").send({ username: "hydra", password: "Team@1234" });
    expect(early.status).toBe(403);
    expect(early.body.error.message).toMatch(/waiting for admin approval/i);
    const wrongPw = await http().post("/api/auth/login").send({ username: "hydra", password: "nope-nope" });
    expect(wrongPw.status).toBe(401);

    expect((await admin.get("/api/admin/stats")).body.teamRequests).toEqual({ pending: 1 });
    const queue = await admin.get("/api/admin/team-requests");
    expect(queue.body.items).toHaveLength(1);

    const approved = await admin.post(`/api/admin/team-requests/${created.body.id}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ name: "Hydra Esports", username: "hydra", isActive: true });
    expect(approved.body.requestedBy).toEqual({ id: mgrRow.id, displayName: mgrRow.displayName });

    // approving twice is refused
    expect((await admin.post(`/api/admin/team-requests/${created.body.id}/approve`)).status).toBe(409);

    const team = await appAgent("hydra", "Team@1234");
    expect((await team.get("/api/auth/me")).body.user.team.name).toBe("Hydra Esports");

    const mine = await mgr.get("/api/manager/team-requests");
    expect(mine.body.items[0]).toMatchObject({ status: "APPROVED", teamId: approved.body.id });
    expect((await admin.get("/api/admin/stats")).body.teamRequests).toEqual({ pending: 0 });
  });

  it("team names stay unique across teams and pending requests (case/space-insensitive)", async () => {
    const admin = await adminAgent();
    const { agent: m1 } = await createManager(admin);
    const { agent: m2 } = await createManager(admin);
    await createTeam(admin, "Team Soul", "soul");

    const dupTeam = await m1.post("/api/manager/team-requests").send(req("  team   SOUL ", "soul2"));
    expect(dupTeam.status).toBe(409);
    expect(dupTeam.body.error.fields).toEqual({ teamName: "That team name is already taken" });

    const dupUser = await m1.post("/api/manager/team-requests").send(req("Fresh", "soul"));
    expect(dupUser.body.error.fields).toEqual({ username: "That username is already taken" });

    expect((await m1.post("/api/manager/team-requests").send(req("Night Wolves", "wolves"))).status).toBe(201);
    // another manager can't queue the same name or username
    const clash = await m2.post("/api/manager/team-requests").send(req("night wolves", "wolves"));
    expect(clash.status).toBe(409);
    expect(Object.keys(clash.body.error.fields).sort()).toEqual(["teamName", "username"]);
    expect(clash.body.error.fields.teamName).toMatch(/waiting for admin approval/);
    // the admin can't create it directly either
    const adminDup = await admin.post("/api/admin/teams").send({ ...req("Night Wolves", "nw2") });
    expect(adminDup.status).toBe(409);

    const avail = await m2.get("/api/manager/teams/availability").query({ teamName: "NIGHT WOLVES", username: "free_name" });
    expect(avail.body).toEqual({
      teamName: { available: false, message: "Already requested — waiting for admin approval" },
      username: { available: true, message: null },
    });
    const adminAvail = await admin.get("/api/admin/teams/availability").query({ teamName: "team soul" });
    expect(adminAvail.body.teamName).toEqual({ available: false, message: "Already taken" });
  });

  it("reject frees the name; manager can withdraw only pending requests; managers see only their own", async () => {
    const admin = await adminAgent();
    const { agent: m1 } = await createManager(admin);
    const { agent: m2 } = await createManager(admin);

    const a = await m1.post("/api/manager/team-requests").send(req("Alpha", "alpha"));
    const rejected = await admin.post(`/api/admin/team-requests/${a.body.id}/reject`).send({ reason: "Duplicate of an existing roster" });
    expect(rejected.body).toMatchObject({ status: "REJECTED", rejectionReason: "Duplicate of an existing roster" });
    expect((await admin.post(`/api/admin/team-requests/${a.body.id}/approve`)).status).toBe(409);

    const blocked = await http().post("/api/auth/login").send({ username: "alpha", password: "Team@1234" });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.message).toMatch(/not approved: Duplicate of an existing roster/);

    // name is free again
    const again = await m2.post("/api/manager/team-requests").send(req("ALPHA", "alpha"));
    expect(again.status).toBe(201);

    expect((await m1.get("/api/manager/team-requests")).body.items).toHaveLength(1);
    expect((await m1.delete(`/api/manager/team-requests/${again.body.id}`)).status).toBe(404); // not theirs
    expect((await m1.delete(`/api/manager/team-requests/${a.body.id}`)).status).toBe(409); // already reviewed
    expect((await m2.delete(`/api/manager/team-requests/${again.body.id}`)).status).toBe(204);
    expect((await m2.get("/api/manager/team-requests")).body.items).toHaveLength(0);

    const history = await admin.get("/api/admin/team-requests").query({ status: "REJECTED" });
    expect(history.body.items).toHaveLength(1);
  });

  it("concurrent approvals of the same request create exactly one team", async () => {
    const admin = await adminAgent();
    const { agent: mgr } = await createManager(admin);
    const r = await mgr.post("/api/manager/team-requests").send(req("Race Team", "race"));
    const results = await Promise.all(Array.from({ length: 5 }, () => admin.post(`/api/admin/team-requests/${r.body.id}/approve`)));
    expect(results.filter((x) => x.status === 200)).toHaveLength(1);
    expect(results.filter((x) => x.status === 409)).toHaveLength(4);
    expect((await admin.get("/api/admin/teams").query({ q: "Race Team" })).body.items).toHaveLength(1);
  });

  it("only managers can submit; teams and anonymous users can't", async () => {
    const admin = await adminAgent();
    const { agent: team } = await createTeam(admin);
    expect((await team.post("/api/manager/team-requests").send(req("X Team", "xteam"))).status).toBe(403);
    expect((await http().post("/api/manager/team-requests").send(req("X Team", "xteam"))).status).toBe(401);
    const bad = await (await createManager(admin)).agent.post("/api/manager/team-requests").send({ teamName: "x" });
    expect(bad.status).toBe(400);
  });
});
