import type { Prisma } from "@prisma/client";
import {
  addMinutesToTime,
  matchStartsAt,
  matchTimesIssue,
  MAX_ROOM_SLOTS,
  scrimMatchPlan,
  slotRange,
  todayInAppTz,
  type CreateScrimInput,
  type ManagerDashboard,
  type PendingRequest,
  type Registration,
  type Scrim,
  type ScrimOnDate,
  type SessionDetail,
  type UpdateScrimInput,
} from "@7xen/shared";
import { prisma } from "../db.js";
import { AppError, conflict, notFound } from "../lib/errors.js";
import {
  dateToStr,
  pointsSystemOf,
  registrationInclude,
  scrimInclude,
  strToDate,
  toRegistration,
  toScrim,
  toTeamSummary,
} from "../lib/serialize.js";
import { recomputeScrimPoints } from "./standings.js";
import {
  approvedBySession,
  buildScrimOnDate,
  countUpcomingRegistrations,
  countsByScrim,
  mayOccurOnWhere,
  scrimOccursOn,
  startsAtOf,
  tally,
} from "./schedule.js";

const SCRIM_NOT_FOUND = "Scrim not found";

export async function loadOwnScrim(scrimId: string, managerId: string) {
  const scrim = await prisma.scrim.findUnique({ where: { id: scrimId }, include: scrimInclude });
  if (!scrim || scrim.managerId !== managerId) throw notFound(SCRIM_NOT_FOUND);
  return scrim;
}

export async function listScrims(managerId: string): Promise<Scrim[]> {
  const rows = await prisma.scrim.findMany({
    where: { managerId },
    include: scrimInclude,
    orderBy: [{ createdAt: "desc" }],
  });
  // active first, then paused, then archived
  const rank = { ACTIVE: 0, PAUSED: 1, ARCHIVED: 2 } as const;
  return rows.sort((a, b) => rank[a.status] - rank[b.status]).map(toScrim);
}

export async function getScrim(scrimId: string, managerId: string): Promise<Scrim> {
  return toScrim(await loadOwnScrim(scrimId, managerId));
}

export async function createScrim(managerId: string, input: CreateScrimInput): Promise<Scrim> {
  const scrim = await prisma.scrim.create({
    data: {
      managerId,
      title: input.title,
      description: input.description ?? null,
      maps: input.maps,
      startTime: input.matchTimes?.[0] ?? input.startTime,
      matchTimes: input.matchTimes ?? [],
      idpMinutes: input.idpMinutes ?? [],
      registrationCloseMinutes: input.registrationCloseMinutes,
      published: input.published,
      recurrence: input.recurrence,
      startDate: strToDate(input.startDate),
      endDate: input.recurrence === "ONCE" || !input.endDate ? null : strToDate(input.endDate),
      slotCount: input.slotCount,
      firstSlot: input.firstSlot,
      winCoins: input.winCoins,
    },
    include: scrimInclude,
  });
  return toScrim(scrim);
}

