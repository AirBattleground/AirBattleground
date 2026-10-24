import type { Prisma } from "@prisma/client";
import {
  API_PREFIX,
  DEFAULT_POINTS_SYSTEM,
  isLanguage,
  pointsSystemSchema,
  scrimMatchPlan,
  type PointsSystem,
} from "@7xen/shared";
import type {
  GameMap,
  PlayerSummary,
  ManagerRow,
  OrganizerRef,
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
/** Scrim.pointsSystem JSON → PointsSystem (null/invalid → DEFAULT_POINTS_SYSTEM). */
export function pointsSystemOf(raw: Prisma.JsonValue | null | undefined): PointsSystem {
  const r = pointsSystemSchema.safeParse(raw);
  return r.success ? r.data : { placement: [...DEFAULT_POINTS_SYSTEM.placement], killPoints: DEFAULT_POINTS_SYSTEM.killPoints };
}

export const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
// ---------- shared include shapes ----------
/** branding storage key ("branding/<id>.png") → URL the frontends load; null stays null. */
export const brandingUrl = (key: string | null | undefined): string | null => (key ? `${API_PREFIX}/media/${key}` : null);

export const organizerSelect = { id: true, displayName: true, orgLogoKey: true } satisfies Prisma.UserSelect;
/** manager row → OrganizerRef (adds the org logo URL) */
export const toOrganizer = (m: { id: string; displayName: string; orgLogoKey: string | null }): OrganizerRef => ({
  id: m.id,
  displayName: m.displayName,
  logoUrl: brandingUrl(m.orgLogoKey),
});

export const scrimInclude = {
  manager: { select: organizerSelect },
} satisfies Prisma.ScrimInclude;
export type ScrimWithManager = Prisma.ScrimGetPayload<{ include: typeof scrimInclude }>;

/** phase 5: small player identity (PlayerSummary) */
/** A player's picture: the photo they uploaded, else their Google picture. */
export const avatarOf = (u: { avatarUrl: string | null; avatarKey: string | null }): string | null => brandingUrl(u.avatarKey) ?? u.avatarUrl;

export const playerSummarySelect = { id: true, ign: true, displayName: true, avatarUrl: true, avatarKey: true } satisfies Prisma.UserSelect;
export const toPlayerSummary = (u: { id: string; ign: string | null; displayName: string; avatarUrl: string | null; avatarKey: string | null }): PlayerSummary => ({
  id: u.id,
  ign: u.ign,
  displayName: u.displayName,
  avatarUrl: avatarOf(u),
});

/** Team + its leader's IGN (shown where the old free-text captainName was). */
export const teamSelect = { id: true, name: true, tag: true, leader: { select: { ign: true, displayName: true } } } satisfies Prisma.TeamSelect;
/** phase 5: the old `captainName` field = the leader's IGN */
export const captainNameOf = (t: { leader: { ign: string | null; displayName: string } | null }): string | null =>
  t.leader ? (t.leader.ign ?? t.leader.displayName) : null;
export const registrationInclude = { team: { select: teamSelect } } satisfies Prisma.RegistrationInclude;
type RegistrationWithTeam = Prisma.RegistrationGetPayload<{ include: typeof registrationInclude }>;

/** Session user: a player's team comes from their membership (phase 5). */
export const userWithTeamInclude = {
  membership: { select: { role: true, team: { select: { id: true, name: true, tag: true } } } },
} satisfies Prisma.UserInclude;
export type UserWithTeam = Prisma.UserGetPayload<{ include: typeof userWithTeamInclude }>;

// ---------- mappers ----------
export function toSessionUser(u: UserWithTeam): SessionUser {
  const m = u.role === "PLAYER" ? u.membership : null;
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    displayName: u.displayName,
    team: m ? toTeamSummary(m.team) : null,
    player:
      u.role === "PLAYER"
        ? {
            ign: u.ign,
            bgmiId: u.bgmiId,
            avatarUrl: avatarOf(u),
            email: u.email,
            team: m ? { ...toTeamSummary(m.team), role: m.role } : null,
            needsOnboarding: !u.ign,
            language: isLanguage(u.language) ? u.language : null,
          }
        : null,
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
    matches: scrimMatchPlan(s).map((m) => ({ ...m, map: m.map as GameMap })),
    registrationCloseMinutes: s.registrationCloseMinutes,
    published: s.published,
    recurrence: s.recurrence,
    startDate: dateToStr(s.startDate),
    endDate: s.endDate ? dateToStr(s.endDate) : null,
    slotCount: s.slotCount,
    firstSlot: s.firstSlot,
    status: s.status,
    pointsSystem: pointsSystemOf(s.pointsSystem),
    manager: toOrganizer(s.manager),
    posterUrl: brandingUrl(s.posterKey),
    winCoins: s.winCoins,
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
    team: { ...toTeamSummary(r.team), captainName: captainNameOf(r.team) },
  };
}

export const managerRowInclude = { _count: { select: { scrims: true } } } satisfies Prisma.UserInclude;
type ManagerWithCount = Prisma.UserGetPayload<{ include: typeof managerRowInclude }>;

export function toManagerRow(u: ManagerWithCount): ManagerRow {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    orgName: u.orgName,
    email: u.email,
    phone: u.phone,
    isActive: u.isActive,
    scrimCount: u._count.scrims,
    lastLoginAt: iso(u.lastLoginAt),
    createdAt: u.createdAt.toISOString(),
  };
}

export const teamRowInclude = {
  leader: { select: playerSummarySelect },
  _count: { select: { registrations: true, members: true } },
} satisfies Prisma.TeamInclude;
type TeamWithLeader = Prisma.TeamGetPayload<{ include: typeof teamRowInclude }>;

export function toTeamRow(t: TeamWithLeader): TeamRow {
  return {
    id: t.id,
    name: t.name,
    tag: t.tag,
    leader: t.leader ? toPlayerSummary(t.leader) : null,
    memberCount: t._count.members,
    registrationCount: t._count.registrations,
    createdAt: t.createdAt.toISOString(),
  };
}
