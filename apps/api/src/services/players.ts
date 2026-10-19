/**
 * Phase 5 — player accounts & teams (plan: docs/phase5/PLAYERS.md, contract: packages/shared/src/players.ts).
 *
 * Rules: a player is in at most ONE team (TeamMember.userId unique). A BGMI ID is required to create or join a team.
 * The team's LEADER (Team.leaderId = the LEADER TeamMember) manages members, join requests and the invite code.
 * Membership changes that check capacity run in a transaction holding a row lock on the Team.
 */
import { randomInt } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  MAX_TEAM_MEMBERS,
  normalizeInviteCode,
  teamNameKey,
  todayInAppTz,
  type AvailabilityResult,
  type CreatePlayerTeamInput,
  type MyJoinRequest,
  type PlayerProfile,
  type PlayerTeam,
  type TeamAvailability,
  type TeamAvailabilityQuery,
  type TeamInvitePreview,
  type TeamMemberRow,
  type TeamRole,
  type UpdatePlayerProfileInput,
  type UpdatePlayerTeamInput,
} from "@7xen/shared";
import { prisma } from "../db.js";
import { AppError, conflict, notFound } from "../lib/errors.js";
import { dateToStr, playerSummarySelect, strToDate, toPlayerSummary } from "../lib/serialize.js";
import { startsAtOf } from "./schedule.js";

type Db = Prisma.TransactionClient | typeof prisma;
const TX_OPTS = { maxWait: 10_000, timeout: 15_000 };

// ---------------------------------------------------------------- messages (user-facing)
export const MSG = {
  NO_TEAM: "Create or join a team first.",
  LEADER_ONLY: "Only your team leader can do this — tap “Ask my leader” instead.",
  LEADER_ONLY_MANAGE: "Only your team leader can do this.",
  ALREADY_IN_TEAM: "You're already in a team. Leave it first to join another one.",
  OTHER_ALREADY_IN_TEAM: "This player has already joined another team.",
  TEAM_FULL: `This team is full (${MAX_TEAM_MEMBERS} players).`,
  BGMI_ID_REQUIRED: "Add your BGMI ID first. You can find it on your in-game profile.",
  BGMI_ID_TAKEN: "This BGMI ID is already linked to another account.",
  INVITE_INVALID: "This invite link doesn't work any more. Ask the team leader for a new one.",
  JOIN_REQUEST_PENDING: "You've already asked to join a team. Cancel that request first.",
  NAME_TAKEN: "That team name is already taken",
} as const;

export const noTeam = (status?: number) => new AppError("NO_TEAM", MSG.NO_TEAM, undefined, status);

const isUnique = (e: unknown): e is Prisma.PrismaClientKnownRequestError =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
const uniqueTarget = (e: Prisma.PrismaClientKnownRequestError) => String((e.meta as { target?: unknown } | undefined)?.target ?? "");

export function newInviteCode(): string {
  let s = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) s += INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)];
  return s;
}

/** Retry `fn` with fresh invite codes while it collides on Team.inviteCode (astronomically rare). */
async function withFreshCode<T>(fn: (code: string) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(newInviteCode());
    } catch (e) {
      if (attempt < 5 && isUnique(e) && uniqueTarget(e).includes("inviteCode")) continue;
      throw e;
    }
  }
}

// ---------------------------------------------------------------- team names

const TAKEN = "Already taken";
const result = (message: string | null): AvailabilityResult => ({ available: message === null, message });

/** Live availability (manager team search keeps this endpoint). Team names are unique via teamNameKey. */
export async function checkAvailability(q: TeamAvailabilityQuery, opts: { excludeTeamId?: string } = {}, db: Db = prisma): Promise<TeamAvailability> {
  const out: TeamAvailability = {};
  if (q.teamName) {
    const team = await db.team.findFirst({
      where: { nameKey: teamNameKey(q.teamName), ...(opts.excludeTeamId ? { id: { not: opts.excludeTeamId } } : {}) },
      select: { id: true },
    });
    out.teamName = result(team ? TAKEN : null);
  }
  if (q.username) {
    const user = await db.user.findUnique({ where: { username: q.username.toLowerCase() }, select: { id: true } });
    out.username = result(user ? TAKEN : null);
  }
  return out;
}

