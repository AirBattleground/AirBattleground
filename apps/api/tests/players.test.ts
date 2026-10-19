/** Phase 5: player accounts, teams, join requests, leader-only actions and "Ask my leader" suggestions. */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_TEAM_MEMBERS } from "@7xen/shared";
import {
  adminAgent,
  createAdminUser,
  createManager,
  createScrim,
  createTeam,
  http,
  joinTeam,
  newAgent,
  playerAgent,
  prisma,
  resetDb,
  server,
  tomorrow,
} from "./helpers.js";

beforeEach(async () => {
  await resetDb();
  await createAdminUser();
});
afterAll(async () => {
  await prisma.$disconnect();
  server.close();
});

describe("player sign-in", () => {
  it("auth config + dev login creates a player who must pick an IGN; roles stay in their own areas", async () => {
    expect((await http().get("/api/auth/config")).body).toEqual({ googleClientId: null, devLogin: true });

    const agent = newAgent();
    const res = await agent.post("/api/auth/dev-login").send({ email: "  Rookie@Example.com ", name: "Rookie" });
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]?.[0]).toMatch(/^sx_app=.*HttpOnly/i);
    expect(res.body.user).toMatchObject({
      username: null,
      role: "PLAYER",
      displayName: "Rookie",
      team: null,
      player: { ign: null, bgmiId: null, email: "rookie@example.com", team: null, needsOnboarding: true },
    });
    // same email again → same account
    const again = await newAgent().post("/api/auth/dev-login").send({ email: "rookie@example.com" });
    expect(again.body.user.id).toBe(res.body.user.id);
    expect(await prisma.user.count({ where: { role: "PLAYER" } })).toBe(1);

    // onboarding
    const ign = await agent.patch("/api/player/me").send({ ign: "  RookieX " });
    expect(ign.status).toBe(200);
    expect(ign.body).toMatchObject({ ign: "RookieX", bgmiId: null, team: null, pendingJoinRequest: null });
    expect((await agent.get("/api/auth/me")).body.user.player).toMatchObject({ ign: "RookieX", needsOnboarding: false });
    expect((await agent.patch("/api/player/me").send({ ign: "x" })).status).toBe(400);

    // Google sign-in is off without GOOGLE_CLIENT_ID
    const g = await http().post("/api/auth/google").send({ credential: "x".repeat(40) });
    expect(g.status).toBe(403);

    // players are kept out of manager areas; managers out of player areas
    expect((await agent.get("/api/manager/dashboard")).status).toBe(403);
    const { agent: mgr } = await createManager(await adminAgent(), "boss");
    expect((await mgr.get("/api/player/me")).status).toBe(403);
  });

  it("BGMI ID is unique and required before creating or joining a team", async () => {
    const a = await playerAgent("alpha", { bgmiId: null });
    const create = await a.agent.post("/api/player/team").send({ name: "Alpha Squad", tag: "ALP" });
    expect(create.status).toBe(400);
    expect(create.body.error.code).toBe("BGMI_ID_REQUIRED");
    const join = await a.agent.post("/api/player/join-requests").send({ code: "ABCDEFGH" });
    expect(join.body.error.code).toBe("BGMI_ID_REQUIRED");

    const b = await playerAgent("bravo", { bgmiId: "5123456789" });
    const taken = await a.agent.patch("/api/player/me").send({ bgmiId: "5123456789" });
    expect(taken.status).toBe(409);
    expect(taken.body.error).toMatchObject({ code: "BGMI_ID_TAKEN", fields: { bgmiId: expect.any(String) } });
    expect((await a.agent.patch("/api/player/me").send({ bgmiId: "12ab" })).status).toBe(400);
    expect((await a.agent.patch("/api/player/me").send({ bgmiId: "5111111111" })).body.bgmiId).toBe("5111111111");
    // can't clear it while in a team
    expect((await b.agent.post("/api/player/team").send({ name: "Bravo", tag: "BRV" })).status).toBe(201);
    expect((await b.agent.patch("/api/player/me").send({ bgmiId: "" })).status).toBe(409);
  });
});