export async function updateScrim(scrimId: string, managerId: string, input: UpdateScrimInput): Promise<Scrim> {
  const current = await loadOwnScrim(scrimId, managerId);

  const recurrence = input.recurrence ?? current.recurrence;
  const startDate = input.startDate ?? dateToStr(current.startDate);
  let endDate: string | null =
    input.endDate !== undefined ? input.endDate : current.endDate ? dateToStr(current.endDate) : null;
  if (recurrence === "ONCE") endDate = null;
  const slotCount = input.slotCount ?? current.slotCount;
  const firstSlot = input.firstSlot ?? current.firstSlot;
  const plan = mergePlan(current, input);

  const fields: Record<string, string> = {};
  if (firstSlot + slotCount - 1 > MAX_ROOM_SLOTS) fields.slotCount = `Slots would go past #${MAX_ROOM_SLOTS}`;
  if (endDate && endDate < startDate) fields.endDate = "End date is before start date";
  if (plan.matchTimes.length && plan.matchTimes.length !== plan.maps.length) fields.matchTimes = "Give every match a start time";
  else if (plan.matchTimes.length) {
    const issue = matchTimesIssue(plan.matchTimes);
    if (issue) fields[`matchTimes.${issue.index}`] = issue.message;
  }
  if (plan.idpMinutes.length && plan.idpMinutes.length !== plan.maps.length) fields.idpMinutes = "Give every match an IDP time";
  if (Object.keys(fields).length) throw new AppError("VALIDATION_ERROR", "Please check the highlighted fields", fields);

  // Matches that were played (or are being played) today or later can't be dropped from the plan.
  if (plan.maps.length < current.maps.length) {
    const played = await prisma.match.findFirst({
      where: {
        number: { gt: plan.maps.length },
        session: { scrimId, date: { gte: strToDate(todayInAppTz()) } },
        OR: [{ status: { not: "SCHEDULED" } }, { screenshots: { some: {} } }, { teams: { some: {} } }],
      },
      select: { number: true, session: { select: { date: true } } },
      orderBy: { session: { date: "asc" } },
    });
    if (played) {
      throw conflict(`Match ${played.number} on ${dateToStr(played.session!.date)} has already started or has results, so it can't be removed.`);
    }
  }

  // Don't strand teams already holding a slot that would fall outside the new range.
  if (slotCount !== current.slotCount || firstSlot !== current.firstSlot) {
    const lastSlot = firstSlot + slotCount - 1;
    const now = new Date();
    const orphans = await prisma.registration.findMany({
      where: {
        status: "APPROVED",
        session: { scrimId, date: { gte: strToDate(todayInAppTz(now)) } },
        OR: [{ slotNumber: { lt: firstSlot } }, { slotNumber: { gt: lastSlot } }],
      },
      select: { slotNumber: true, team: { select: { name: true } }, session: { select: { date: true } } },
      orderBy: [{ session: { date: "asc" } }, { slotNumber: "asc" }],
    });
    const upcoming = orphans.filter((o) => now < startsAtOf(dateToStr(o.session.date), current.startTime));
    const first = upcoming[0];
    if (first) {
      const more = upcoming.length > 1 ? ` (and ${upcoming.length - 1} more)` : "";
      throw conflict(
        `${first.team.name} already has slot #${first.slotNumber} on ${dateToStr(first.session.date)}${more}. ` +
          `Reject that team first, or keep that slot in the range.`,
      );
    }
  }

  const data: Prisma.ScrimUpdateInput = {
    recurrence,
    startDate: strToDate(startDate),
    endDate: endDate ? strToDate(endDate) : null,
    slotCount,
    firstSlot,
  };
  if (input.title !== undefined) data.title = input.title;
  if ("description" in input) data.description = input.description ?? null;
  data.maps = plan.maps;
  data.startTime = plan.startTime;
  data.matchTimes = plan.matchTimes;
  data.idpMinutes = plan.idpMinutes;
  if (input.registrationCloseMinutes !== undefined) data.registrationCloseMinutes = input.registrationCloseMinutes;
  if (input.published !== undefined) data.published = input.published;
  if (input.status !== undefined) data.status = input.status;
  if (input.pointsSystem !== undefined) data.pointsSystem = input.pointsSystem;
  if (input.winCoins !== undefined) data.winCoins = input.winCoins;

  const updated = await prisma.scrim.update({ where: { id: scrimId }, data, include: scrimInclude });
  if (input.pointsSystem !== undefined) await recomputeScrimPoints(scrimId, pointsSystemOf(updated.pointsSystem));
  await moveRoomReveals(scrimId, current, updated);
  return toScrim(updated);
}

type Plan = { maps: string[]; startTime: string; matchTimes: string[]; idpMinutes: number[] };

/**
 * The scrim's match plan after a (partial) update. Times/IDPs that no longer line up with the maps are dropped; a new
 * startTime without matchTimes moves every match by the same amount.
 */
function mergePlan(current: Plan, input: UpdateScrimInput): Plan {
  const maps = input.maps ?? current.maps;
  const fits = <T>(xs: T[]) => (xs.length === maps.length ? xs : []);
  let matchTimes = input.matchTimes ?? fits(current.matchTimes);
  if (!input.matchTimes && input.startTime && matchTimes.length && input.startTime !== current.startTime) {
    const [h0 = 0, m0 = 0] = current.startTime.split(":").map(Number);
    const [h1 = 0, m1 = 0] = input.startTime.split(":").map(Number);
    matchTimes = matchTimes.map((t) => addMinutesToTime(t, h1 * 60 + m1 - (h0 * 60 + m0)));
  }
  return {
    maps,
    startTime: matchTimes[0] ?? input.startTime ?? current.startTime,
    matchTimes,
    idpMinutes: input.idpMinutes ?? fits(current.idpMinutes),
  };
}

/**
 * Rooms already saved for matches that haven't started keep their IDP in step with the new plan: a reveal that sat on
 * the old IDP moves to the new one, any other reveal moves by however much the match moved.
 */
async function moveRoomReveals(scrimId: string, before: Plan, after: Plan, now = new Date()) {
  const key = (p: Plan) => [p.startTime, p.matchTimes.join(), p.idpMinutes.join(), p.maps.length].join("|");
  if (key(before) === key(after)) return;
  const rows = await prisma.match.findMany({
    where: { status: "SCHEDULED", roomRevealAt: { not: null }, session: { scrimId, date: { gte: strToDate(todayInAppTz(now)) } } },
    select: { id: true, number: true, roomRevealAt: true, session: { select: { date: true } } },
  });
  const oldPlan = scrimMatchPlan(before);
  const newPlan = scrimMatchPlan(after);
  for (const m of rows) {
    const date = dateToStr(m.session!.date);
    const was = matchStartsAt(before, date, m.number);
    const will = matchStartsAt(after, date, m.number);
    const newIdp = newPlan[m.number - 1]?.idpMinutes;
    if (!was || !will || newIdp == null) continue;
    const reveal = m.roomRevealAt!.getTime();
    const onIdp = reveal === was.getTime() - (oldPlan[m.number - 1]?.idpMinutes ?? 0) * 60_000;
    const revealAt = onIdp ? will.getTime() - newIdp * 60_000 : reveal + will.getTime() - was.getTime();
    if (revealAt !== reveal) await prisma.match.update({ where: { id: m.id }, data: { roomRevealAt: new Date(revealAt) } });
  }
}

