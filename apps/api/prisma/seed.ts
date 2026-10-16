/**
 * Seeds the admin account from env (ADMIN_USERNAME / ADMIN_PASSWORD / ADMIN_NAME).
 * With SEED_DEMO=1 also creates demo managers, teams, scrims and registrations (idempotent).
 */
import { PrismaClient, type RegistrationStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { addDays, teamNameKey, todayInAppTz, weekdayOf } from "@7xen/shared";

const prisma = new PrismaClient();
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const hash = (p: string) => bcrypt.hash(p, 10);

const MANAGER_PASSWORD = "Manager@123";
const TEAM_PASSWORD = "Team@1234";

const TEAMS = [
  { name: "Team Soul", tag: "SOUL", username: "soul", captain: "Mortal" },
  { name: "GodLike Esports", tag: "GODL", username: "godlike", captain: "Jonathan" },
  { name: "Blind Esports", tag: "BLND", username: "blind", captain: "Manya" },
  { name: "Orangutan", tag: "OG", username: "orangutan", captain: "Ash" },
  { name: "Global Esports", tag: "GE", username: "global", captain: "Mavi" },
  { name: "Revenant", tag: "RNT", username: "revenant", captain: "Sensei" },
  { name: "Team XSpark", tag: "TX", username: "xspark", captain: "Scout" },
  { name: "Medal Esports", tag: "MDL", username: "medal", captain: "Spower" },
] as const;

async function seedAdmin() {
  const username = (process.env.ADMIN_USERNAME ?? "admin").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const displayName = process.env.ADMIN_NAME ?? "7xen Admin";
  if (!password) throw new Error("ADMIN_PASSWORD is not set");
  const passwordHash = await hash(password);
  await prisma.user.upsert({
    where: { username },
    create: { username, passwordHash, role: "ADMIN", displayName },
    update: { passwordHash, role: "ADMIN", displayName, isActive: true },
  });
  return { username, password };
}

async function upsertUser(username: string, password: string, role: "MANAGER" | "TEAM", displayName: string) {
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) return existing;
  return prisma.user.create({ data: { username, passwordHash: await hash(password), role, displayName } });
}

async function upsertScrim(
  managerId: string,
  data: {
    title: string;
    description?: string;
    maps: string[];
    startTime: string;
    recurrence: "ONCE" | "DAILY" | "WEEKENDS";
    startDate: string;
    endDate?: string | null;
    slotCount: number;
    firstSlot?: number;
  },
) {
  const existing = await prisma.scrim.findFirst({ where: { managerId, title: data.title } });
  if (existing) return existing;
  return prisma.scrim.create({
    data: {
      managerId,
      title: data.title,
      description: data.description ?? null,
      maps: data.maps,
      startTime: data.startTime,
      recurrence: data.recurrence,
      startDate: d(data.startDate),
      endDate: data.endDate ? d(data.endDate) : null,
      slotCount: data.slotCount,
      firstSlot: data.firstSlot ?? 1,
    },
  });
}

async function seedRegistrations(
  scrimId: string,
  date: string,
  managerId: string,
  entries: { teamId: string; status: RegistrationStatus; slot?: number; reason?: string }[],
) {
  const session = await prisma.scrimSession.upsert({
    where: { scrimId_date: { scrimId, date: d(date) } },
    create: { scrimId, date: d(date) },
    update: {},
  });
  for (const e of entries) {
    const decided = e.status === "APPROVED" || e.status === "REJECTED";
    await prisma.registration.upsert({
      where: { sessionId_teamId: { sessionId: session.id, teamId: e.teamId } },
      create: {
        sessionId: session.id,
        teamId: e.teamId,
        status: e.status,
        slotNumber: e.status === "APPROVED" ? (e.slot ?? null) : null,
        rejectionReason: e.reason ?? null,
        decidedAt: decided ? new Date() : null,
        decidedById: decided ? managerId : null,
      },
      update: {},
    });
  }
}