/** 409 CONFLICT with fields[field] when the team name is taken by another team. */
export async function assertTeamNameFree(name: string, field = "name", excludeTeamId?: string, db: Db = prisma) {
  const a = await checkAvailability({ teamName: name }, { excludeTeamId }, db);
  if (a.teamName && !a.teamName.available) throw new AppError("CONFLICT", MSG.NAME_TAKEN, { [field]: MSG.NAME_TAKEN });
}

// ---------------------------------------------------------------- membership helpers

/** The player's membership (team id + role), or null. */
export function membershipOf(userId: string, db: Db = prisma) {
  return db.teamMember.findUnique({ where: { userId }, select: { teamId: true, role: true } });
}

async function requireMembership(userId: string, status = 404) {
  const m = await membershipOf(userId);
  if (!m) throw noTeam(status);
  return m;
}

async function requireLeader(userId: string) {
  const m = await requireMembership(userId);
  if (m.role !== "LEADER") throw new AppError("LEADER_ONLY", MSG.LEADER_ONLY_MANAGE);
  return m;
}

const lockTeam = (tx: Prisma.TransactionClient, teamId: string) => tx.$queryRaw`SELECT id FROM "Team" WHERE id = ${teamId} FOR UPDATE`;

// ---------------------------------------------------------------- profile

async function pendingJoinRequest(userId: string): Promise<MyJoinRequest | null> {
  const r = await prisma.teamJoinRequest.findFirst({ where: { userId, status: "PENDING" }, include: joinRequestInclude });
  return r ? toMyJoinRequest(r) : null;
}

export async function getProfile(userId: string): Promise<PlayerProfile> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    include: { membership: { select: { role: true, team: { select: { id: true, name: true, tag: true } } } } },
  });
  if (!u) throw notFound("Player not found");
  return {
    ...toPlayerSummary(u),
    email: u.email,
    bgmiId: u.bgmiId,
    team: u.membership ? { ...u.membership.team, role: u.membership.role } : null,
    pendingJoinRequest: await pendingJoinRequest(userId),
    createdAt: u.createdAt.toISOString(),
  };
}

export async function updateProfile(userId: string, input: UpdatePlayerProfileInput): Promise<PlayerProfile> {
  const data: Prisma.UserUpdateInput = {};
  if (input.ign !== undefined) data.ign = input.ign;
  if (input.displayName !== undefined) data.displayName = input.displayName;
  if (input.bgmiId !== undefined) {
    if (input.bgmiId === "") {
      if (await membershipOf(userId)) {
        throw new AppError("CONFLICT", "You can't remove your BGMI ID while you're in a team", { bgmiId: "Needed while you're in a team" });
      }
      data.bgmiId = null;
    } else {
      const other = await prisma.user.findFirst({ where: { bgmiId: input.bgmiId, id: { not: userId } }, select: { id: true } });
      if (other) throw new AppError("BGMI_ID_TAKEN", MSG.BGMI_ID_TAKEN, { bgmiId: MSG.BGMI_ID_TAKEN });
      data.bgmiId = input.bgmiId;
    }
  }
  try {
    await prisma.user.update({ where: { id: userId }, data });
  } catch (e) {
    if (isUnique(e) && uniqueTarget(e).includes("bgmiId")) throw new AppError("BGMI_ID_TAKEN", MSG.BGMI_ID_TAKEN, { bgmiId: MSG.BGMI_ID_TAKEN });
    throw e;
  }
  return getProfile(userId);
}

async function requireBgmiId(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { bgmiId: true } });
  if (!u.bgmiId) throw new AppError("BGMI_ID_REQUIRED", MSG.BGMI_ID_REQUIRED, { bgmiId: "Required" });
}

// ---------------------------------------------------------------- team view

const memberUserSelect = { ...playerSummarySelect, bgmiId: true } satisfies Prisma.UserSelect;

