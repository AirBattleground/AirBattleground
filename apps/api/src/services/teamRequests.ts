import { Prisma } from "@prisma/client";
import {
  teamNameKey,
  type AvailabilityResult,
  type CreateTeamInput,
  type TeamAvailability,
  type TeamAvailabilityQuery,
  type TeamRequestRow,
  type TeamRequestStatus,
  type TeamRow,
} from "@7xen/shared";
import { prisma } from "../db.js";
import { AppError, notFound } from "../lib/errors.js";
import { hashPassword } from "../lib/password.js";
import { teamRequestInclude, teamRowInclude, toTeamRequestRow, toTeamRow } from "../lib/serialize.js";

type Db = Prisma.TransactionClient | typeof prisma;

const TAKEN = "Already taken";
const PENDING_ELSEWHERE = "Already requested — waiting for admin approval";

/**
 * Team names and usernames are unique across real teams/users AND pending manager requests,
 * so two managers can't both queue "Team Soul" and the admin can't create one that's queued.
 */
export async function checkAvailability(
  q: TeamAvailabilityQuery,
  opts: { excludeRequestId?: string; excludeTeamId?: string } = {},
  db: Db = prisma,
): Promise<TeamAvailability> {
  const out: TeamAvailability = {};
  const notThisRequest = opts.excludeRequestId ? { id: { not: opts.excludeRequestId } } : {};
  if (q.teamName) {
    const nameKey = teamNameKey(q.teamName);
    const [team, req] = await Promise.all([
      db.team.findFirst({ where: { nameKey, ...(opts.excludeTeamId ? { id: { not: opts.excludeTeamId } } : {}) }, select: { id: true } }),
      db.teamRequest.findFirst({ where: { nameKey, status: "PENDING", ...notThisRequest }, select: { id: true } }),
    ]);
    out.teamName = result(team ? TAKEN : req ? PENDING_ELSEWHERE : null);
  }
  if (q.username) {
    const username = q.username.toLowerCase();
    const [user, req] = await Promise.all([
      db.user.findUnique({ where: { username }, select: { id: true } }),
      db.teamRequest.findFirst({ where: { username, status: "PENDING", ...notThisRequest }, select: { id: true } }),
    ]);
    out.username = result(user ? TAKEN : req ? PENDING_ELSEWHERE : null);
  }
  return out;
}

const result = (message: string | null): AvailabilityResult => ({ available: message === null, message });

/** Throws 409 CONFLICT with per-field messages if the name or username is unavailable. */
export async function assertAvailable(q: TeamAvailabilityQuery, opts: Parameters<typeof checkAvailability>[1] = {}, db: Db = prisma) {
  const a = await checkAvailability(q, opts, db);
  const fields: Record<string, string> = {};
  if (a.teamName && !a.teamName.available) fields.teamName = a.teamName.message === TAKEN ? "That team name is already taken" : `That team name is ${PENDING_ELSEWHERE.toLowerCase()}`;
  if (a.username && !a.username.available) fields.username = a.username.message === TAKEN ? "That username is already taken" : `That username is ${PENDING_ELSEWHERE.toLowerCase()}`;
  const first = Object.values(fields)[0];
  if (first) throw new AppError("CONFLICT", first, fields);
}

// ---------- manager ----------
export async function createTeamRequest(managerId: string, input: CreateTeamInput): Promise<TeamRequestRow> {
  await assertAvailable({ teamName: input.teamName, username: input.username });
  const row = await prisma.teamRequest.create({
    data: {
      managerId,
      teamName: input.teamName,
      nameKey: teamNameKey(input.teamName),
      tag: input.tag,
      captainName: input.captainName ?? null,
      username: input.username,
      passwordHash: await hashPassword(input.password),
      email: input.email ?? null,
      phone: input.phone ?? null,
    },
    include: teamRequestInclude,
  });
  return toTeamRequestRow(row);
}

export async function listManagerTeamRequests(managerId: string): Promise<TeamRequestRow[]> {
  const rows = await prisma.teamRequest.findMany({ where: { managerId }, include: teamRequestInclude, orderBy: { createdAt: "desc" } });
  return rows.map(toTeamRequestRow);
}

export async function withdrawTeamRequest(managerId: string, id: string): Promise<void> {
  const req = await prisma.teamRequest.findFirst({ where: { id, managerId }, select: { status: true } });
  if (!req) throw notFound("Request not found");
  if (req.status !== "PENDING") throw new AppError("CONFLICT", "The admin has already reviewed this request");
  await prisma.teamRequest.deleteMany({ where: { id, managerId, status: "PENDING" } });
}

// ---------- admin ----------
export async function listTeamRequests(status: TeamRequestStatus): Promise<TeamRequestRow[]> {
  const rows = await prisma.teamRequest.findMany({
    where: { status },
    include: teamRequestInclude,
    // queue order for pending; most recent decisions first for history
    orderBy: status === "PENDING" ? { createdAt: "asc" } : { reviewedAt: "desc" },
    take: status === "PENDING" ? undefined : 200,
  });
  return rows.map(toTeamRequestRow);
}

/** Turns a pending request into a real team login. Atomic; a second approve gets 409. */
export async function approveTeamRequest(adminId: string, id: string): Promise<TeamRow> {
  const team = await prisma.$transaction(async (tx) => {
    const req = await tx.teamRequest.findUnique({ where: { id } });
    if (!req) throw notFound("Request not found");
    const claimed = await tx.teamRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "APPROVED", reviewedAt: new Date(), reviewedById: adminId, rejectionReason: null },
    });
    if (claimed.count === 0) throw new AppError("CONFLICT", "This request has already been reviewed");
    // the request itself is no longer PENDING, so this only finds real teams/users
    await assertAvailable({ teamName: req.teamName, username: req.username }, { excludeRequestId: id }, tx);
    const user = await tx.user.create({
      data: {
        role: "TEAM",
        username: req.username,
        passwordHash: req.passwordHash,
        displayName: req.teamName,
        email: req.email,
        phone: req.phone,
      },
    });
    const t = await tx.team.create({
      data: { userId: user.id, name: req.teamName, nameKey: req.nameKey, tag: req.tag, captainName: req.captainName },
    });
    await tx.teamRequest.update({ where: { id }, data: { teamId: t.id } });
    return tx.team.findUniqueOrThrow({ where: { id: t.id }, include: teamRowInclude });
  });
  return toTeamRow(team);
}

export async function rejectTeamRequest(adminId: string, id: string, reason: string | undefined): Promise<TeamRequestRow> {
  const updated = await prisma.teamRequest.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "REJECTED", reviewedAt: new Date(), reviewedById: adminId, rejectionReason: reason ?? null },
  });
  if (updated.count === 0) {
    const exists = await prisma.teamRequest.count({ where: { id } });
    if (!exists) throw notFound("Request not found");
    throw new AppError("CONFLICT", "This request has already been reviewed");
  }
  return toTeamRequestRow(await prisma.teamRequest.findUniqueOrThrow({ where: { id }, include: teamRequestInclude }));
}

export const countPendingTeamRequests = () => prisma.teamRequest.count({ where: { status: "PENDING" } });

/** For login: a team whose request is pending/rejected gets a helpful message instead of "wrong password". */
export async function latestRequestForLogin(username: string) {
  return prisma.teamRequest.findFirst({
    where: { username, status: { in: ["PENDING", "REJECTED"] } },
    orderBy: { createdAt: "desc" },
    select: { status: true, passwordHash: true, rejectionReason: true },
  });
}
