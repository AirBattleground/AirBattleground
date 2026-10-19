import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { addDays, todayInAppTz } from "@7xen/shared";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { hashPassword } from "../src/lib/password.js";

export type TestAgent = ReturnType<typeof request.agent>;

export const app = createApp();
/** One real listening server shared by all requests (avoids a server per supertest call). */
export const server = createServer(app).listen(0, "127.0.0.1");
const base = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
export const http = () => request(base());
export const newAgent = () => request.agent(base());
export { prisma };

export const today = () => todayInAppTz();
export const tomorrow = () => addDays(todayInAppTz(), 1);
export const yesterday = () => addDays(todayInAppTz(), -1);

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "MatchRecording", "Recipe", "AppSetting", "GroupTeam", "TournamentGroup", "TournamentEntry", "TournamentStage", "Tournament", "TrainingSample", "MatchPlayer", "MatchTeam", "Screenshot", "Match", "TeamPlayer", "TeamSuggestion", "TeamJoinRequest", "TeamMember", "Registration", "ScrimSession", "Scrim", "Team", "User" RESTART IDENTITY CASCADE',
  );
}

export const ADMIN = { username: "admin", password: "Admin@12345" };

export async function createAdminUser() {
  await prisma.user.create({
    data: { username: ADMIN.username, passwordHash: await hashPassword(ADMIN.password), role: "ADMIN", displayName: "Admin" },
  });
}

export async function adminAgent(): Promise<TestAgent> {
  const agent = request.agent(base());
  const res = await agent.post("/api/admin/auth/login").send(ADMIN);
  if (res.status !== 200) throw new Error(`admin login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

export async function appAgent(username: string, password: string): Promise<TestAgent> {
  const agent = request.agent(base());
  const res = await agent.post("/api/auth/login").send({ username, password });
  if (res.status !== 200) throw new Error(`login failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

let seq = 0;
export async function createManager(admin: TestAgent, username = `mgr${++seq}`) {
  const res = await admin
    .post("/api/admin/managers")
    .send({ displayName: `Manager ${username}`, username, password: "Manager@123" });
  if (res.status !== 201) throw new Error(`create manager failed: ${JSON.stringify(res.body)}`);
  return { row: res.body, agent: await appAgent(username, "Manager@123") };
}

let bgmiSeq = 0;
/** phase 5: a player signed in with the dev email login (IGN set; BGMI ID set unless `bgmiId: null`). */
export async function playerAgent(
  handle = `player${++seq}`,
  opts: { ign?: string | null; bgmiId?: string | null } = {},
): Promise<{ agent: TestAgent; userId: string; email: string }> {
  const agent = request.agent(base());
  const email = `${handle.toLowerCase()}@test.dev`;
  const res = await agent.post("/api/auth/dev-login").send({ email, name: handle });
  if (res.status !== 200) throw new Error(`dev login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  const ign = opts.ign === undefined ? handle : opts.ign;
  const bgmiId = opts.bgmiId === undefined ? String(5_100_000_000 + ++bgmiSeq) : opts.bgmiId;
  const patch: Record<string, string> = {};
  if (ign) patch.ign = ign;
  if (bgmiId) patch.bgmiId = bgmiId;
  if (Object.keys(patch).length) {
    const p = await agent.patch("/api/player/me").send(patch);
    if (p.status !== 200) throw new Error(`profile update failed: ${JSON.stringify(p.body)}`);
  }
  return { agent, userId: res.body.user.id as string, email };
}

/**
 * phase 5: a team = a leader player who created it. `agent` is the leader's session (it acts for the team on
 * /api/team/*). The `admin` and `username` params are kept for older call sites (username → the leader's handle).
 */
export async function createTeam(_admin: TestAgent | null, name = `Team ${++seq}`, username = `team${seq}`) {
  const leader = await playerAgent(username);
  const res = await leader.agent.post("/api/player/team").send({ name, tag: `T${seq}`.slice(0, 5) });
  if (res.status !== 201) throw new Error(`create team failed: ${JSON.stringify(res.body)}`);
  return { row: res.body as { id: string; name: string; inviteCode: string }, agent: leader.agent, leaderId: leader.userId };
}

/** phase 5: `player` joins `team` by its invite code and the leader approves. */
export async function joinTeam(team: { row: { inviteCode: string }; agent: TestAgent }, player: { agent: TestAgent }) {
  const jr = await player.agent.post("/api/player/join-requests").send({ code: team.row.inviteCode });
  if (jr.status !== 201) throw new Error(`join request failed: ${JSON.stringify(jr.body)}`);
  const ok = await team.agent.post(`/api/player/team/join-requests/${jr.body.id}/approve`);
  if (ok.status !== 200) throw new Error(`approve failed: ${JSON.stringify(ok.body)}`);
  return ok.body;
}

export async function createScrim(manager: TestAgent, overrides: Record<string, unknown> = {}) {
  const res = await manager.post("/api/manager/scrims").send({
    title: "Test Scrim",
    maps: ["ERANGEL", "MIRAMAR"],
    startTime: "21:00",
    recurrence: "DAILY",
    startDate: yesterday(),
    slotCount: 4,
    firstSlot: 3,
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`create scrim failed: ${JSON.stringify(res.body)}`);
  return res.body as { id: string };
}
