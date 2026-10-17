/**
 * Seeds the admin account from env (ADMIN_USERNAME / ADMIN_PASSWORD / ADMIN_NAME) and the real
 * screenshots in services/extractor/eval/dataset/real as training samples (source SEED, unverified).
 * With SEED_DEMO=1 also creates demo managers, teams, scrims, registrations, rosters and published
 * match results and an open demo tournament (idempotent).
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient, type Prisma, type RegistrationStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DEFAULT_POINTS_SYSTEM, addDays, matchPoints, teamNameKey, todayInAppTz, weekdayOf } from "@7xen/shared";
import { createDemoTournament } from "../src/services/tournaments/demo.js";
import { imageInfo, saveBuffer, sha256, splitForSha, storageRoot } from "../src/lib/storage.js";

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
    const existing = await prisma.registration.findUnique({ where: { sessionId_teamId: { sessionId: session.id, teamId: e.teamId } } });
    if (existing) continue;
    // the dev DB may already have someone (e.g. a test team) on the wanted slot: take the next free one
    let slot = e.status === "APPROVED" ? (e.slot ?? null) : null;
    if (slot != null) {
      const taken = new Set(
        (await prisma.registration.findMany({ where: { sessionId: session.id, slotNumber: { not: null } }, select: { slotNumber: true } })).map(
          (r) => r.slotNumber,
        ),
      );
      while (taken.has(slot)) slot++;
    }
    await prisma.registration.upsert({
      where: { sessionId_teamId: { sessionId: session.id, teamId: e.teamId } },
      create: {
        sessionId: session.id,
        teamId: e.teamId,
        status: e.status,
        slotNumber: slot,
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

  await seedDemoResults(daily, m1.id, teams);
  // phase 3: an open tournament with the demo teams registered (8 of 16 spots taken)
  await createDemoTournament(prisma, { managerId: m1.id, teamIds: teams.map((t) => t.id), maxTeams: 16, lobbySize: 8 });
}

// ---------------------------------------------------------------- phase 2: real screenshots as training samples

const REAL_DATASET = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../services/extractor/eval/dataset/real");

async function seedSamples(): Promise<number> {
  const labelsPath = path.join(REAL_DATASET, "labels.json");
  if (!existsSync(labelsPath)) {
    console.log(`  (no real screenshots at ${REAL_DATASET}; skipping training samples)`);
    return 0;
  }
  const data = JSON.parse(readFileSync(labelsPath, "utf8")) as {
    images: { file: string; kind: "SLOT_LIST" | "RESULTS"; teams?: unknown[]; rows?: unknown[] }[];
  };
  let created = 0;
  for (const img of data.images) {
    const file = path.join(REAL_DATASET, img.file);
    if (!existsSync(file)) continue;
    const buf = readFileSync(file);
    const sha = sha256(buf);
    const info = imageInfo(buf);
    const key = `samples/seed/${img.file}`;
    await saveBuffer(key, buf); // (re)copy so the file is present even if storage was wiped
    if (await prisma.trainingSample.findUnique({ where: { sha256: sha } })) continue;
    const labels = img.kind === "SLOT_LIST" ? { teams: img.teams ?? [] } : { rows: img.rows ?? [] };
    await prisma.trainingSample.create({
      data: {
        kind: img.kind,
        source: "SEED",
        storageKey: key,
        sha256: sha,
        width: info?.width ?? null,
        height: info?.height ?? null,
        labels: labels as Prisma.InputJsonValue,
        split: splitForSha(sha),
        verified: false,
        notes: `Real screenshot ${img.file} (labels need an admin check)`,
      },
    });
    created++;
  }
  return created;
}

// ---------------------------------------------------------------- phase 2: demo results

const ROSTERS: Record<string, string[]> = {
  "Team Soul": ["SouLMortaL", "SouLViper", "SouLRegaltos", "SouLOwais"],
  "GodLike Esports": ["GodLJonathan", "GodLZGOD", "GodLNeyoo", "GodLClutchgod"],
  "Blind Esports": ["BlindManya", "BlindNakul", "BlindRony", "BlindSpraygod"],
  Orangutan: ["OGAshTheBoss", "OGAquaNox", "OGWizzGod", "OGLucifer"],
  "Global Esports": ["GEMavi", "GESlug", "GEHector", "GEBeast"],
  Revenant: ["RNTSensei", "RNTFury", "RNTApollo", "RNTTracegod"],
};

/** Yesterday's "Daily Evening Showdown": 6 approved teams with rosters and 2 published matches. */
async function seedDemoResults(scrim: { id: string; maps: string[] }, managerId: string, teams: { id: string; name: string }[]) {
  const date = addDays(todayInAppTz(), -1);
  const demoTeams = teams.filter((t) => ROSTERS[t.name]);
  await seedRegistrations(
    scrim.id,
    date,
    managerId,
    demoTeams.map((t, i) => ({ teamId: t.id, status: "APPROVED" as const, slot: 3 + i })),
  );
  for (const t of demoTeams) {
    if ((await prisma.teamPlayer.count({ where: { teamId: t.id } })) > 0) continue;
    await prisma.teamPlayer.createMany({ data: ROSTERS[t.name]!.map((ign, i) => ({ teamId: t.id, ign, position: i + 1 })) });
  }
  const session = await prisma.scrimSession.findUniqueOrThrow({ where: { scrimId_date: { scrimId: scrim.id, date: d(date) } } });
  // a demo team may already be registered there in another state (dev DB): approve it on a free slot
  for (const t of demoTeams) {
    const reg = await prisma.registration.findUniqueOrThrow({ where: { sessionId_teamId: { sessionId: session.id, teamId: t.id } } });
    if (reg.status === "APPROVED" && reg.slotNumber != null) continue;
    const taken = new Set(
      (await prisma.registration.findMany({ where: { sessionId: session.id, slotNumber: { not: null } }, select: { slotNumber: true } })).map((r) => r.slotNumber),
    );
    let slot = 3;
    while (taken.has(slot)) slot++;
    await prisma.registration.update({
      where: { id: reg.id },
      data: { status: "APPROVED", slotNumber: slot, decidedAt: new Date(), decidedById: managerId, rejectionReason: null },
    });
  }
  const regs = await prisma.registration.findMany({ where: { sessionId: session.id, status: "APPROVED" } });
  const slotOf = new Map(regs.map((r) => [r.teamId, r.slotNumber!]));
  await prisma.match.createMany({
    data: scrim.maps.map((map, i) => ({ sessionId: session.id, number: i + 1, map })),
    skipDuplicates: true,
  });

  // placement + per-player kills, in demoTeams order
  const results: [number, number[]][][] = [
    [[2, [2, 1, 3, 0]], [1, [4, 3, 2, 2]], [5, [1, 0, 1, 0]], [3, [3, 2, 0, 1]], [6, [0, 0, 1, 0]], [4, [2, 1, 1, 1]]],
    [[1, [3, 4, 2, 1]], [4, [1, 2, 0, 1]], [2, [2, 3, 1, 2]], [6, [0, 1, 0, 0]], [3, [2, 1, 2, 0]], [5, [1, 0, 1, 1]]],
  ];
  for (const [mi, rows] of results.entries()) {
    const match = await prisma.match.findUniqueOrThrow({ where: { sessionId_number: { sessionId: session.id, number: mi + 1 } } });
    if (match.status === "PUBLISHED") continue;
    await prisma.matchTeam.deleteMany({ where: { matchId: match.id } });
    for (const [ti, t] of demoTeams.entries()) {
      const [placement, playerKills] = rows[ti]!;
      const kills = playerKills.reduce((a, b) => a + b, 0);
      const pts = matchPoints(DEFAULT_POINTS_SYSTEM, placement, kills);
      await prisma.matchTeam.create({
        data: {
          matchId: match.id,
          slotNumber: slotOf.get(t.id)!,
          teamId: t.id,
          placement,
          kills,
          ...pts,
          players: { create: ROSTERS[t.name]!.map((name, i) => ({ position: i + 1, name, kills: playerKills[i] ?? 0 })) },
        },
      });
    }
    await prisma.match.update({
      where: { id: match.id },
      data: { status: "PUBLISHED", publishedAt: new Date(`${date}T13:${mi === 0 ? "10" : "45"}:00.000Z`) },
    });
  }
}

async function main() {
  const admin = await seedAdmin();
  const samples = await seedSamples();
  const demo = process.env.SEED_DEMO === "1" || process.env.SEED_DEMO === "true";
  if (demo) await seedDemo();

  console.log("\nSeed complete.\n");
  console.log(`  Admin console : ${admin.username} / ${admin.password}`);
  console.log(`  Training      : ${samples} new real screenshot sample(s) in ${storageRoot()}/samples/seed`);
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