describe("teams", () => {
  it("create → invite preview → join request → leader approves; names unique; one team per player", async () => {
    const leader = await playerAgent("mortal");
    const created = await leader.agent.post("/api/player/team").send({ name: "Team Soul", tag: "soul" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: "Team Soul",
      tag: "SOUL",
      leaderId: leader.userId,
      myRole: "LEADER",
      maxMembers: MAX_TEAM_MEMBERS,
      members: [{ id: leader.userId, ign: "mortal", role: "LEADER" }],
      joinRequests: [],
      openSuggestions: 0,
    });
    const code = created.body.inviteCode as string;
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    expect((await leader.agent.get("/api/auth/me")).body.user).toMatchObject({ team: { id: created.body.id }, player: { team: { role: "LEADER" } } });

    // second team by the same leader / a duplicate name
    expect((await leader.agent.post("/api/player/team").send({ name: "Other", tag: "OT" })).body.error.code).toBe("ALREADY_IN_TEAM");
    const other = await playerAgent("viper");
    const dup = await other.agent.post("/api/player/team").send({ name: "  team   SOUL ", tag: "TS" });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toEqual({ code: "CONFLICT", message: "That team name is already taken", fields: { name: "That team name is already taken" } });

    // invite preview (code is normalised)
    const preview = await other.agent.get(`/api/player/invites/${code.toLowerCase()}`);
    expect(preview.body).toMatchObject({ code, team: { name: "Team Soul" }, leader: { id: leader.userId, ign: "mortal" }, memberCount: 1, full: false });
    expect((await other.agent.get("/api/player/invites/ZZZZZZZZ")).body.error.code).toBe("INVITE_INVALID");

    const jr = await other.agent.post("/api/player/join-requests").send({ code: code.slice(0, 4) + "-" + code.slice(4), message: "Let me in" });
    expect(jr.status).toBe(201);
    expect(jr.body).toMatchObject({ status: "PENDING", team: { name: "Team Soul" }, message: "Let me in" });
    expect((await other.agent.post("/api/player/join-requests").send({ code })).body.error.code).toBe("JOIN_REQUEST_PENDING");
    expect((await other.agent.get("/api/player/me")).body.pendingJoinRequest).toMatchObject({ id: jr.body.id });

    const view = (await leader.agent.get("/api/player/team")).body;
    expect(view.joinRequests).toEqual([expect.objectContaining({ id: jr.body.id, player: expect.objectContaining({ id: other.userId, ign: "viper" }), message: "Let me in" })]);

    const ok = await leader.agent.post(`/api/player/team/join-requests/${jr.body.id}/approve`);
    expect(ok.status).toBe(200);
    expect(ok.body.members.map((m: { ign: string; role: string }) => `${m.ign}:${m.role}`)).toEqual(["mortal:LEADER", "viper:MEMBER"]);
    // a member sees the team without the invite code or requests
    const asMember = (await other.agent.get("/api/player/team")).body;
    expect(asMember).toMatchObject({ myRole: "MEMBER", inviteCode: null, joinRequests: [] });
    expect((await other.agent.post("/api/player/team/invite-code")).body.error.code).toBe("LEADER_ONLY");
    expect((await other.agent.get("/api/player/join-requests")).body.items[0]).toMatchObject({ status: "APPROVED" });

    // ALREADY_IN_TEAM for a member asking to join another team
    const t2 = await createTeam(null, "Team Two", "twolead");
    expect((await other.agent.post("/api/player/join-requests").send({ code: t2.row.inviteCode })).body.error.code).toBe("ALREADY_IN_TEAM");

    // rotating the code kills the old link
    const rotated = await leader.agent.post("/api/player/team/invite-code");
    expect(rotated.body.inviteCode).not.toBe(code);
    expect((await (await playerAgent("late")).agent.post("/api/player/join-requests").send({ code })).body.error.code).toBe("INVITE_INVALID");
  });

  it("TEAM_FULL when requesting or approving past the limit; reject and cancel", async () => {
    const t = await createTeam(null, "Full House", "boss");
    for (let i = 1; i < MAX_TEAM_MEMBERS - 1; i++) await joinTeam(t, await playerAgent(`m${i}`));
    // one spot left, two people ask
    const p1 = await playerAgent("p1");
    const p2 = await playerAgent("p2");
    const r1 = await p1.agent.post("/api/player/join-requests").send({ code: t.row.inviteCode });
    const r2 = await p2.agent.post("/api/player/join-requests").send({ code: t.row.inviteCode });
    expect((await t.agent.post(`/api/player/team/join-requests/${r1.body.id}/approve`)).status).toBe(200);
    const full = await t.agent.post(`/api/player/team/join-requests/${r2.body.id}/approve`);
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe("TEAM_FULL");
    expect((await t.agent.post(`/api/player/team/join-requests/${r2.body.id}/reject`)).status).toBe(200);
    expect((await p2.agent.get("/api/player/join-requests")).body.items[0].status).toBe("REJECTED");
    // the invite preview says full, and new requests are refused
    const p3 = await playerAgent("p3");
    expect((await p3.agent.get(`/api/player/invites/${t.row.inviteCode}`)).body.full).toBe(true);
    expect((await p3.agent.post("/api/player/join-requests").send({ code: t.row.inviteCode })).body.error.code).toBe("TEAM_FULL");

    // cancel own pending request
    const t2 = await createTeam(null, "Other Team", "other");
    const r3 = await p3.agent.post("/api/player/join-requests").send({ code: t2.row.inviteCode });
    expect((await p3.agent.delete(`/api/player/join-requests/${r3.body.id}`)).status).toBe(204);
    expect((await p3.agent.get("/api/player/me")).body.pendingJoinRequest).toBeNull();
    expect((await t2.agent.post(`/api/player/team/join-requests/${r3.body.id}/approve`)).status).toBe(409);
  });

  it("leave, remove, transfer leadership and disband follow the rules", async () => {
    const t = await createTeam(null, "Rules FC", "lead");
    const a = await playerAgent("aaa");
    const b = await playerAgent("bbb");
    await joinTeam(t, a);
    await joinTeam(t, b);

    // the leader can't leave or remove themselves
    const leave = await t.agent.post("/api/player/team/leave");
    expect(leave.status).toBe(409);
    expect(leave.body.error.message).toMatch(/Make someone else leader first, or disband/);
    expect((await t.agent.delete(`/api/player/team/members/${t.leaderId}`)).status).toBe(409);
    // members can't manage
    expect((await a.agent.delete(`/api/player/team/members/${b.userId}`)).body.error.code).toBe("LEADER_ONLY");
    expect((await a.agent.delete("/api/player/team")).body.error.code).toBe("LEADER_ONLY");

    // a member leaves
    expect((await b.agent.post("/api/player/team/leave")).status).toBe(204);
    expect((await b.agent.get("/api/player/team")).status).toBe(404);
    expect((await b.agent.get("/api/player/team")).body.error.code).toBe("NO_TEAM");

    // transfer: roles swap atomically
    const tr = await t.agent.post("/api/player/team/transfer").send({ userId: a.userId });
    expect(tr.status).toBe(200);
    expect(tr.body).toMatchObject({ leaderId: a.userId, myRole: "MEMBER", inviteCode: null });
    expect((await prisma.team.findUniqueOrThrow({ where: { id: t.row.id } })).leaderId).toBe(a.userId);
    expect((await t.agent.post("/api/player/team/transfer").send({ userId: b.userId })).body.error.code).toBe("LEADER_ONLY");

    // new leader removes the old one, then disbands
    const removed = await a.agent.delete(`/api/player/team/members/${t.leaderId}`);
    expect(removed.body.members).toHaveLength(1);
    expect((await a.agent.delete(`/api/player/team/members/${b.userId}`)).status).toBe(404);

    // disband is refused while the team has an upcoming registration
    const { agent: mgr } = await createManager(await adminAgent());
    const scrim = await createScrim(mgr);
    const reg = await a.agent.post("/api/team/registrations").send({ scrimId: scrim.id, date: tomorrow() });
    expect(reg.status).toBe(201);
    const blocked = await a.agent.delete("/api/player/team");
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/upcoming scrim registration/);
    expect((await a.agent.delete(`/api/team/registrations/${reg.body.id}`)).status).toBe(204);
    expect((await a.agent.delete("/api/player/team")).status).toBe(204);
    expect(await prisma.team.count()).toBe(0);
    expect((await a.agent.get("/api/auth/me")).body.user).toMatchObject({ team: null, player: { team: null } });
  });
});

