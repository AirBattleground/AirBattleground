import type { Prisma } from "@prisma/client";
import {
  teamNameKey,
  type AdminStats,
  type CreateManagerInput,
  type CreateTeamInput,
  type ManagerRow,
  type TeamRow,
  type UpdateManagerInput,
  type UpdateTeamInput,
} from "@7xen/shared";
import { prisma } from "../db.js";
import { notFound } from "../lib/errors.js";
import { hashPassword } from "../lib/password.js";
import { managerRowInclude, teamRowInclude, toManagerRow, toTeamRow } from "../lib/serialize.js";
import { countUpcomingRegistrations } from "./schedule.js";
import { assertAvailable, countPendingTeamRequests } from "./teamRequests.js";

const contains = (q: string) => ({ contains: q, mode: "insensitive" as const });

// ---------- stats ----------
export async function adminStats(now = new Date()): Promise<AdminStats> {
  const [mTotal, mActive, tTotal, tActive, sTotal, sActive, pending, approvedUpcoming, pendingTeamRequests] = await Promise.all([
    prisma.user.count({ where: { role: "MANAGER" } }),
    prisma.user.count({ where: { role: "MANAGER", isActive: true } }),
    prisma.team.count(),
    prisma.team.count({ where: { user: { isActive: true } } }),
    prisma.scrim.count(),
    prisma.scrim.count({ where: { status: "ACTIVE" } }),
    countUpcomingRegistrations({ status: "PENDING" }, now),
    countUpcomingRegistrations({ status: "APPROVED" }, now),
    countPendingTeamRequests(),
  ]);
  return {
    managers: { total: mTotal, active: mActive },
    teams: { total: tTotal, active: tActive },
    scrims: { total: sTotal, active: sActive },
    registrations: { pending, approvedUpcoming },
    teamRequests: { pending: pendingTeamRequests },
  };
}

// ---------- managers ----------
export async function listManagers(q?: string): Promise<ManagerRow[]> {
  const where: Prisma.UserWhereInput = { role: "MANAGER" };
  if (q) where.OR = [{ username: contains(q) }, { displayName: contains(q) }, { email: contains(q) }];
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

// ---------- teams ----------
export async function listTeams(q?: string): Promise<TeamRow[]> {
  const where: Prisma.TeamWhereInput = {};
  if (q) {
    where.OR = [
      { name: contains(q) },
      { tag: contains(q) },
      { user: { username: contains(q) } },
      { user: { displayName: contains(q) } },
      { user: { email: contains(q) } },
    ];
  }
  const rows = await prisma.team.findMany({ where, include: teamRowInclude, orderBy: { createdAt: "desc" } });
  return rows.map(toTeamRow);
}

export async function createTeam(input: CreateTeamInput): Promise<TeamRow> {
  await assertAvailable({ teamName: input.teamName, username: input.username });
  const passwordHash = await hashPassword(input.password);
  const team = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        role: "TEAM",
        username: input.username,
        passwordHash,
        displayName: input.teamName,
        email: input.email ?? null,
        phone: input.phone ?? null,
      },
    });
    return tx.team.create({
      data: {
        userId: user.id,
        name: input.teamName,
        nameKey: teamNameKey(input.teamName),
        tag: input.tag,
        captainName: input.captainName ?? null,
      },
      include: teamRowInclude,
    });
  });
  return toTeamRow(team);
}

export async function updateTeam(id: string, input: UpdateTeamInput): Promise<TeamRow> {
  const existing = await prisma.team.findUnique({ where: { id }, select: { userId: true } });
  if (!existing) throw notFound("Team not found");
  if (input.teamName !== undefined) await assertAvailable({ teamName: input.teamName }, { excludeTeamId: id });
  const team = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: existing.userId },
      data: {
        displayName: input.teamName,
        email: input.email,
        phone: input.phone,
        isActive: input.isActive,
      },
    });
    return tx.team.update({
      where: { id },
      data: {
        name: input.teamName,
        nameKey: input.teamName !== undefined ? teamNameKey(input.teamName) : undefined,
        tag: input.tag,
        captainName: input.captainName,
      },
      include: teamRowInclude,
    });
  });
  return toTeamRow(team);
}

export async function resetTeamPassword(id: string, password: string): Promise<void> {
  const team = await prisma.team.findUnique({ where: { id }, select: { userId: true } });
  if (!team) throw notFound("Team not found");
  await prisma.user.update({ where: { id: team.userId }, data: { passwordHash: await hashPassword(password) } });
}
