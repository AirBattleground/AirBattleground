/** Phase 5b: one Google sign-in for everyone; role from the email; admin invites managers. (dev-login = same rules) */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { signInAdmin } from "../src/services/playerAuth.js";
import { adminAgent, createAdminUser, createManager, createTeam, http, joinTeam, newAgent, playerAgent, prisma, resetDb, server } from "./helpers.js";

const ADMIN_EMAIL = "airbattleground@gmail.com";

beforeEach(async () => {
  await resetDb();
  await createAdminUser();
});
afterAll(async () => {
  await prisma.$disconnect();
  server.close();
});

const cookies = (res: { headers: Record<string, unknown> }) => (res.headers["set-cookie"] as string[] | undefined) ?? [];

async function invite(admin: Awaited<ReturnType<typeof adminAgent>>, email: string, name = "Priya", orgName = "Thunder Esports") {
  return admin.post("/api/admin/manager-invites").send({ email, name, orgName });
}

describe("admin by email", () => {
  it("ADMIN_EMAIL signs in as the seeded admin and gets the admin cookie only", async () => {
    const agent = newAgent();
    const res = await agent.post("/api/auth/dev-login").send({ email: " AirBattleground@Gmail.com " });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ role: "ADMIN", username: "admin", player: null });
    const set = cookies(res);
    expect(set.some((c) => /^sx_admin=[^;]+/.test(c))).toBe(true);
    expect(set.some((c) => /^sx_app=;/.test(c))).toBe(true); // app cookie cleared
    // still exactly one admin, now with the email attached
    const admins = await prisma.user.findMany({ where: { role: "ADMIN" } });
    expect(admins).toHaveLength(1);
    expect(admins[0]!.email).toBe(ADMIN_EMAIL);
    // the admin session works in the admin area; the app area has no session for the admin
    expect((await agent.get("/api/admin/auth/me")).body.user.role).toBe("ADMIN");
    expect((await agent.get("/api/admin/stats")).status).toBe(200);
    expect((await agent.get("/api/auth/me")).status).toBe(401);
  });

  it("a player who already held ADMIN_EMAIL is detached and disabled", async () => {
    const p = await prisma.user.create({ data: { role: "PLAYER", email: ADMIN_EMAIL, googleSub: "g-123", displayName: "Owner" } });
    const res = await newAgent().post("/api/auth/dev-login").send({ email: ADMIN_EMAIL });
    expect(res.body.user.role).toBe("ADMIN");
    expect(await prisma.user.findUnique({ where: { id: p.id } })).toMatchObject({ email: null, googleSub: null, isActive: false });
  });

  it("/api/admin/auth/google refuses non-admin accounts", async () => {
    await expect(signInAdmin({ email: "someone@test.dev", name: null, googleSub: "x", avatarUrl: null })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "This Google account isn't the admin account.",
    });
    expect(await prisma.user.count({ where: { email: "someone@test.dev" } })).toBe(0);
    const ok = await signInAdmin({ email: ADMIN_EMAIL, name: null, googleSub: "g-admin", avatarUrl: null });
    expect(ok).toMatchObject({ role: "ADMIN", email: ADMIN_EMAIL, googleSub: "g-admin" });
    // the route itself: Google isn't configured in tests
    expect((await http().post("/api/admin/auth/google").send({ credential: "x".repeat(40) })).status).toBe(403);
  });

  it("random email → PLAYER", async () => {
    const res = await newAgent().post("/api/auth/dev-login").send({ email: "random@test.dev" });
    expect(res.body.user.role).toBe("PLAYER");
    expect(cookies(res).some((c) => /^sx_app=[^;]+/.test(c))).toBe(true);
  });
});

