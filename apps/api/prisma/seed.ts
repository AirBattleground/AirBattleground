/**
 * Seeds the admin account from env (ADMIN_USERNAME / ADMIN_PASSWORD / ADMIN_NAME) and the real
 * screenshots in datasets/bgmi-screenshots/real as training samples (source SEED, unverified).
 * With SEED_DEMO=1 also creates demo managers, players (phase 5: dev-login emails player1@7xen.dev…) in teams with
 * leaders, a pending join request, an "ask my leader" suggestion, scrims, registrations, published match results and
 * an open demo tournament (idempotent).
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient, type Prisma, type RegistrationStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DEFAULT_POINTS_SYSTEM, addDays, matchPoints, teamNameKey, todayInAppTz, weekdayOf } from "@7xen/shared";
import { newInviteCode as newInviteCodeForSeed } from "../src/services/players.js";
import { createDemoTournament } from "../src/services/tournaments/demo.js";
import { ensureDefaultRecipes } from "../src/services/recipes.js";
import { imageInfo, saveBuffer, sha256, splitForSha, storageRoot } from "../src/lib/storage.js";

const prisma = new PrismaClient();
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const hash = (p: string) => bcrypt.hash(p, 10);

const MANAGER_PASSWORD = "Manager@123";

/** phase 5: players (sign in locally with dev login: player1@7xen.dev …). The first player of each team leads it. */
const PLAYERS = [
  { n: 1, name: "Mortal", ign: "SouLMortaL", team: "Team Soul" },
  { n: 2, name: "Viper", ign: "SouLViper", team: "Team Soul" },
  { n: 3, name: "Regaltos", ign: "SouLRegaltos", team: "Team Soul" },
  { n: 4, name: "Owais", ign: "SouLOwais", team: "Team Soul" },
  { n: 5, name: "Jonathan", ign: "GodLJonathan", team: "GodLike Esports" },
  { n: 6, name: "ZGOD", ign: "GodLZGOD", team: "GodLike Esports" },
  { n: 7, name: "Neyoo", ign: "GodLNeyoo", team: "GodLike Esports" },
  { n: 8, name: "Manya", ign: "BlindManya", team: "Blind Esports" },
  { n: 9, name: "Nakul", ign: "BlindNakul", team: "Blind Esports" },
  // no team yet: has asked to join Team Soul
  { n: 10, name: "Rookie", ign: "NewKidOnBlock", team: null },
] as const;

const TEAMS = [
  { name: "Team Soul", tag: "SOUL" },
  { name: "GodLike Esports", tag: "GODL" },
  { name: "Blind Esports", tag: "BLND" },
] as const;

const playerEmail = (n: number) => `player${n}@7xen.dev`;

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

async function upsertUser(username: string, password: string, role: "MANAGER", displayName: string) {
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

/** phase 5: players + teams (leader = first player listed for the team) + one pending join request. */
async function seedPlayersAndTeams(): Promise<{ id: string; name: string }[]> {
  const users = new Map<number, string>();
  for (const p of PLAYERS) {
    const email = playerEmail(p.n);
    const bgmiId = String(5_100_000_000 + p.n);
    const u =
      (await prisma.user.findUnique({ where: { email } })) ??
      (await prisma.user.create({ data: { role: "PLAYER", email, displayName: p.name, ign: p.ign, bgmiId } }));
    users.set(p.n, u.id);
  }
  const teams: { id: string; name: string }[] = [];
  for (const t of TEAMS) {
    const roster = PLAYERS.filter((p) => p.team === t.name);
    const leaderId = users.get(roster[0]!.n)!;
    let team = await prisma.team.findUnique({ where: { nameKey: teamNameKey(t.name) } });
    if (!team) {
      team = await prisma.team.create({ data: { name: t.name, nameKey: teamNameKey(t.name), tag: t.tag, leaderId, inviteCode: newInviteCodeForSeed() } });
    }
    for (const [i, p] of roster.entries()) {
      const userId = users.get(p.n)!;
      if (await prisma.teamMember.findUnique({ where: { userId } })) continue;
      await prisma.teamMember.create({ data: { teamId: team.id, userId, role: i === 0 && team.leaderId === userId ? "LEADER" : "MEMBER" } });
    }
    teams.push(team);
  }
  const rookie = users.get(10)!;
  if (!(await prisma.teamMember.findUnique({ where: { userId: rookie } })) && !(await prisma.teamJoinRequest.findFirst({ where: { userId: rookie, status: "PENDING" } }))) {
    await prisma.teamJoinRequest.create({ data: { teamId: teams[0]!.id, userId: rookie, message: "IGL from college tourneys, can play any role" } });
  }
  return teams;
}

async function seedDemo() {
  const today = todayInAppTz();
  const tomorrow = addDays(today, 1);

  const m1 = await upsertUser("manager1", MANAGER_PASSWORD, "MANAGER", "Rahul (Scrim Host)");
  const m2 = await upsertUser("manager2", MANAGER_PASSWORD, "MANAGER", "Night Owl Org");

  const teams = await seedPlayersAndTeams();
  const [soul, godl, blnd] = teams.map((t) => t.id) as [string, string, string];

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
    { teamId: blnd, status: "REJECTED", reason: "Roster not confirmed" },
  ]);
  await seedRegistrations(daily.id, tomorrow, m1.id, [
    { teamId: soul, status: "APPROVED", slot: 3 },
    { teamId: godl, status: "PENDING" },
  ]);
  await seedRegistrations(vr1.id, tomorrow, m1.id, [
    { teamId: blnd, status: "APPROVED", slot: 1 },
    { teamId: soul, status: "PENDING" },
  ]);
  await seedRegistrations(night.id, today, m2.id, [{ teamId: blnd, status: "PENDING" }]);
  await seedRegistrations(night.id, tomorrow, m2.id, [{ teamId: godl, status: "APPROVED", slot: 1 }]);

  // a member of Team Soul asks the leader to register for Night Owl Scrims the day after tomorrow
  const viper = await prisma.user.findUniqueOrThrow({ where: { email: playerEmail(2) } });
  const askDate = addDays(today, 2);
  if (!(await prisma.teamSuggestion.findFirst({ where: { teamId: soul, scrimId: night.id, date: askDate } }))) {
    await prisma.teamSuggestion.create({
      data: { teamId: soul, fromUserId: viper.id, kind: "SCRIM", scrimId: night.id, date: askDate, note: "We need practice on Sanhok" },
    });
  }

  await seedDemoResults(daily, m1.id, teams);
  // phase 3: an open tournament with the demo teams registered (8 of 16 spots taken)
  await createDemoTournament(prisma, { managerId: m1.id, teamIds: teams.map((t) => t.id), maxTeams: 16, lobbySize: 8 });
}

