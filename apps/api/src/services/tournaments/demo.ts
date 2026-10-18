/**
 * Demo tournament generator — for the dev seed (SEED_DEMO=1), tests and simulations. Never called by the API.
 * Builds a published tournament from engine.suggestFormat with one schedule day per stage, and registers the
 * given teams first-come-first-served (CONFIRMED up to maxTeams, then WAITLISTED). Idempotent per (manager, title).
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { DEFAULT_SCHEDULE, addDays, suggestFormat, todayInAppTz, type ScheduleConfig } from "@7xen/shared";

interface DemoTournamentOptions {
  managerId: string;
  /** registered in this order */
  teamIds: string[];
  title?: string;
  maxTeams?: number;
  lobbySize?: number;
  /** first stage starts this many days from today (IST) */
  startInDays?: number;
  prize?: string;
}

export async function createDemoTournament(db: PrismaClient, opts: DemoTournamentOptions): Promise<{ id: string; created: boolean }> {
  const title = opts.title ?? "7xen Demo Cup";
  const existing = await db.tournament.findFirst({ where: { managerId: opts.managerId, title }, select: { id: true } });
  if (existing) return { id: existing.id, created: false };

  const maxTeams = opts.maxTeams ?? Math.max(16, opts.teamIds.length);
  const stages = suggestFormat({ totalTeams: maxTeams, lobbySize: opts.lobbySize ?? 16 });
  const start = addDays(todayInAppTz(), opts.startInDays ?? 2);
  const scheduleFor = (i: number): ScheduleConfig => ({ ...DEFAULT_SCHEDULE, startDate: addDays(start, i * 2), endDate: addDays(start, i * 2 + 1) });

  const t = await db.tournament.create({
    data: {
      managerId: opts.managerId,
      title,
      description: "Demo tournament created by the seed. Register, pick your time slots and climb the stages.",
      rules: "Standard BGMI rules. Be in the lobby 15 minutes before your group's first match.",
      prize: opts.prize ?? "₹25,000",
      status: "REGISTRATION_OPEN",
      maxTeams,
      stages: {
        create: stages.map((s, i) => ({
          order: i + 1,
          name: s.name,
          teamsIn: s.teamsIn,
          lobbySize: s.lobbySize,
          groupCount: s.groupCount,
          matchesPerGroup: s.matchesPerGroup,
          maps: s.maps,
          advancePerGroup: s.advancePerGroup,
          wildcardCount: s.wildcardCount,
          invitedSlots: s.invitedSlots,
          schedule: scheduleFor(i) as unknown as Prisma.InputJsonValue,
        })),
      },
    },
  });
  const base = Date.now() - opts.teamIds.length * 60_000;
  await db.tournamentEntry.createMany({
    data: opts.teamIds.map((teamId, i) => ({
      tournamentId: t.id,
      teamId,
      type: "REGISTERED" as const,
      status: i < maxTeams ? ("CONFIRMED" as const) : ("WAITLISTED" as const),
      entryStage: 1,
      timePreferences: [],
      registeredAt: new Date(base + i * 60_000),
    })),
  });
  return { id: t.id, created: true };
}
