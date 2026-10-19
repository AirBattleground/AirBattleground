import type { Prisma } from "@prisma/client";
import {
  type AdminPlayerRow,
  type AdminStats,
  type AdminTeamDetail,
  type AdminUpdatePlayerInput,
  type CreateManagerInput,
  type CreateManagerInviteInput,
  type ManagerInviteRow,
  type ManagerInviteStatus,
  type ManagerRow,
  type TeamRow,
  type UpdateManagerInput,
} from "@7xen/shared";
import { prisma } from "../db.js";
import { AppError, notFound } from "../lib/errors.js";
import { isAdminEmail } from "./playerAuth.js";
import { hashPassword } from "../lib/password.js";
import { iso, managerRowInclude, playerSummarySelect, teamRowInclude, toManagerRow, toPlayerSummary, toTeamRow } from "../lib/serialize.js";
import { countUpcomingTeamRegistrations, deleteTeam } from "./players.js";
import { countUpcomingRegistrations } from "./schedule.js";

const contains = (q: string) => ({ contains: q, mode: "insensitive" as const });

// ---------- stats ----------
export async function adminStats(now = new Date()): Promise<AdminStats> {
  const [mTotal, mActive, tTotal, tActive, sTotal, sActive, pending, approvedUpcoming, pTotal, pActive] = await Promise.all([
    prisma.user.count({ where: { role: "MANAGER" } }),
    prisma.user.count({ where: { role: "MANAGER", isActive: true } }),
    prisma.team.count(),
    prisma.team.count({ where: { leader: { isActive: true } } }),
    prisma.scrim.count(),
    prisma.scrim.count({ where: { status: "ACTIVE" } }),
    countUpcomingRegistrations({ status: "PENDING" }, now),
    countUpcomingRegistrations({ status: "APPROVED" }, now),
    prisma.user.count({ where: { role: "PLAYER" } }),
    prisma.user.count({ where: { role: "PLAYER", isActive: true } }),
  ]);
  return {
    managers: { total: mTotal, active: mActive },
    teams: { total: tTotal, active: tActive },
    scrims: { total: sTotal, active: sActive },
    registrations: { pending, approvedUpcoming },
    // phase 5: team requests are gone (players create teams); kept in the shape for compatibility
    teamRequests: { pending: 0 },
    players: { total: pTotal, active: pActive },
  };
}

// ---------- managers ----------
export async function listManagers(q?: string): Promise<ManagerRow[]> {
  const where: Prisma.UserWhereInput = { role: "MANAGER" };
  if (q) where.OR = [{ username: contains(q) }, { displayName: contains(q) }, { email: contains(q) }, { orgName: contains(q) }];
  const rows = await prisma.user.findMany({ where, include: managerRowInclude, orderBy: { createdAt: "desc" } });
  return rows.map(toManagerRow);
}

export async function createManager(input: CreateManagerInput): Promise<ManagerRow> {
  const user = await prisma.user.create({
    data: {
      role: "MANAGER",
      username: input.username,
      passwordHash: await hashPassword(input.password),
      displayName: input.displayName,
      email: input.email ?? null,
      phone: input.phone ?? null,
    },
    include: managerRowInclude,
  });
  return toManagerRow(user);
}

async function assertManager(id: string) {
  const u = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  if (!u || u.role !== "MANAGER") throw notFound("Manager not found");
}

export async function updateManager(id: string, input: UpdateManagerInput): Promise<ManagerRow> {
  await assertManager(id);
  const user = await prisma.user.update({
    where: { id },
    data: {
      displayName: input.displayName,
      email: input.email,
      phone: input.phone,
      isActive: input.isActive,
    },
    include: managerRowInclude,
  });
  return toManagerRow(user);
}

export async function resetManagerPassword(id: string, password: string): Promise<void> {
  await assertManager(id);
  await prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(password) } });
}

// ---------- manager invitations (phase 5b) ----------
const inviteInclude = {
  invitedBy: { select: { id: true, displayName: true } },
  acceptedUser: { select: { id: true, displayName: true } },
} satisfies Prisma.ManagerInviteInclude;
type InviteWithUsers = Prisma.ManagerInviteGetPayload<{ include: typeof inviteInclude }>;

const toManagerInviteRow = (i: InviteWithUsers): ManagerInviteRow => ({
  id: i.id,
  name: i.name,
  orgName: i.orgName,
  email: i.email,
  status: i.status,
  invitedBy: i.invitedBy,
  manager: i.acceptedUser,
  createdAt: i.createdAt.toISOString(),
  acceptedAt: iso(i.acceptedAt),
});

export async function listManagerInvites(status: ManagerInviteStatus = "PENDING"): Promise<ManagerInviteRow[]> {
  const rows = await prisma.managerInvite.findMany({ where: { status }, include: inviteInclude, orderBy: { createdAt: "desc" } });
  return rows.map(toManagerInviteRow);
}

const ALREADY_INVITED = "They're already invited. Share the invitation again or revoke it first.";

