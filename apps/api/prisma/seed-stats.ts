/**
 * Demo data for the player statistics report: a past daily scrim ("Stats Demo Practice", manager1) with 2 published
 * matches a day for the last 25 days, played by the seeded demo teams — so player1@7xen.dev (SouLMortaL) and the
 * other demo players have ~50 matches of real results. Run `pnpm db:seed` first (it creates the teams + manager1).
 *
 *   pnpm db:seed:stats            create (idempotent: skips days already published)
 *   pnpm db:seed:stats --remove   delete the demo scrim and everything under it
 */
import { PrismaClient } from "@prisma/client";
import { DEFAULT_POINTS_SYSTEM, addDays, matchPoints, todayInAppTz } from "@7xen/shared";

const prisma = new PrismaClient();
const TITLE = "Stats Demo Practice";
const DAYS = 25;
const MAPS = ["ERANGEL", "MIRAMAR", "SANHOK", "VIKENDI"];
const TEAMS = ["Team Soul", "GodLike Esports", "Blind Esports"];
/** IST 18:00 and 18:45 → UTC */
const MATCH_TIMES_UTC = ["12:30", "13:15"];
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** Small seeded RNG so every run makes the same "season". */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function remove() {
  const scrims = await prisma.scrim.findMany({ where: { title: TITLE }, select: { id: true } });
  await prisma.scrim.deleteMany({ where: { id: { in: scrims.map((s) => s.id) } } });
  console.log(`Removed ${scrims.length} demo scrim(s) and their sessions, matches and results.`);
}

async function main() {
  if (process.argv.includes("--remove")) return remove();

  const manager = await prisma.user.findFirst({ where: { username: "manager1" } });
  const teams = await prisma.team.findMany({
    where: { name: { in: TEAMS } },
    include: { members: { include: { user: { select: { id: true, ign: true, displayName: true } } }, orderBy: { joinedAt: "asc" } } },
  });
  if (!manager || teams.length === 0) throw new Error("Run `pnpm db:seed` first (needs manager1 and the demo teams).");
  teams.sort((a, b) => TEAMS.indexOf(a.name) - TEAMS.indexOf(b.name));

  const today = todayInAppTz();
  const first = addDays(today, -DAYS);
  const last = addDays(today, -1);
  const scrim =
    (await prisma.scrim.findFirst({ where: { managerId: manager.id, title: TITLE } })) ??
    (await prisma.scrim.create({
      data: {
        managerId: manager.id,
        title: TITLE,
        description: "Demo results for the player statistics report (prisma/seed-stats.ts).",
        maps: MAPS.slice(0, MATCH_TIMES_UTC.length),
        startTime: "18:00",
        recurrence: "DAILY",
        startDate: d(first),
        endDate: d(last),
        slotCount: 16,
        firstSlot: 1,
      },
    }));

  const rand = rng(7);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
  let created = 0;
  for (let day = 0; day < DAYS; day++) {
    const date = addDays(first, day);
    const session = await prisma.scrimSession.upsert({ where: { scrimId_date: { scrimId: scrim.id, date: d(date) } }, create: { scrimId: scrim.id, date: d(date) }, update: {} });
    for (const [i, t] of teams.entries()) {
      await prisma.registration.upsert({
        where: { sessionId_teamId: { sessionId: session.id, teamId: t.id } },
        create: { sessionId: session.id, teamId: t.id, status: "APPROVED", slotNumber: 3 + i, decidedAt: d(date), decidedById: manager.id },
        update: {},
      });
    }
    for (const [mi, time] of MATCH_TIMES_UTC.entries()) {
      const number = mi + 1;
      const map = MAPS[(day * MATCH_TIMES_UTC.length + mi) % MAPS.length]!;
      const scheduledAt = new Date(`${date}T${time}:00.000Z`);
      const match =
        (await prisma.match.findUnique({ where: { sessionId_number: { sessionId: session.id, number } } })) ??
        (await prisma.match.create({ data: { sessionId: session.id, number, map, scheduledAt } }));
      // keep the RNG sequence the same whether or not this match already exists
      const placements = new Set<number>();
      const plan = teams.map((t, ti) => {
        // Team Soul is the strong side of this demo; the others are mid-table
        let p: number;
        do p = ti === 0 ? pick([1, 1, 2, 2, 3, 4, 4, 5, 6, 8, 10, 13]) : 1 + Math.floor(rand() * 16);
        while (placements.has(p));
        placements.add(p);
        const base = ti === 0 ? 10 : 7;
        const teamKills = Math.max(0, Math.round((base - p * 0.45) * (0.6 + rand() * 0.8)));
        const weights = t.members.map((_, i) => (i === 0 ? 1.35 : 1 - i * 0.1) * (0.5 + rand()));
        const sum = weights.reduce((a, b) => a + b, 0) || 1;
        const kills = weights.map((w) => Math.floor((w / sum) * teamKills));
        // hand the rounding leftovers out one each, biggest share first
        const order = weights.map((w, i) => [w, i] as const).sort((a, b) => b[0] - a[0]);
        for (let left = teamKills - kills.reduce((a, b) => a + b, 0), k = 0; left > 0; left--, k++) kills[order[k % order.length]![1]]! += 1;
        return { t, slot: 3 + ti, placement: p, teamKills, kills };
      });
      if (match.status === "PUBLISHED") continue;
      await prisma.matchTeam.deleteMany({ where: { matchId: match.id } });
      for (const r of plan) {
        await prisma.matchTeam.create({
          data: {
            matchId: match.id,
            slotNumber: r.slot,
            teamId: r.t.id,
            placement: r.placement,
            kills: r.teamKills,
            ...matchPoints(DEFAULT_POINTS_SYSTEM, r.placement, r.teamKills),
            players: {
              create: r.t.members.map((m, i) => ({ position: i + 1, name: m.user.ign ?? m.user.displayName, kills: r.kills[i] ?? 0, userId: m.user.id })),
            },
          },
        });
      }
      await prisma.match.update({ where: { id: match.id }, data: { status: "PUBLISHED", scheduledAt, publishedAt: new Date(scheduledAt.getTime() + 40 * 60_000) } });
      created++;
    }
  }
  console.log(`Stats demo: ${created} match(es) published in "${TITLE}" (${first} → ${last}) for ${teams.map((t) => t.name).join(", ")}.`);
  console.log("  See it: dev login as player1@7xen.dev → Profile.  Remove: pnpm db:seed:stats --remove");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
