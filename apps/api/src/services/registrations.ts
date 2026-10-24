import { Prisma } from "@prisma/client";
import { matchStartsAt, slotRange, type Registration, type TeamRegistration } from "@7xen/shared";
import { prisma } from "../db.js";
import { AppError, conflict, notFound } from "../lib/errors.js";
import {
  dateToStr,
  iso,
  registrationInclude,
  organizerSelect,
  scrimInclude,
  strToDate,
  toRegistration,
  toScrim,
} from "../lib/serialize.js";
import { closesAtOf, registrationWindowError, scrimOccursOn, startsAtOf } from "./schedule.js";
import { markSuggestionsDone } from "./suggestions.js";

const REG_NOT_FOUND = "Registration not found";

// ---------- shared shape for team-facing registration DTOs ----------
export const teamRegistrationInclude = {
  session: { select: { date: true, scrim: { include: scrimInclude }, matches: { select: { number: true, status: true } } } },
} satisfies Prisma.RegistrationInclude;

/** A night stays upcoming for its teams until every match is published, or this long after the last match was due. */
export const NIGHT_HOLD_MS = 60 * 60_000;
type TeamRegistrationRow = Prisma.RegistrationGetPayload<{ include: typeof teamRegistrationInclude }>;

export function toTeamRegistration(r: TeamRegistrationRow, now = new Date()): TeamRegistration {
  const date = dateToStr(r.session.date);
  const s = toScrim(r.session.scrim);
  const status = new Map(r.session.matches.map((m) => [m.number, m.status]));
  // the match being played or up next: the first one that hasn't ended (ended = results in review or published)
  const next = s.matches.find((m) => !["RESULTS_REVIEW", "PUBLISHED"].includes(status.get(m.number) ?? "SCHEDULED"));
  const allPublished = s.matches.every((m) => status.get(m.number) === "PUBLISHED");
  const lastStart = matchStartsAt(r.session.scrim, date, s.matches.length) ?? startsAtOf(date, s.startTime);
  return {
    id: r.id,
    status: r.status,
    slotNumber: r.slotNumber,
    rejectionReason: r.rejectionReason,
    date,
    startsAt: startsAtOf(date, s.startTime).toISOString(),
    registrationClosesAt: closesAtOf(date, s).toISOString(),
    nextGame: next ? { number: next.number, map: next.map, startsAt: iso(matchStartsAt(r.session.scrim, date, next.number)) } : null,
    over: allPublished || now.getTime() >= lastStart.getTime() + NIGHT_HOLD_MS,
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    scrim: {
      id: s.id,
      title: s.title,
      maps: s.maps,
      startTime: s.startTime,
      slotCount: s.slotCount,
      firstSlot: s.firstSlot,
      manager: s.manager,
      posterUrl: s.posterUrl,
      posterTemplate: s.posterTemplate,
      recurrence: s.recurrence,
    },
  };
}

/** Load a registration that belongs to one of `managerId`'s scrims, or 404. */
async function loadManagedRegistration(registrationId: string, managerId: string) {
  const reg = await prisma.registration.findUnique({
    where: { id: registrationId },
    select: { id: true, sessionId: true, session: { select: { scrim: { select: { managerId: true } } } } },
  });
  if (!reg || reg.session.scrim.managerId !== managerId) throw notFound(REG_NOT_FOUND);
  return reg;
}

/** Lowest free slot of a session (call inside a transaction holding the session lock), or SLOTS_FULL. */
async function lowestFreeSlot(tx: Prisma.TransactionClient, sessionId: string, firstSlot: number, slotCount: number, full: string): Promise<number> {
  const taken = await tx.registration.findMany({ where: { sessionId, status: "APPROVED", slotNumber: { not: null } }, select: { slotNumber: true } });
  const used = new Set(taken.map((t) => t.slotNumber));
  const slot = slotRange(firstSlot, slotCount).find((n) => !used.has(n));
  if (slot === undefined) throw new AppError("SLOTS_FULL", full);
  return slot;
}

const lockSession = (tx: Prisma.TransactionClient, sessionId: string) => tx.$queryRaw`SELECT id FROM "ScrimSession" WHERE id = ${sessionId} FOR UPDATE`;

/**
 * Approve a registration and allot the lowest free slot. (Teams now join confirmed — registerTeam — so this only
 * matters for older clients; kept for compatibility.)
 * Serialised per session with SELECT ... FOR UPDATE so concurrent approvals never share a slot
 * (the unique (sessionId, slotNumber) index is the last line of defence).
 */
export async function approveRegistration(registrationId: string, managerId: string): Promise<Registration> {
  const { sessionId } = await loadManagedRegistration(registrationId, managerId);

  const updated = await prisma.$transaction(
    async (tx) => {
      await lockSession(tx, sessionId);

      const reg = await tx.registration.findUniqueOrThrow({
        where: { id: registrationId },
        include: { ...registrationInclude, session: { select: { scrim: { select: { firstSlot: true, slotCount: true } } } } },
      });
      if (reg.status === "APPROVED") return reg;
      if (reg.status === "CANCELLED") throw conflict("This team cancelled their registration");

      const { firstSlot, slotCount } = reg.session.scrim;
      const slot = await lowestFreeSlot(tx, sessionId, firstSlot, slotCount, "All slots are taken. Remove a team or add more slots.");

      const res = await tx.registration.updateMany({
        where: { id: registrationId, status: { in: ["PENDING", "REJECTED"] } },
        data: {
          status: "APPROVED",
          slotNumber: slot,
          decidedAt: new Date(),
          decidedById: managerId,
          rejectionReason: null,
        },
      });
      if (res.count === 0) throw conflict("This request changed. Refresh and try again.");
      return tx.registration.findUniqueOrThrow({ where: { id: registrationId }, include: registrationInclude });
    },
    { maxWait: 10_000, timeout: 15_000 },
  );
  return toRegistration(updated);
}