export async function createManagerInvite(input: CreateManagerInviteInput, adminId: string): Promise<ManagerInviteRow> {
  const email = input.email.trim().toLowerCase();
  const conflict = (message: string) => new AppError("CONFLICT", message, { email: message });
  if (isAdminEmail(email)) throw conflict("That's the admin's email.");
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { role: true, membership: { select: { id: true } } },
  });
  if (user?.role === "ADMIN") throw conflict("That's the admin's email.");
  if (user?.role === "MANAGER") throw conflict("They're already a manager.");
  if (user?.role === "PLAYER" && user.membership) throw conflict("They're a player in a team — they must leave it first.");
  if (await prisma.managerInvite.findFirst({ where: { email, status: "PENDING" }, select: { id: true } })) {
    throw conflict(ALREADY_INVITED);
  }
  try {
    const row = await prisma.managerInvite.create({
      data: { email, name: input.name.trim(), orgName: input.orgName.trim(), invitedById: adminId },
      include: inviteInclude,
    });
    return toManagerInviteRow(row);
  } catch (e) {
    // two invites racing: the partial unique index "ManagerInvite_one_pending" caught the second
    if ((e as { code?: string }).code === "P2002") throw conflict(ALREADY_INVITED);
    throw e;
  }
}

export async function revokeManagerInvite(id: string): Promise<void> {
  const invite = await prisma.managerInvite.findUnique({ where: { id }, select: { status: true } });
  if (!invite) throw notFound("Invitation not found");
  const done = await prisma.managerInvite.updateMany({ where: { id, status: "PENDING" }, data: { status: "REVOKED" } });
  if (done.count !== 1) {
    throw new AppError(
      "CONFLICT",
      invite.status === "ACCEPTED" ? "This invitation was already accepted." : "This invitation was already revoked.",
    );
  }
}

// ---------- teams (phase 5: groups of players; no team logins) ----------
export async function listTeams(q?: string): Promise<TeamRow[]> {
  const where: Prisma.TeamWhereInput = {};
  if (q) {
    where.OR = [
      { name: contains(q) },
      { tag: contains(q) },
      { members: { some: { user: { OR: [{ ign: contains(q) }, { displayName: contains(q) }, { email: contains(q) }] } } } },
    ];
  }
  const rows = await prisma.team.findMany({ where, include: teamRowInclude, orderBy: { createdAt: "desc" } });
  return rows.map(toTeamRow);
}

export async function teamDetail(id: string): Promise<AdminTeamDetail> {
  const t = await prisma.team.findUnique({
    where: { id },
    include: {
      leader: { select: playerSummarySelect },
      members: { include: { user: { select: { ...playerSummarySelect, bgmiId: true } } }, orderBy: { joinedAt: "asc" } },
    },
  });
  if (!t) throw notFound("Team not found");
  return {
    id: t.id,
    name: t.name,
    tag: t.tag,
    leader: toPlayerSummary(t.leader),
    members: t.members
      .map((m) => ({ ...toPlayerSummary(m.user), bgmiId: m.user.bgmiId, role: m.role, joinedAt: m.joinedAt.toISOString() }))
      .sort((a, b) => (a.role === b.role ? 0 : a.role === "LEADER" ? -1 : 1)),
    upcomingRegistrations: await countUpcomingTeamRegistrations(t.id),
    createdAt: t.createdAt.toISOString(),
  };
}

export async function disbandTeam(id: string): Promise<void> {
  const t = await prisma.team.findUnique({ where: { id }, select: { id: true } });
  if (!t) throw notFound("Team not found");
  await deleteTeam(id, { checkEntries: false });
}

// ---------- players ----------
const playerRowInclude = {
  membership: { select: { role: true, team: { select: { id: true, name: true, tag: true } } } },
} satisfies Prisma.UserInclude;
type PlayerWithTeam = Prisma.UserGetPayload<{ include: typeof playerRowInclude }>;

const toAdminPlayerRow = (u: PlayerWithTeam): AdminPlayerRow => ({
  ...toPlayerSummary(u),
  email: u.email,
  bgmiId: u.bgmiId,
  isActive: u.isActive,
  team: u.membership ? { ...u.membership.team, role: u.membership.role } : null,
  lastLoginAt: iso(u.lastLoginAt),
  createdAt: u.createdAt.toISOString(),
});

export async function listPlayers(q?: string): Promise<AdminPlayerRow[]> {
  const where: Prisma.UserWhereInput = { role: "PLAYER" };
  if (q) {
    where.OR = [
      { ign: contains(q) },
      { displayName: contains(q) },
      { email: contains(q) },
      { bgmiId: { contains: q } },
      { membership: { team: { name: contains(q) } } },
    ];
  }
  const rows = await prisma.user.findMany({ where, include: playerRowInclude, orderBy: { createdAt: "desc" }, take: 500 });
  return rows.map(toAdminPlayerRow);
}

export async function updatePlayer(id: string, input: AdminUpdatePlayerInput): Promise<AdminPlayerRow> {
  const u = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  if (!u || u.role !== "PLAYER") throw notFound("Player not found");
  const row = await prisma.user.update({ where: { id }, data: { isActive: input.isActive }, include: playerRowInclude });
  return toAdminPlayerRow(row);
}
