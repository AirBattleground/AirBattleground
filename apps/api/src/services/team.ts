import {
  addDays,
  todayInAppTz,
  type GameMap,
  type TeamRole,
  type TeamDashboard,
  type TeamRegistration,
  type TeamScrimDetail,
  type TeamScrimOnDate,
} from "@7xen/shared";
import { prisma } from "../db.js";
import { notFound } from "../lib/errors.js";
import { captainNameOf, iso, scrimInclude, strToDate, toTeamSummary } from "../lib/serialize.js";
import { roomRevealed } from "./live.js";
import { openScrimSuggestions } from "./suggestions.js";
import { teamResultsSummary } from "./teamResults.js";
import { teamRegistrationInclude, toTeamRegistration } from "./registrations.js";
import { buildScrimOnDate, countsByScrim, mayOccurOnWhere, scrimOccursOn, startsAtOf, tally } from "./schedule.js";

/** ACTIVE scrims of all (active) managers running on `date`, with this team's registration (teamId null = no team: none). */
export async function teamScrimsForDate(teamId: string | null, date: string, now = new Date()): Promise<TeamScrimOnDate[]> {
  const candidates = await prisma.scrim.findMany({
    where: { status: "ACTIVE", manager: { isActive: true }, ...mayOccurOnWhere(date) },
    include: scrimInclude,
  });
  const scrims = candidates.filter((s) => scrimOccursOn(s, date)).sort((a, b) => a.startTime.localeCompare(b.startTime));
  const ids = scrims.map((s) => s.id);
  const [counts, mine, suggested] = await Promise.all([
    countsByScrim(ids, date),
    teamId
      ? prisma.registration.findMany({
          where: { teamId, session: { scrimId: { in: ids }, date: strToDate(date) } },
          select: { id: true, status: true, slotNumber: true, rejectionReason: true, session: { select: { scrimId: true } } },
        })
      : [],
    teamId ? openScrimSuggestions(teamId, ids, date) : new Map<string, { id: string; fromIgn: string | null }>(),
  ]);
  const mineByScrim = new Map(mine.map((r) => [r.session.scrimId, r]));
  return scrims.map((s) => {
    const r = mineByScrim.get(s.id);
    return {
      ...buildScrimOnDate(s, date, counts.get(s.id), now),
      myRegistration: r ? { id: r.id, status: r.status, slotNumber: r.slotNumber, rejectionReason: r.rejectionReason } : null,
      mySuggestion: suggested.get(s.id) ?? null,
    };
  });
}

/**
 * Scrim detail (player view): one scrim on one date — the list card's data plus the night's matches (with my team's
 * rooms once approved + revealed), the lobby by slot, the next dates it runs and how many matches are published.
 * No date → its next date that hasn't started. A scrim that's no longer active only answers for dates that had a session.
 */
export async function teamScrimDetail(teamId: string | null, scrimId: string, date: string | undefined, now = new Date()): Promise<TeamScrimDetail> {
  const s = await prisma.scrim.findFirst({ where: { id: scrimId, manager: { isActive: true } }, include: scrimInclude });
  if (!s) throw notFound("This scrim isn't available any more");
  const today = todayInAppTz(now);
  const dates: string[] = [];
  if (s.status === "ACTIVE") {
    for (let i = 0; i < 90 && dates.length < 7; i++) {
      const d = addDays(today, i);
      if (scrimOccursOn(s, d) && (i > 0 || startsAtOf(d, s.startTime) > now)) dates.push(d);
    }
  }
  const day = date ?? dates[0];
  if (!day) throw notFound("This scrim has no more dates");
  if (!scrimOccursOn(s, day)) throw notFound("This scrim doesn't run on that day");

  const session = await prisma.scrimSession.findUnique({
    where: { scrimId_date: { scrimId, date: strToDate(day) } },
    include: {
      registrations: { select: { id: true, teamId: true, status: true, slotNumber: true, rejectionReason: true, team: { select: { id: true, name: true, tag: true } } } },
      matches: { orderBy: { number: "asc" } },
    },
  });
  if (s.status !== "ACTIVE" && !session) throw notFound("This scrim isn't available any more");

  const regs = session?.registrations ?? [];
  const mine = teamId ? regs.find((r) => r.teamId === teamId) : undefined;
  const approved = mine?.status === "APPROVED";
  const start = startsAtOf(day, s.startTime);
  const rows = session?.matches.length ? session.matches : null;
  const matches: TeamScrimDetail["matches"] = rows
    ? rows.map((m) => {
        const published = m.status === "PUBLISHED";
        const shown = approved && !published && roomRevealed(m, now) && m.roomPassword != null;
        return {
          number: m.number,
          map: m.map as GameMap,
          startsAt: iso(m.scheduledAt ?? (m.number === 1 ? start : null)),
          published,
          room: shown ? { roomId: m.roomId!, password: m.roomPassword! } : null,
          revealAt: approved && !published && !shown && m.roomId ? iso(m.roomRevealAt) : null,
        };
      })
    : (s.maps as GameMap[]).map((map, i) => ({ number: i + 1, map, startsAt: i === 0 ? start.toISOString() : null, published: false, room: null, revealAt: null }));

  const suggested = teamId ? await openScrimSuggestions(teamId, [s.id], day) : new Map<string, { id: string; fromIgn: string | null }>();
  return {
    ...buildScrimOnDate(s, day, tally(regs), now),
    myRegistration: mine ? { id: mine.id, status: mine.status, slotNumber: mine.slotNumber, rejectionReason: mine.rejectionReason } : null,
    mySuggestion: suggested.get(s.id) ?? null,
    matches,
    lobby: regs
      .filter((r) => r.status === "APPROVED" && r.slotNumber != null)
      .sort((a, b) => a.slotNumber! - b.slotNumber!)
      .map((r) => ({ slotNumber: r.slotNumber!, team: toTeamSummary(r.team) })),
    dates,
    publishedMatches: matches.filter((m) => m.published).length,
  };
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

export async function teamDashboard(teamId: string, myTeamRole: TeamRole = "MEMBER", now = new Date()): Promise<TeamDashboard> {
  const team = await prisma.team.findUnique({ where: { id: teamId }, include: { leader: { select: { ign: true, displayName: true } } } });
  if (!team) throw notFound("Team not found");
  const today = todayInAppTz(now);
  const [upcoming, playedBeforeToday, todayApproved, results, openSuggestions] = await Promise.all([
    upcomingRegistrations(teamId, now),
    prisma.registration.count({ where: { teamId, status: "APPROVED", session: { date: { lt: strToDate(today) } } } }),
    prisma.registration.findMany({
      where: { teamId, status: "APPROVED", session: { date: strToDate(today) } },
      include: teamRegistrationInclude,
    }),
    teamResultsSummary(teamId),
    prisma.teamSuggestion.count({ where: { teamId, status: "OPEN" } }),
  ]);
  const playedToday = todayApproved.map(toTeamRegistration).filter((r) => new Date(r.startsAt) < now).length;
  return {
    team: { id: team.id, name: team.name, tag: team.tag, captainName: captainNameOf(team) },
    today,
    nextMatch: upcoming.find((r) => r.status === "APPROVED") ?? null,
    upcoming: upcoming.slice(0, 5),
    counts: {
      approvedUpcoming: upcoming.filter((r) => r.status === "APPROVED").length,
      pending: upcoming.filter((r) => r.status === "PENDING").length,
      totalPlayed: playedBeforeToday + playedToday,
    },
    results,
    myTeamRole,
    openSuggestions,
  };
}