export async function getPlayerTeam(teamId: string, viewerId: string): Promise<PlayerTeam> {
  const t = await prisma.team.findUnique({
    where: { id: teamId },
    include: {
      members: { include: { user: { select: memberUserSelect } }, orderBy: { joinedAt: "asc" } },
      joinRequests: { where: { status: "PENDING" }, include: { user: { select: memberUserSelect } }, orderBy: { createdAt: "asc" } },
      _count: { select: { suggestions: { where: { status: "OPEN" } } } },
    },
  });
  if (!t) throw noTeam(404);
  const me = t.members.find((m) => m.userId === viewerId);
  if (!me) throw noTeam(404);
  const leader = me.role === "LEADER";
  const members: TeamMemberRow[] = t.members
    .map((m) => ({ ...toPlayerSummary(m.user), bgmiId: m.user.bgmiId, role: m.role as TeamRole, joinedAt: m.joinedAt.toISOString() }))
    .sort((a, b) => (a.role === b.role ? 0 : a.role === "LEADER" ? -1 : 1));
  return {
    id: t.id,
    name: t.name,
    tag: t.tag,
    leaderId: t.leaderId,
    myRole: me.role,
    members,
    maxMembers: MAX_TEAM_MEMBERS,
    inviteCode: leader ? t.inviteCode : null,
    joinRequests: leader
      ? t.joinRequests.map((r) => ({
          id: r.id,
          player: { ...toPlayerSummary(r.user), bgmiId: r.user.bgmiId },
          message: r.message,
          createdAt: r.createdAt.toISOString(),
        }))
      : [],
    openSuggestions: t._count.suggestions,
    createdAt: t.createdAt.toISOString(),
  };
}

export async function myTeam(userId: string): Promise<PlayerTeam> {
  const m = await requireMembership(userId);
  return getPlayerTeam(m.teamId, userId);
}

// ---------------------------------------------------------------- create / update / disband

export async function createTeam(userId: string, input: CreatePlayerTeamInput): Promise<PlayerTeam> {
  await requireBgmiId(userId);
  if (await membershipOf(userId)) throw new AppError("ALREADY_IN_TEAM", MSG.ALREADY_IN_TEAM);
  await assertTeamNameFree(input.name);
  let teamId: string;
  try {
    teamId = await withFreshCode((inviteCode) =>
      prisma.$transaction(async (tx) => {
        const team = await tx.team.create({
          data: { name: input.name, nameKey: teamNameKey(input.name), tag: input.tag, leaderId: userId, inviteCode },
        });
        await tx.teamMember.create({ data: { teamId: team.id, userId, role: "LEADER" } });
        // a player who starts a team no longer wants to join another one
        await tx.teamJoinRequest.updateMany({ where: { userId, status: "PENDING" }, data: { status: "CANCELLED", decidedAt: new Date() } });
        return team.id;
      }, TX_OPTS),
    );
  } catch (e) {
    if (isUnique(e)) {
      const t = uniqueTarget(e);
      if (t.includes("nameKey")) throw new AppError("CONFLICT", MSG.NAME_TAKEN, { name: MSG.NAME_TAKEN });
      if (t.includes("leaderId") || t.includes("userId")) throw new AppError("ALREADY_IN_TEAM", MSG.ALREADY_IN_TEAM);
    }
    throw e;
  }
  return getPlayerTeam(teamId, userId);
}

export async function updateTeam(userId: string, input: UpdatePlayerTeamInput): Promise<PlayerTeam> {
  const m = await requireLeader(userId);
  if (input.name !== undefined) await assertTeamNameFree(input.name, "name", m.teamId);
  try {
    await prisma.team.update({
      where: { id: m.teamId },
      data: { name: input.name, nameKey: input.name !== undefined ? teamNameKey(input.name) : undefined, tag: input.tag },
    });
  } catch (e) {
    if (isUnique(e) && uniqueTarget(e).includes("nameKey")) throw new AppError("CONFLICT", MSG.NAME_TAKEN, { name: MSG.NAME_TAKEN });
    throw e;
  }
  return getPlayerTeam(m.teamId, userId);
}

/** Registrations (PENDING/APPROVED) whose session hasn't started yet. */
export async function countUpcomingTeamRegistrations(teamId: string, now = new Date()): Promise<number> {
  const regs = await prisma.registration.findMany({
    where: { teamId, status: { in: ["PENDING", "APPROVED"] }, session: { date: { gte: strToDate(todayInAppTz(now)) } } },
    select: { session: { select: { date: true, scrim: { select: { startTime: true } } } } },
  });
  return regs.filter((r) => startsAtOf(dateToStr(r.session.date), r.session.scrim.startTime) > now).length;
}

const ACTIVE_TOURNAMENT_STATUSES = ["DRAFT", "REGISTRATION_OPEN", "REGISTRATION_CLOSED", "LIVE"] as const;

