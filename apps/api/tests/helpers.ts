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
    'TRUNCATE TABLE "GroupTeam", "TournamentGroup", "TournamentEntry", "TournamentStage", "Tournament", "TrainingSample", "MatchPlayer", "MatchTeam", "Screenshot", "Match", "TeamPlayer", "TeamRequest", "Registration", "ScrimSession", "Scrim", "Team", "User" RESTART IDENTITY CASCADE',
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

export async function createTeam(admin: TestAgent, name = `Team ${++seq}`, username = `team${seq}`) {
  const res = await admin
    .post("/api/admin/teams")
    .send({ teamName: name, tag: `T${seq}`.slice(0, 5), username, password: "Team@1234" });
  if (res.status !== 201) throw new Error(`create team failed: ${JSON.stringify(res.body)}`);
  return { row: res.body, agent: await appAgent(username, "Team@1234") };
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