describe("team area: leader-only actions and Ask my leader", () => {
  it("NO_TEAM without a team", async () => {
    const p = await playerAgent("solo");
    const res = await p.agent.get("/api/team/dashboard");
    expect(res.status).toBe(403);
    expect(res.body.error).toEqual({ code: "NO_TEAM", message: "Create or join a team first." });
  });

  it("members ask, the leader registers (suggestion DONE) or dismisses", async () => {
    const { agent: mgr } = await createManager(await adminAgent());
    const scrim = await createScrim(mgr);
    const t = await createTeam(null, "Squad", "leader");
    const m = await playerAgent("member");
    await joinTeam(t, m);

    // member can't register or cancel
    const denied = await m.agent.post("/api/team/registrations").send({ scrimId: scrim.id, date: tomorrow() });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toEqual({ code: "LEADER_ONLY", message: "Only your team leader can do this — tap “Ask my leader” instead." });

    // ... but can ask (deduped while OPEN)
    const ask = await m.agent.post("/api/player/team/suggestions").send({ kind: "SCRIM", scrimId: scrim.id, date: tomorrow(), note: "Let's play" });
    expect(ask.status).toBe(201);
    expect(ask.body).toMatchObject({ kind: "SCRIM", status: "OPEN", from: { id: m.userId, ign: "member" }, note: "Let's play", scrim: { id: scrim.id, title: "Test Scrim", date: tomorrow(), startTime: "21:00" }, tournament: null });
    const again = await m.agent.post("/api/player/team/suggestions").send({ kind: "SCRIM", scrimId: scrim.id, date: tomorrow() });
    expect(again.body.id).toBe(ask.body.id);
    expect(await prisma.teamSuggestion.count()).toBe(1);

    const scrims = await m.agent.get("/api/team/scrims").query({ date: tomorrow() });
    expect(scrims.body.items[0]).toMatchObject({ myRegistration: null, mySuggestion: { id: ask.body.id, fromIgn: "member" } });
    const dash = await t.agent.get("/api/team/dashboard");
    expect(dash.body).toMatchObject({ myTeamRole: "LEADER", openSuggestions: 1, team: { captainName: "leader" } });
    expect((await m.agent.get("/api/team/dashboard")).body.myTeamRole).toBe("MEMBER");
    expect((await t.agent.get("/api/player/team/suggestions")).body.items).toHaveLength(1);
    expect((await m.agent.post(`/api/player/team/suggestions/${ask.body.id}/dismiss`)).body.error.code).toBe("LEADER_ONLY");

    // leader registers → suggestion DONE, registeredById recorded
    const reg = await t.agent.post("/api/team/registrations").send({ scrimId: scrim.id, date: tomorrow() });
    expect(reg.status).toBe(201);
    expect((await prisma.registration.findUniqueOrThrow({ where: { id: reg.body.id } })).registeredById).toBe(t.leaderId);
    expect((await t.agent.get("/api/player/team/suggestions")).body.items).toHaveLength(0);
    expect((await t.agent.get("/api/player/team/suggestions").query({ status: "DONE" })).body.items[0].id).toBe(ask.body.id);
    expect((await m.agent.get("/api/team/scrims").query({ date: tomorrow() })).body.items[0].mySuggestion).toBeNull();
    // asking again now says the team is already registered
    expect((await m.agent.post("/api/player/team/suggestions").send({ kind: "SCRIM", scrimId: scrim.id, date: tomorrow() })).status).toBe(409);
    // members can't cancel it either
    expect((await m.agent.delete(`/api/team/registrations/${reg.body.id}`)).body.error.code).toBe("LEADER_ONLY");

    // a second ask the leader dismisses
    const scrim2 = await createScrim(mgr, { title: "Other Scrim" });
    const ask2 = await m.agent.post("/api/player/team/suggestions").send({ kind: "SCRIM", scrimId: scrim2.id, date: tomorrow() });
    const dismissed = await t.agent.post(`/api/player/team/suggestions/${ask2.body.id}/dismiss`);
    expect(dismissed.body).toMatchObject({ id: ask2.body.id, status: "DISMISSED" });
    expect((await t.agent.get("/api/team/dashboard")).body.openSuggestions).toBe(0);

    // unknown targets
    expect((await m.agent.post("/api/player/team/suggestions").send({ kind: "TOURNAMENT", tournamentId: "nope" })).status).toBe(404);
  });
});