// ---------------------------------------------------------------- phase 2: real screenshots as training samples

const REAL_DATASET = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../datasets/bgmi-screenshots/real");

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

/** Names in the demo results (the ones matching a member's IGN get linked to that player). */
const ROSTERS: Record<string, string[]> = {
  "Team Soul": ["SouLMortaL", "SouLViper", "SouLRegaltos", "SouLOwais"],
  "GodLike Esports": ["GodLJonathan", "GodLZGOD", "GodLNeyoo", "GodLClutchgod"],
  "Blind Esports": ["BlindManya", "BlindNakul", "BlindRony", "BlindSpraygod"],
};

/** Yesterday's "Daily Evening Showdown": 3 approved teams and 2 published matches. */
async function seedDemoResults(scrim: { id: string; maps: string[] }, managerId: string, teams: { id: string; name: string }[]) {
  const date = addDays(todayInAppTz(), -1);
  const demoTeams = teams.filter((t) => ROSTERS[t.name]);
  await seedRegistrations(
    scrim.id,
    date,
    managerId,
    demoTeams.map((t, i) => ({ teamId: t.id, status: "APPROVED" as const, slot: 3 + i })),
  );
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
    [[2, [2, 1, 3, 0]], [1, [4, 3, 2, 2]], [3, [1, 0, 1, 0]]],
    [[1, [3, 4, 2, 1]], [3, [1, 2, 0, 1]], [2, [2, 3, 1, 2]]],
  ];
  const userByIgn = new Map(
    (await prisma.user.findMany({ where: { role: "PLAYER", ign: { not: null } }, select: { id: true, ign: true } })).map((u) => [u.ign!.toLowerCase(), u.id]),
  );
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
          players: {
            create: ROSTERS[t.name]!.map((name, i) => ({ position: i + 1, name, kills: playerKills[i] ?? 0, userId: userByIgn.get(name.toLowerCase()) ?? null })),
          },
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
  const recipes = await ensureDefaultRecipes(prisma);
  const demo = process.env.SEED_DEMO === "1" || process.env.SEED_DEMO === "true";
  if (demo) await seedDemo();

  console.log("\nSeed complete.\n");
  console.log(`  Admin console : ${admin.username} / ${admin.password}`);
  console.log(`  Recipes       : ${recipes} default manager-app recipe(s) created`);
  console.log(`  Training      : ${samples} new real screenshot sample(s) in ${storageRoot()}/samples/seed`);
  if (demo) {
    console.log(`  Managers      : manager1, manager2  /  ${MANAGER_PASSWORD}`);
    console.log(`  Players       : dev login (PLAYER_DEV_LOGIN=1) as ${playerEmail(1)} … ${playerEmail(PLAYERS.length)}`);
    console.log(`                  leaders: ${playerEmail(1)} (Team Soul), ${playerEmail(5)} (GodLike), ${playerEmail(8)} (Blind); ${playerEmail(10)} has no team`);
  } else {
    console.log("  (Set SEED_DEMO=1 to also create demo managers, players, teams and scrims.)");
  }
  console.log("");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