/** Own non-archived scrims running on `date`, with live counts, by start time. */
export async function scheduleForDate(managerId: string, date: string, now = new Date()): Promise<ScrimOnDate[]> {
  const candidates = await prisma.scrim.findMany({
    where: { managerId, status: { not: "ARCHIVED" }, ...mayOccurOnWhere(date) },
    include: scrimInclude,
  });
  const scrims = candidates.filter((s) => scrimOccursOn(s, date)).sort((a, b) => a.startTime.localeCompare(b.startTime));
  const counts = await countsByScrim(
    scrims.map((s) => s.id),
    date,
  );
  return scrims.map((s) => buildScrimOnDate(s, date, counts.get(s.id), now));
}

const STATUS_ORDER = { PENDING: 0, APPROVED: 1, REJECTED: 2, CANCELLED: 3 } as const;

function sortRegistrations(regs: Registration[]): Registration[] {
  return [...regs].sort((a, b) => {
    const d = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (d !== 0) return d;
    if (a.status === "APPROVED") return (a.slotNumber ?? 0) - (b.slotNumber ?? 0);
    if (a.status === "PENDING") return a.createdAt.localeCompare(b.createdAt);
    return (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt);
  });
}

export async function sessionDetail(scrimId: string, managerId: string, date: string, now = new Date()): Promise<SessionDetail> {
  const scrim = await loadOwnScrim(scrimId, managerId);
  const session = await prisma.scrimSession.findUnique({
    where: { scrimId_date: { scrimId, date: strToDate(date) } },
    include: { registrations: { include: registrationInclude } },
  });
  if (!scrimOccursOn(scrim, date) && !session) throw notFound("This scrim doesn't run on that date");

  const regs = session?.registrations ?? [];
  const base = buildScrimOnDate(scrim, date, tally(regs), now);
  const bySlot = new Map<number, (typeof regs)[number]>();
  for (const r of regs) if (r.status === "APPROVED" && r.slotNumber != null) bySlot.set(r.slotNumber, r);

  return {
    ...base,
    registrations: sortRegistrations(regs.map(toRegistration)),
    slots: slotRange(scrim.firstSlot, scrim.slotCount).map((n) => {
      const r = bySlot.get(n);
      return { slotNumber: n, team: r ? toTeamSummary(r.team) : null, registrationId: r?.id ?? null };
    }),
  };
}

/** All PENDING registrations for this manager's sessions that haven't started, soonest first. */
export async function pendingRequests(managerId: string, now = new Date()): Promise<PendingRequest[]> {
  const today = todayInAppTz(now);
  const rows = await prisma.registration.findMany({
    where: {
      status: "PENDING",
      session: { date: { gte: strToDate(today) }, scrim: { managerId } },
    },
    include: {
      ...registrationInclude,
      session: {
        select: {
          id: true,
          date: true,
          scrim: { select: { id: true, title: true, startTime: true, slotCount: true } },
        },
      },
    },
  });
  const items = rows
    .map((r) => {
      const date = dateToStr(r.session.date);
      return { r, date, startsAt: startsAtOf(date, r.session.scrim.startTime) };
    })
    .filter((x) => now < x.startsAt)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.r.createdAt.getTime() - b.r.createdAt.getTime());

  const approved = await approvedBySession([...new Set(items.map((x) => x.r.session.id))]);
  return items.map(({ r, date, startsAt }) => {
    const a = approved.get(r.session.id) ?? 0;
    return {
      registration: toRegistration(r),
      scrim: r.session.scrim,
      date,
      startsAt: startsAt.toISOString(),
      counts: { approved: a, slotsLeft: Math.max(0, r.session.scrim.slotCount - a) },
    };
  });
}

export async function managerDashboard(managerId: string, now = new Date()): Promise<ManagerDashboard> {
  const today = todayInAppTz(now);
  const [todaySessions, pending, activeScrims, upcomingApproved] = await Promise.all([
    scheduleForDate(managerId, today, now),
    pendingRequests(managerId, now),
    prisma.scrim.count({ where: { managerId, status: "ACTIVE" } }),
    countUpcomingRegistrations({ status: "APPROVED", session: { scrim: { managerId } } }, now),
  ]);
  return { today, todaySessions, pendingCount: pending.length, activeScrims, upcomingApproved };
}