async function seedDemo() {
  const today = todayInAppTz();
  const tomorrow = addDays(today, 1);

  const m1 = await upsertUser("manager1", MANAGER_PASSWORD, "MANAGER", "Rahul (Scrim Host)");
  const m2 = await upsertUser("manager2", MANAGER_PASSWORD, "MANAGER", "Night Owl Org");

  const teams: { id: string; name: string }[] = [];
  for (const t of TEAMS) {
    const nameKey = teamNameKey(t.name);
    const found = await prisma.team.findUnique({ where: { nameKey } });
    if (found) {
      teams.push(found);
      continue;
    }
    const user = await upsertUser(t.username, TEAM_PASSWORD, "TEAM", t.name);
    const team = await prisma.team.upsert({
      where: { userId: user.id },
      create: { userId: user.id, name: t.name, nameKey, tag: t.tag, captainName: t.captain },
      update: {},
    });
    teams.push(team);
  }
  const [soul, godl, blnd, og, ge, rnt, tx, mdl] = teams.map((t) => t.id) as [
    string, string, string, string, string, string, string, string,
  ];

  const daily = await upsertScrim(m1.id, {
    title: "Daily Evening Showdown",
    description: "4 matches every evening. Be in the lobby 15 minutes early.",
    maps: ["ERANGEL", "MIRAMAR", "SANHOK", "ERANGEL"],
    startTime: "18:00",
    recurrence: "DAILY",
    startDate: addDays(today, -7),
    slotCount: 16,
    firstSlot: 3,
  });
  // start on the most recent Saturday so it has history
  const lastSat = addDays(today, -((weekdayOf(today) + 1) % 7));
  await upsertScrim(m1.id, {
    title: "Weekend Warzone",
    description: "Weekend-only grind. Top teams get invites to monthly finals.",
    maps: ["ERANGEL", "MIRAMAR", "VIKENDI", "SANHOK", "ERANGEL"],
    startTime: "20:00",
    recurrence: "WEEKENDS",
    startDate: lastSat,
    slotCount: 22,
    firstSlot: 1,
  });
  const vr1 = await upsertScrim(m1.id, {
    title: "VR1 Showdown",
    description: "One-night special. Approved teams get room details on the day.",
    maps: ["ERANGEL", "MIRAMAR", "ERANGEL"],
    startTime: "21:00",
    recurrence: "ONCE",
    startDate: tomorrow,
    slotCount: 20,
    firstSlot: 1,
  });
  const night = await upsertScrim(m2.id, {
    title: "Night Owl Scrims",
    description: "Late night scrims for the grinders.",
    maps: ["ERANGEL", "SANHOK", "MIRAMAR"],
    startTime: "23:00",
    recurrence: "DAILY",
    startDate: addDays(today, -3),
    slotCount: 18,
    firstSlot: 1,
  });

  await seedRegistrations(daily.id, today, m1.id, [
    { teamId: soul, status: "APPROVED", slot: 3 },
    { teamId: godl, status: "APPROVED", slot: 4 },
    { teamId: blnd, status: "APPROVED", slot: 5 },
    { teamId: og, status: "PENDING" },
    { teamId: ge, status: "REJECTED", reason: "Roster not confirmed" },
  ]);
  await seedRegistrations(daily.id, tomorrow, m1.id, [
    { teamId: soul, status: "APPROVED", slot: 3 },
    { teamId: rnt, status: "APPROVED", slot: 4 },
    { teamId: godl, status: "PENDING" },
    { teamId: tx, status: "PENDING" },
    { teamId: mdl, status: "PENDING" },
  ]);
  await seedRegistrations(vr1.id, tomorrow, m1.id, [
    { teamId: blnd, status: "APPROVED", slot: 1 },
    { teamId: soul, status: "PENDING" },
    { teamId: og, status: "PENDING" },
    { teamId: ge, status: "CANCELLED" },
  ]);
  await seedRegistrations(night.id, today, m2.id, [
    { teamId: tx, status: "APPROVED", slot: 1 },
    { teamId: mdl, status: "PENDING" },
    { teamId: rnt, status: "PENDING" },
  ]);
  await seedRegistrations(night.id, tomorrow, m2.id, [
    { teamId: soul, status: "PENDING" },
    { teamId: godl, status: "APPROVED", slot: 1 },
  ]);
}

async function main() {
  const admin = await seedAdmin();
  const demo = process.env.SEED_DEMO === "1" || process.env.SEED_DEMO === "true";
  if (demo) await seedDemo();

  console.log("\nSeed complete.\n");
  console.log(`  Admin console : ${admin.username} / ${admin.password}`);
  if (demo) {
    console.log(`  Managers      : manager1, manager2  /  ${MANAGER_PASSWORD}`);
    console.log(`  Teams         : ${TEAMS.map((t) => t.username).join(", ")}  /  ${TEAM_PASSWORD}`);
  } else {
    console.log("  (Set SEED_DEMO=1 to also create demo managers, teams and scrims.)");
  }
  console.log("");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
