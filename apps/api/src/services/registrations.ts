import { Prisma } from "@prisma/client";
import { slotRange, type Registration, type TeamRegistration } from "@7xen/shared";
import { prisma } from "../db.js";
import { AppError, conflict, notFound } from "../lib/errors.js";
import {
  dateToStr,
  registrationInclude,
  scrimInclude,
  strToDate,
  toRegistration,
  toScrim,
} from "../lib/serialize.js";
import { scrimOccursOn, startsAtOf } from "./schedule.js";

const REG_NOT_FOUND = "Registration not found";

// ---------- shared shape for team-facing registration DTOs ----------
export const teamRegistrationInclude = {
  session: { select: { date: true, scrim: { include: scrimInclude } } },
} satisfies Prisma.RegistrationInclude;
export type TeamRegistrationRow = Prisma.RegistrationGetPayload<{ include: typeof teamRegistrationInclude }>;

export function toTeamRegistration(r: TeamRegistrationRow): TeamRegistration {
  const date = dateToStr(r.session.date);
  const s = toScrim(r.session.scrim);
  return {
    id: r.id,
    status: r.status,
    slotNumber: r.slotNumber,
    rejectionReason: r.rejectionReason,
    date,
    startsAt: startsAtOf(date, s.startTime).toISOString(),
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

/**
 * Approve a registration and allot the lowest free slot.
 * Serialised per session with SELECT ... FOR UPDATE so concurrent approvals never share a slot
 * (the unique (sessionId, slotNumber) index is the last line of defence).
 */
export async function approveRegistration(registrationId: string, managerId: string): Promise<Registration> {
  const { sessionId } = await loadManagedRegistration(registrationId, managerId);

  const updated = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ScrimSession" WHERE id = ${sessionId} FOR UPDATE`;

      const reg = await tx.registration.findUniqueOrThrow({
        where: { id: registrationId },
        include: { ...registrationInclude, session: { select: { scrim: { select: { firstSlot: true, slotCount: true } } } } },
      });
      if (reg.status === "APPROVED") return reg;
      if (reg.status === "CANCELLED") throw conflict("This team cancelled their registration");

      const taken = await tx.registration.findMany({
        where: { sessionId, status: "APPROVED", slotNumber: { not: null } },
        select: { slotNumber: true },
      });
      const used = new Set(taken.map((t) => t.slotNumber));
      const { firstSlot, slotCount } = reg.session.scrim;
      const slot = slotRange(firstSlot, slotCount).find((n) => !used.has(n));
      if (slot === undefined) {
        throw new AppError("SLOTS_FULL", "All slots are taken. Reject a team or add more slots.");
      }

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

export async function registerTeam(teamId: string, scrimId: string, date: string, now = new Date()): Promise<TeamRegistration> {
  const scrim = await prisma.scrim.findUnique({ where: { id: scrimId }, include: { ...scrimInclude, manager: { select: { id: true, displayName: true, isActive: true } } } });
  if (!scrim || !scrim.manager.isActive || scrim.status === "ARCHIVED") throw notFound("Scrim not found");
  if (!scrimOccursOn(scrim, date)) throw notFound("This scrim doesn't run on that date");
  if (scrim.status !== "ACTIVE") throw new AppError("REGISTRATION_CLOSED", "This scrim isn't taking registrations right now");
  if (now >= startsAtOf(date, scrim.startTime)) {
    throw new AppError("REGISTRATION_CLOSED", "Registration for this scrim has closed");
  }

  const session = await ensureSession(scrim.id, date);
  const existing = await prisma.registration.findUnique({
    where: { sessionId_teamId: { sessionId: session.id, teamId } },
  });

  let id: string;
  if (existing) {
    if (existing.status === "PENDING" || existing.status === "APPROVED") throw conflict(ALREADY);
    const res = await prisma.registration.updateMany({
      where: { id: existing.id, status: { in: ["REJECTED", "CANCELLED"] } },
      data: {
        status: "PENDING",
        slotNumber: null,
        rejectionReason: null,
        decidedAt: null,
        decidedById: null,
        createdAt: now,
      },
    });
    if (res.count === 0) throw conflict(ALREADY);
    id = existing.id;
  } else {
    try {
      const created = await prisma.registration.create({ data: { sessionId: session.id, teamId, status: "PENDING" } });
      id = created.id;
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict(ALREADY);
      throw e;
    }
  }
  const row = await prisma.registration.findUniqueOrThrow({ where: { id }, include: teamRegistrationInclude });
  return toTeamRegistration(row);
}

export async function cancelRegistration(teamId: string, registrationId: string, now = new Date()): Promise<void> {
  const reg = await prisma.registration.findUnique({
    where: { id: registrationId },
    select: { teamId: true, status: true, session: { select: { date: true, scrim: { select: { startTime: true } } } } },
  });
  if (!reg || reg.teamId !== teamId) throw notFound(REG_NOT_FOUND);
  if (reg.status !== "PENDING" && reg.status !== "APPROVED") {
    throw conflict(reg.status === "CANCELLED" ? "This registration is already cancelled" : "This registration was rejected");
  }
  if (now >= startsAtOf(dateToStr(reg.session.date), reg.session.scrim.startTime)) {
    throw new AppError("REGISTRATION_CLOSED", "This scrim has already started, so it can't be cancelled");
  }
  const res = await prisma.registration.updateMany({
    where: { id: registrationId, status: { in: ["PENDING", "APPROVED"] } },
    data: { status: "CANCELLED", slotNumber: null },
  });
  if (res.count === 0) throw conflict("This registration changed. Refresh and try again.");
}
