import type { Prisma, RegistrationStatus } from "@prisma/client";
import { occursOn, sessionStartsAt, todayInAppTz, type ScrimOnDate } from "@7xen/shared";
import { prisma } from "../db.js";
import { dateToStr, strToDate, toScrim, type ScrimWithManager } from "../lib/serialize.js";

export interface SessionCounts {
  pending: number;
  approved: number;
}
const ZERO: SessionCounts = { pending: 0, approved: 0 };

export const startsAtOf = (date: string, startTime: string): Date => sessionStartsAt(date, startTime);

export function scheduleOf(s: { recurrence: ScrimWithManager["recurrence"]; startDate: Date; endDate: Date | null }) {
  return { recurrence: s.recurrence, startDate: dateToStr(s.startDate), endDate: s.endDate ? dateToStr(s.endDate) : null };
}

export const scrimOccursOn = (s: ScrimWithManager, date: string) => occursOn(scheduleOf(s), date);

/** Coarse DB filter for scrims that *may* occur on `date`; refine with scrimOccursOn(). */
export function mayOccurOnWhere(date: string): Prisma.ScrimWhereInput {
  const d = strToDate(date);
  return { startDate: { lte: d }, OR: [{ endDate: null }, { endDate: { gte: d } }] };
}

/** Registration counts per scrim for sessions on `date`. */
export async function countsByScrim(scrimIds: string[], date: string): Promise<Map<string, SessionCounts>> {
  const map = new Map<string, SessionCounts>();
  if (scrimIds.length === 0) return map;
  const sessions = await prisma.scrimSession.findMany({
    where: { scrimId: { in: scrimIds }, date: strToDate(date) },
    select: { scrimId: true, registrations: { select: { status: true } } },
  });
  for (const s of sessions) map.set(s.scrimId, tally(s.registrations));
  return map;
}

export function tally(regs: { status: RegistrationStatus }[]): SessionCounts {
  let pending = 0;
  let approved = 0;
  for (const r of regs) {
    if (r.status === "PENDING") pending++;
    else if (r.status === "APPROVED") approved++;
  }
  return { pending, approved };
}

/** Approved counts per session id. */
export async function approvedBySession(sessionIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (sessionIds.length === 0) return map;
  const rows = await prisma.registration.groupBy({
    by: ["sessionId"],
    where: { sessionId: { in: sessionIds }, status: "APPROVED" },
    _count: { _all: true },
  });
  for (const r of rows) map.set(r.sessionId, r._count._all);
  return map;
}

export function buildScrimOnDate(
  scrim: ScrimWithManager,
  date: string,
  counts: SessionCounts = ZERO,
  now: Date = new Date(),
): ScrimOnDate {
  const startsAt = startsAtOf(date, scrim.startTime);
  return {
    scrim: toScrim(scrim),
    date,
    startsAt: startsAt.toISOString(),
    registrationOpen: scrim.status === "ACTIVE" && now < startsAt,
    counts: {
      pending: counts.pending,
      approved: counts.approved,
      slotsLeft: Math.max(0, scrim.slotCount - counts.approved),
    },
  };
}

/**
 * Count registrations matching `where` whose session hasn't started yet.
 * Sessions after today are counted in SQL; today's are checked against their start time.
 */
export async function countUpcomingRegistrations(where: Prisma.RegistrationWhereInput, now = new Date()) {
  const today = todayInAppTz(now);
  const [later, todays] = await Promise.all([
    prisma.registration.count({ where: { AND: [where, { session: { date: { gt: strToDate(today) } } }] } }),
    prisma.registration.findMany({
      where: { AND: [where, { session: { date: strToDate(today) } }] },
      select: { session: { select: { scrim: { select: { startTime: true } } } } },
    }),
  ]);
  return later + todays.filter((r) => now < startsAtOf(today, r.session.scrim.startTime)).length;
}