describe("manager invitations", () => {
  it("invite → that email signs in → MANAGER with orgName; invite ACCEPTED", async () => {
    const admin = await adminAgent();
    const created = await invite(admin, "  Priya@Thunder.GG ");
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      email: "priya@thunder.gg",
      name: "Priya",
      orgName: "Thunder Esports",
      status: "PENDING",
      invitedBy: { displayName: "Admin" },
      manager: null,
      acceptedAt: null,
    });
    expect((await admin.get("/api/admin/manager-invites")).body.items).toHaveLength(1);

    const agent = newAgent();
    const res = await agent.post("/api/auth/dev-login").send({ email: "priya@thunder.gg", name: "Google Name" });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ role: "MANAGER", displayName: "Priya", username: null });
    expect((await agent.get("/api/manager/dashboard")).status).toBe(200);

    expect((await admin.get("/api/admin/manager-invites")).body.items).toHaveLength(0);
    const accepted = (await admin.get("/api/admin/manager-invites?status=ACCEPTED")).body.items;
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ status: "ACCEPTED", manager: { id: res.body.user.id, displayName: "Priya" } });
    expect(accepted[0].acceptedAt).toEqual(expect.any(String));

    const managers = (await admin.get("/api/admin/managers")).body.items;
    expect(managers.find((m: { id: string }) => m.id === res.body.user.id)).toMatchObject({
      username: null,
      orgName: "Thunder Esports",
      email: "priya@thunder.gg",
    });

    // signing in again: same manager
    const again = await newAgent().post("/api/auth/dev-login").send({ email: "priya@thunder.gg" });
    expect(again.body.user).toMatchObject({ id: res.body.user.id, role: "MANAGER" });
    // now a manager: can't be invited again
    const dup = await invite(admin, "priya@thunder.gg");
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatchObject({ code: "CONFLICT", fields: { email: "They're already a manager." } });
  });

  it("a player without a team converts to manager; pending join requests go away", async () => {
    const admin = await adminAgent();
    const team = await createTeam(null, "Alpha Squad", "alphalead");
    const p = await playerAgent("solo");
    expect((await p.agent.post("/api/player/join-requests").send({ code: team.row.inviteCode })).status).toBe(201);
    expect((await invite(admin, p.email)).status).toBe(201);

    const res = await newAgent().post("/api/auth/dev-login").send({ email: p.email });
    expect(res.body.user).toMatchObject({ id: p.userId, role: "MANAGER", displayName: "Priya", player: null });
    expect(await prisma.teamJoinRequest.count({ where: { userId: p.userId, status: "PENDING" } })).toBe(0);
    // the old player session is over
    expect((await p.agent.get("/api/player/me")).status).toBe(401);
  });

  it("a player who joined a team after being invited stays a player (invite stays pending)", async () => {
    const admin = await adminAgent();
    const team = await createTeam(null, "Charlie Squad", "charlielead");
    const p = await playerAgent("late");
    expect((await invite(admin, p.email)).status).toBe(201);
    await joinTeam(team, p);
    const res = await newAgent().post("/api/auth/dev-login").send({ email: p.email });
    expect(res.body.user.role).toBe("PLAYER");
    expect((await admin.get("/api/admin/manager-invites")).body.items[0]).toMatchObject({ email: p.email, status: "PENDING" });
  });

  it("conflicts: player in a team, duplicate pending, admin email, existing manager", async () => {
    const admin = await adminAgent();
    const team = await createTeam(null, "Bravo Squad", "bravolead");
    const leaderEmail = (await prisma.user.findUniqueOrThrow({ where: { id: team.leaderId } })).email!;
    const inTeam = await invite(admin, leaderEmail);
    expect(inTeam.status).toBe(409);
    expect(inTeam.body.error).toMatchObject({
      code: "CONFLICT",
      fields: { email: "They're a player in a team — they must leave it first." },
    });

    expect((await invite(admin, "new@org.gg")).status).toBe(201);
    const dup = await invite(admin, "NEW@org.gg", "Other", "Other Org");
    expect(dup.status).toBe(409);
    expect(dup.body.error.fields.email).toMatch(/already invited/);

    expect((await invite(admin, ADMIN_EMAIL)).body.error.fields.email).toBe("That's the admin's email.");

    const { row } = await createManager(admin, "oldmgr");
    await admin.patch(`/api/admin/managers/${row.id}`).send({ email: "old@org.gg" });
    expect((await invite(admin, "old@org.gg")).body.error.fields.email).toBe("They're already a manager.");

    expect((await invite(admin, "bad")).status).toBe(400);
  });

  it("revoke: pending only; a revoked invite no longer makes a manager; can re-invite", async () => {
    const admin = await adminAgent();
    const created = (await invite(admin, "maybe@org.gg")).body;
    expect((await admin.delete(`/api/admin/manager-invites/${created.id}`)).status).toBe(204);
    const again = await admin.delete(`/api/admin/manager-invites/${created.id}`);
    expect(again.status).toBe(409);
    expect(again.body.error.message).toBe("This invitation was already revoked.");
    expect((await admin.delete("/api/admin/manager-invites/nope")).status).toBe(404);
    expect((await admin.get("/api/admin/manager-invites?status=REVOKED")).body.items).toHaveLength(1);

    const res = await newAgent().post("/api/auth/dev-login").send({ email: "maybe@org.gg" });
    expect(res.body.user.role).toBe("PLAYER");

    // a new invite after revoking is fine (the player has no team) → converts on next sign-in
    expect((await invite(admin, "maybe@org.gg")).status).toBe(201);
    expect((await newAgent().post("/api/auth/dev-login").send({ email: "maybe@org.gg" })).body.user.role).toBe("MANAGER");
    // accepted invites can't be revoked
    const acc = (await admin.get("/api/admin/manager-invites?status=ACCEPTED")).body.items[0];
    expect((await admin.delete(`/api/admin/manager-invites/${acc.id}`)).body.error.message).toBe(
      "This invitation was already accepted.",
    );
  });

  it("existing username/password manager whose email matches signs straight in; disabled users are refused", async () => {
    const admin = await adminAgent();
    const { row } = await createManager(admin, "legacy");
    await admin.patch(`/api/admin/managers/${row.id}`).send({ email: "Legacy@Org.gg" });
    const res = await newAgent().post("/api/auth/dev-login").send({ email: "legacy@org.gg" });
    expect(res.body.user).toMatchObject({ id: row.id, role: "MANAGER", username: "legacy" });

    await admin.patch(`/api/admin/managers/${row.id}`).send({ isActive: false });
    const off = await newAgent().post("/api/auth/dev-login").send({ email: "legacy@org.gg" });
    expect(off.status).toBe(403);
    // the password login refuses the disabled manager too
    expect((await http().post("/api/auth/login").send({ username: "legacy", password: "Manager@123" })).status).toBe(403);
  });
});
