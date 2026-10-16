import type { Prisma } from "@prisma/client";
import type {
  GameMap,
  ManagerRow,
  Registration,
  Scrim,
  SessionUser,
  TeamRow,
  TeamSummary,
} from "@7xen/shared";

/** @db.Date column (UTC midnight) → "YYYY-MM-DD" */
export const dateToStr = (d: Date): string => d.toISOString().slice(0, 10);
/** "YYYY-MM-DD" → Date for a @db.Date column */
export const strToDate = (s: string): Date => new Date(`${s}T00:00:00.000Z`);
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

// ---------- shared include shapes ----------
export const scrimInclude = {
  manager: { select: { id: true, displayName: true } },
} satisfies Prisma.ScrimInclude;
export type ScrimWithManager = Prisma.ScrimGetPayload<{ include: typeof scrimInclude }>;

export const teamSelect = { id: true, name: true, tag: true, captainName: true } satisfies Prisma.TeamSelect;
export const registrationInclude = { team: { select: teamSelect } } satisfies Prisma.RegistrationInclude;
export type RegistrationWithTeam = Prisma.RegistrationGetPayload<{ include: typeof registrationInclude }>;

export const userWithTeamInclude = { team: { select: { id: true, name: true, tag: true } } } satisfies Prisma.UserInclude;
export type UserWithTeam = Prisma.UserGetPayload<{ include: typeof userWithTeamInclude }>;

// ---------- mappers ----------
export function toSessionUser(u: UserWithTeam): SessionUser {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    displayName: u.displayName,
    team: u.role === "TEAM" && u.team ? { id: u.team.id, name: u.team.name, tag: u.team.tag } : null,
  };
}

export const toTeamSummary = (t: { id: string; name: string; tag: string }): TeamSummary => ({
  id: t.id,
  name: t.name,
  tag: t.tag,
});

export function toScrim(s: ScrimWithManager): Scrim {
  return {
    id: s.id,
    title: s.title,
    description: s.description,
    maps: s.maps as GameMap[],
    startTime: s.startTime,
    recurrence: s.recurrence,
    startDate: dateToStr(s.startDate),
    endDate: s.endDate ? dateToStr(s.endDate) : null,
    slotCount: s.slotCount,
    firstSlot: s.firstSlot,
    status: s.status,
    manager: { id: s.manager.id, displayName: s.manager.displayName },
    createdAt: s.createdAt.toISOString(),
  };
}

export function toRegistration(r: RegistrationWithTeam): Registration {
  return {
    id: r.id,
    status: r.status,
    slotNumber: r.slotNumber,
    rejectionReason: r.rejectionReason,
    createdAt: r.createdAt.toISOString(),
    decidedAt: iso(r.decidedAt),
    team: { ...toTeamSummary(r.team), captainName: r.team.captainName },
  };
}

export const managerRowInclude = { _count: { select: { scrims: true } } } satisfies Prisma.UserInclude;
export type ManagerWithCount = Prisma.UserGetPayload<{ include: typeof managerRowInclude }>;

export function toManagerRow(u: ManagerWithCount): ManagerRow {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    email: u.email,
    phone: u.phone,
    isActive: u.isActive,
    scrimCount: u._count.scrims,
    lastLoginAt: iso(u.lastLoginAt),
    createdAt: u.createdAt.toISOString(),
  };
}

export const teamRowInclude = {
  user: true,
  _count: { select: { registrations: true } },
} satisfies Prisma.TeamInclude;
export type TeamWithUser = Prisma.TeamGetPayload<{ include: typeof teamRowInclude }>;

export function toTeamRow(t: TeamWithUser): TeamRow {
  return {
    id: t.id,
    userId: t.userId,
    name: t.name,
    tag: t.tag,
    captainName: t.captainName,
    username: t.user.username,
    email: t.user.email,
    phone: t.user.phone,
    isActive: t.user.isActive,
    registrationCount: t._count.registrations,
    lastLoginAt: iso(t.user.lastLoginAt),
    createdAt: t.createdAt.toISOString(),
  };
}