async function countActiveEntries(teamId: string) {
  return prisma.tournamentEntry.count({
    where: { teamId, status: { in: ["CONFIRMED", "WAITLISTED"] }, tournament: { status: { in: [...ACTIVE_TOURNAMENT_STATUSES] } } },
  });
}

/** Delete a team (members become team-less). Refused while it has upcoming registrations (and, for players, active tournament entries). */
export async function deleteTeam(teamId: string, opts: { checkEntries: boolean }) {
  const regs = await countUpcomingTeamRegistrations(teamId);
  const entries = opts.checkEntries ? await countActiveEntries(teamId) : 0;
  if (regs > 0 || entries > 0) {
    throw conflict(
      regs > 0
        ? `This team has ${regs} upcoming scrim registration${regs === 1 ? "" : "s"}. Cancel ${regs === 1 ? "it" : "them"} first.`
        : "This team is still in a tournament. Withdraw from it first.",
    );
  }
  await prisma.team.delete({ where: { id: teamId } });
}

export async function disbandMyTeam(userId: string) {
  const m = await requireLeader(userId);
  await deleteTeam(m.teamId, { checkEntries: true });
}

export async function rotateInviteCode(userId: string): Promise<PlayerTeam> {
  const m = await requireLeader(userId);
  await withFreshCode((inviteCode) => prisma.team.update({ where: { id: m.teamId }, data: { inviteCode } }));
  return getPlayerTeam(m.teamId, userId);
}

// ---------------------------------------------------------------- members

export async function leaveTeam(userId: string) {
  const m = await requireMembership(userId);
  if (m.role === "LEADER") throw conflict("You're the team leader. Make someone else leader first, or disband the team.");
  await prisma.teamMember.delete({ where: { userId } });
}

export async function removeMember(userId: string, memberUserId: string): Promise<PlayerTeam> {
  const m = await requireLeader(userId);
  if (memberUserId === userId) throw conflict("You can't remove yourself. Make someone else leader first, or disband the team.");
  const res = await prisma.teamMember.deleteMany({ where: { teamId: m.teamId, userId: memberUserId, role: "MEMBER" } });
  if (res.count === 0) throw notFound("This player isn't in your team");
  return getPlayerTeam(m.teamId, userId);
}

export async function transferLeadership(userId: string, newLeaderId: string): Promise<PlayerTeam> {
  const m = await requireLeader(userId);
  if (newLeaderId === userId) throw conflict("You're already the leader");
  await prisma.$transaction(async (tx) => {
    await lockTeam(tx, m.teamId);
    const target = await tx.teamMember.findUnique({ where: { userId: newLeaderId }, select: { teamId: true } });
    if (!target || target.teamId !== m.teamId) throw notFound("This player isn't in your team");
    const team = await tx.team.findUniqueOrThrow({ where: { id: m.teamId }, select: { leaderId: true } });
    if (team.leaderId !== userId) throw new AppError("LEADER_ONLY", MSG.LEADER_ONLY_MANAGE);
    await tx.teamMember.update({ where: { userId }, data: { role: "MEMBER" } });
    await tx.teamMember.update({ where: { userId: newLeaderId }, data: { role: "LEADER" } });
    await tx.team.update({ where: { id: m.teamId }, data: { leaderId: newLeaderId } });
  }, TX_OPTS);
  return getPlayerTeam(m.teamId, userId);
}

// ---------------------------------------------------------------- join requests

const joinRequestInclude = { team: { select: { id: true, name: true, tag: true } } } satisfies Prisma.TeamJoinRequestInclude;
type JoinRequestWithTeam = Prisma.TeamJoinRequestGetPayload<{ include: typeof joinRequestInclude }>;
const toMyJoinRequest = (r: JoinRequestWithTeam): MyJoinRequest => ({
  id: r.id,
  status: r.status,
  team: r.team,
  message: r.message,
  createdAt: r.createdAt.toISOString(),
  decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
});

async function teamByCode(raw: string) {
  const code = normalizeInviteCode(raw);
  const team = code.length === INVITE_CODE_LENGTH ? await prisma.team.findUnique({ where: { inviteCode: code } }) : null;
  if (!team) throw new AppError("INVITE_INVALID", MSG.INVITE_INVALID);
  return team;
}