export async function rejectRegistration(
  registrationId: string,
  managerId: string,
  reason: string | undefined,
): Promise<Registration> {
  await loadManagedRegistration(registrationId, managerId);
  const res = await prisma.registration.updateMany({
    where: { id: registrationId, status: { in: ["PENDING", "APPROVED"] } },
    data: {
      status: "REJECTED",
      slotNumber: null,
      rejectionReason: reason ?? null,
      decidedAt: new Date(),
      decidedById: managerId,
    },
  });
  const reg = await prisma.registration.findUniqueOrThrow({ where: { id: registrationId }, include: registrationInclude });
  if (res.count === 0) {
    if (reg.status === "REJECTED") return toRegistration(reg);
    throw conflict("This team cancelled their registration");
  }
  return toRegistration(reg);
}

const isUniqueViolation = (e: unknown): e is Prisma.PrismaClientKnownRequestError =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/** Get or lazily create the session row for (scrim, date), tolerating concurrent creators. */
export async function ensureSession(scrimId: string, date: string) {
  const d = strToDate(date);
  try {
    return await prisma.scrimSession.upsert({
      where: { scrimId_date: { scrimId, date: d } },
      create: { scrimId, date: d },
      update: {},
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      return prisma.scrimSession.findUniqueOrThrow({ where: { scrimId_date: { scrimId, date: d } } });
    }
    throw e;
  }
}

const ALREADY = "You're already registered for this scrim";

/**
 * A team joins a scrim session: confirmed straight away on the lowest free slot (no manager approval, no roster
 * requirement). Serialised per session like approvals, so two teams never share a slot. A team the manager removed
 * (REJECTED) can't rejoin that session by itself.
 */
export async function registerTeam(teamId: string, scrimId: string, date: string, now = new Date(), registeredById: string | null = null): Promise<TeamRegistration> {
  const scrim = await prisma.scrim.findUnique({ where: { id: scrimId }, include: { ...scrimInclude, manager: { select: { ...organizerSelect, isActive: true } } } });
  if (!scrim || !scrim.manager.isActive || scrim.status === "ARCHIVED" || !scrim.published) throw notFound("Scrim not found");
  if (!scrimOccursOn(scrim, date)) throw notFound("This scrim doesn't run on that date");
  if (scrim.status !== "ACTIVE") throw new AppError("REGISTRATION_CLOSED", "This scrim isn't taking registrations right now");
  const closed = registrationWindowError(scrim, date, now);
  if (closed) throw new AppError("REGISTRATION_CLOSED", closed);

  const session = await ensureSession(scrim.id, date);
  const id = await prisma.$transaction(
    async (tx) => {
      await lockSession(tx, session.id);
      const existing = await tx.registration.findUnique({ where: { sessionId_teamId: { sessionId: session.id, teamId } } });
      if (existing && (existing.status === "PENDING" || existing.status === "APPROVED")) throw conflict(ALREADY);
      if (existing?.status === "REJECTED") throw new AppError("FORBIDDEN", "The organiser removed your team from this scrim");
      const slotNumber = await lowestFreeSlot(tx, session.id, scrim.firstSlot, scrim.slotCount, "This scrim is full — every slot is taken");
      const data = { status: "APPROVED" as const, slotNumber, rejectionReason: null, decidedAt: now, decidedById: null, registeredById };
      if (existing) {
        await tx.registration.update({ where: { id: existing.id }, data: { ...data, createdAt: now } });
        return existing.id;
      }
      return (await tx.registration.create({ data: { sessionId: session.id, teamId, ...data } })).id;
    },
    { maxWait: 10_000, timeout: 15_000 },
  );
  await markSuggestionsDone(teamId, { scrimId: scrim.id, date });
  const row = await prisma.registration.findUniqueOrThrow({ where: { id }, include: teamRegistrationInclude });
  return toTeamRegistration(row);
}

export async function cancelRegistration(teamId: string, registrationId: string, now = new Date()): Promise<void> {
  const reg = await prisma.registration.findUnique({
    where: { id: registrationId },
    select: { teamId: true, status: true, session: { select: { date: true, scrim: { select: { startTime: true, registrationCloseMinutes: true } } } } },
  });
  if (!reg || reg.teamId !== teamId) throw notFound(REG_NOT_FOUND);
  if (reg.status !== "PENDING" && reg.status !== "APPROVED") {
    throw conflict(reg.status === "CANCELLED" ? "This registration is already cancelled" : "This registration was rejected");
  }
  if (now >= closesAtOf(dateToStr(reg.session.date), reg.session.scrim)) {
    throw new AppError("REGISTRATION_CLOSED", "Registration has closed, so it can't be cancelled");
  }
  const res = await prisma.registration.updateMany({
    where: { id: registrationId, status: { in: ["PENDING", "APPROVED"] } },
    data: { status: "CANCELLED", slotNumber: null },
  });
  if (res.count === 0) throw conflict("This registration changed. Refresh and try again.");
}
