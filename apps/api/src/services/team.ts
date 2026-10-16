import {
  todayInAppTz,
  type TeamDashboard,
  type TeamRegistration,
  type TeamScrimOnDate,
} from "@7xen/shared";
import { prisma } from "../db.js";
import { notFound } from "../lib/errors.js";
import { scrimInclude, strToDate } from "../lib/serialize.js";
import { teamResultsSummary } from "./teamResults.js";
import { teamRegistrationInclude, toTeamRegistration } from "./registrations.js";
import { buildScrimOnDate, countsByScrim, mayOccurOnWhere, scrimOccursOn } from "./schedule.js";

/** ACTIVE scrims of all (active) managers running on `date`, with this team's registration. */
export async function teamScrimsForDate(teamId: string, date: string, now = new Date()): Promise<TeamScrimOnDate[]> {
  const candidates = await prisma.scrim.findMany({
    where: { status: "ACTIVE", manager: { isActive: true }, ...mayOccurOnWhere(date) },
    include: scrimInclude,
  });
  const scrims = candidates.filter((s) => scrimOccursOn(s, date)).sort((a, b) => a.startTime.localeCompare(b.startTime));
  const ids = scrims.map((s) => s.id);
  const [counts, mine] = await Promise.all([
    countsByScrim(ids, date),
    prisma.registration.findMany({
      where: { teamId, session: { scrimId: { in: ids }, date: strToDate(date) } },
      select: { id: true, status: true, slotNumber: true, rejectionReason: true, session: { select: { scrimId: true } } },
    }),
  ]);
  const mineByScrim = new Map(mine.map((r) => [r.session.scrimId, r]));
  return scrims.map((s) => {
    const r = mineByScrim.get(s.id);
    return {
      ...buildScrimOnDate(s, date, counts.get(s.id), now),
      myRegistration: r ? { id: r.id, status: r.status, slotNumber: r.slotNumber, rejectionReason: r.rejectionReason } : null,
    };
  });
}

/** Non-cancelled registrations whose session hasn't started, soonest first. */
async function upcomingRegistrations(teamId: string, now: Date): Promise<TeamRegistration[]> {
  const rows = await prisma.registration.findMany({
    where: { teamId, status: { not: "CANCELLED" }, session: { date: { gte: strToDate(todayInAppTz(now)) } } },
    include: teamRegistrationInclude,
  });
  return rows
    .map(toTeamRegistration)
    .filter((r) => new Date(r.startsAt) >= now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** Non-cancelled registrations whose session has started, newest first (max 100). */
async function pastRegistrations(teamId: string, now: Date, limit = 100): Promise<TeamRegistration[]> {
  const rows = await prisma.registration.findMany({
    where: { teamId, status: { not: "CANCELLED" }, session: { date: { lte: strToDate(todayInAppTz(now)) } } },
    include: teamRegistrationInclude,
    orderBy: { session: { date: "desc" } },
    take: limit + 50, // today's not-yet-started sessions get filtered out below
  });
  return rows
    .map(toTeamRegistration)
    .filter((r) => new Date(r.startsAt) < now)
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    .slice(0, limit);
}

export function teamRegistrations(teamId: string, scope: "upcoming" | "past", now = new Date()) {
  return scope === "upcoming" ? upcomingRegistrations(teamId, now) : pastRegistrations(teamId, now);
}

export async function teamDashboard(teamId: string, now = new Date()): Promise<TeamDashboard> {
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) throw notFound("Team not found");
  const today = todayInAppTz(now);
  const [upcoming, playedBeforeToday, todayApproved, results] = await Promise.all([
    upcomingRegistrations(teamId, now),
    prisma.registration.count({ where: { teamId, status: "APPROVED", session: { date: { lt: strToDate(today) } } } }),
    prisma.registration.findMany({
      where: { teamId, status: "APPROVED", session: { date: strToDate(today) } },
      include: teamRegistrationInclude,
    }),
    teamResultsSummary(teamId),
  ]);
  const playedToday = todayApproved.map(toTeamRegistration).filter((r) => new Date(r.startsAt) < now).length;
  return {
    team: { id: team.id, name: team.name, tag: team.tag, captainName: team.captainName },
    today,
    nextMatch: upcoming.find((r) => r.status === "APPROVED") ?? null,
    upcoming: upcoming.slice(0, 5),
    counts: {
      approvedUpcoming: upcoming.filter((r) => r.status === "APPROVED").length,
      pending: upcoming.filter((r) => r.status === "PENDING").length,
      totalPlayed: playedBeforeToday + playedToday,
    },
    results,
  };
}