export async function invitePreview(rawCode: string): Promise<TeamInvitePreview> {
  const team = await teamByCode(rawCode);
  const [leader, memberCount] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: team.leaderId }, select: playerSummarySelect }),
    prisma.teamMember.count({ where: { teamId: team.id } }),
  ]);
  return {
    code: team.inviteCode,
    team: { id: team.id, name: team.name, tag: team.tag },
    leader: toPlayerSummary(leader),
    memberCount,
    maxMembers: MAX_TEAM_MEMBERS,
    full: memberCount >= MAX_TEAM_MEMBERS,
  };
}

export async function createJoinRequest(userId: string, code: string, message?: string): Promise<MyJoinRequest> {
  await requireBgmiId(userId);
  if (await membershipOf(userId)) throw new AppError("ALREADY_IN_TEAM", MSG.ALREADY_IN_TEAM);
  const team = await teamByCode(code);
  if (await prisma.teamJoinRequest.findFirst({ where: { userId, status: "PENDING" }, select: { id: true } })) {
    throw new AppError("JOIN_REQUEST_PENDING", MSG.JOIN_REQUEST_PENDING);
  }
  if ((await prisma.teamMember.count({ where: { teamId: team.id } })) >= MAX_TEAM_MEMBERS) throw new AppError("TEAM_FULL", MSG.TEAM_FULL);
  try {
    const r = await prisma.teamJoinRequest.create({ data: { teamId: team.id, userId, message: message || null }, include: joinRequestInclude });
    return toMyJoinRequest(r);
  } catch (e) {
    if (isUnique(e)) throw new AppError("JOIN_REQUEST_PENDING", MSG.JOIN_REQUEST_PENDING);
    throw e;
  }
}

export async function myJoinRequests(userId: string): Promise<MyJoinRequest[]> {
  const rows = await prisma.teamJoinRequest.findMany({ where: { userId }, include: joinRequestInclude, orderBy: { createdAt: "desc" }, take: 50 });
  return rows.map(toMyJoinRequest);
}

export async function cancelJoinRequest(userId: string, id: string) {
  const r = await prisma.teamJoinRequest.findUnique({ where: { id }, select: { userId: true, status: true } });
  if (!r || r.userId !== userId) throw notFound("Request not found");
  if (r.status !== "PENDING") throw conflict("This request was already answered");
  await prisma.teamJoinRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: "CANCELLED", decidedAt: new Date() } });
}

async function loadTeamRequest(leaderTeamId: string, id: string) {
  const r = await prisma.teamJoinRequest.findUnique({ where: { id }, select: { teamId: true } });
  if (!r || r.teamId !== leaderTeamId) throw notFound("Request not found");
}

export async function approveJoinRequest(userId: string, id: string): Promise<PlayerTeam> {
  const m = await requireLeader(userId);
  await loadTeamRequest(m.teamId, id);
  await prisma.$transaction(async (tx) => {
    await lockTeam(tx, m.teamId);
    const r = await tx.teamJoinRequest.findUniqueOrThrow({ where: { id } });
    if (r.status !== "PENDING") throw conflict(r.status === "CANCELLED" ? "The player cancelled this request" : "This request was already answered");
    if (await tx.teamMember.findUnique({ where: { userId: r.userId }, select: { id: true } })) {
      await tx.teamJoinRequest.update({ where: { id }, data: { status: "CANCELLED", decidedAt: new Date() } });
      throw new AppError("ALREADY_IN_TEAM", MSG.OTHER_ALREADY_IN_TEAM);
    }
    if ((await tx.teamMember.count({ where: { teamId: m.teamId } })) >= MAX_TEAM_MEMBERS) throw new AppError("TEAM_FULL", MSG.TEAM_FULL);
    await tx.teamMember.create({ data: { teamId: m.teamId, userId: r.userId, role: "MEMBER" } });
    await tx.teamJoinRequest.update({ where: { id }, data: { status: "APPROVED", decidedAt: new Date() } });
    await tx.teamJoinRequest.updateMany({ where: { userId: r.userId, status: "PENDING", id: { not: id } }, data: { status: "CANCELLED", decidedAt: new Date() } });
  }, TX_OPTS);
  return getPlayerTeam(m.teamId, userId);
}

export async function rejectJoinRequest(userId: string, id: string): Promise<PlayerTeam> {
  const m = await requireLeader(userId);
  await loadTeamRequest(m.teamId, id);
  const res = await prisma.teamJoinRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: "REJECTED", decidedAt: new Date() } });
  if (res.count === 0) throw conflict("This request was already answered");
  return getPlayerTeam(m.teamId, userId);
}
