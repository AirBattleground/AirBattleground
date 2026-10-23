/**
 * Team side of tournaments: list, hub detail with the team's own status ("me"), first-come-first-served
 * registration with a waitlist, preference changes and withdrawal.
 *
 * Concurrency: every entry change runs in a transaction that first takes a row lock on the Tournament
 * (SELECT … FOR UPDATE), so confirmed-count checks and waitlist promotion are serialised per tournament —
 * two teams racing for the last spot can never both be CONFIRMED.
 */
import type { Prisma } from "@prisma/client";
import type {
  MyTournamentState,
  MyTournamentStatus,
  RegisterTournamentInput,
  TeamTournamentDetail,
  TournamentSummary,
} from "@7xen/shared";
import { computeStandings, type GameMap, type TeamMatchResult } from "@7xen/shared";
import { prisma } from "../../db.js";
import { AppError, conflict, notFound } from "../../lib/errors.js";
import { iso } from "../../lib/serialize.js";
import { markSuggestionsDone } from "../suggestions.js";
import {
  TOURNAMENT_NOT_FOUND,
  TX_OPTS,
  entryInclude,
  loadTournament,
  lockTournament,
  promoteWaitlist,
  stageOneOptions,
  toDetail,
  toEntryRow,
  toSummaries,
  tournamentInclude,
  tournamentPoints,
  waitlistPosition,
  type TournamentFull,
} from "./core.js";

type TeamScope = "open" | "live" | "mine" | "completed" | "all";

async function loadVisible(id: string): Promise<TournamentFull> {
  const t = await loadTournament(id);
  if (!t || t.status === "DRAFT") throw notFound(TOURNAMENT_NOT_FOUND);
  return t;
}

export async function listForTeam(teamId: string | null, scope: TeamScope | undefined): Promise<TournamentSummary[]> {
  if (scope === "mine" && !teamId) return [];
  const where: Prisma.TournamentWhereInput = { status: { not: "DRAFT" } };
  if (scope === "open") where.status = "REGISTRATION_OPEN";
  else if (scope === "live") where.status = { in: ["REGISTRATION_CLOSED", "LIVE"] };
  else if (scope === "completed") where.status = "COMPLETED";
  else if (scope === "mine") where.entries = { some: { teamId: teamId!, status: { in: ["CONFIRMED", "WAITLISTED"] } } };
  else if (scope !== "all") where.status = { in: ["REGISTRATION_OPEN", "REGISTRATION_CLOSED", "LIVE"] };
  // registration windows close lazily; refresh the ones that just passed
  await prisma.tournament.updateMany({
    where: { status: "REGISTRATION_OPEN", registrationClosesAt: { lte: new Date() } },
    data: { status: "REGISTRATION_CLOSED" },
  });
  const list = await prisma.tournament.findMany({ where, include: tournamentInclude, orderBy: { createdAt: "desc" }, take: 200 });
  return toSummaries(list);
}

export async function teamTournamentDetail(teamId: string | null, id: string): Promise<TeamTournamentDetail> {
  const t = await loadVisible(id);
  return { ...(await toDetail(t)), me: await myStatus(t, teamId) };
}

// ---------------------------------------------------------------- registration rules

const fmt = (d: Date) =>
  d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Why registration is closed for everyone right now (null = open). */
function registrationClosedReason(t: TournamentFull, now = new Date()): string | null {
  if (t.status === "CANCELLED") return "This tournament was cancelled";
  if (t.status === "COMPLETED") return "This tournament is over";
  if (t.status === "LIVE" || (t.stages[0] && t.stages[0].status !== "PENDING")) return "Registration is closed — the tournament has started";
  if (t.status !== "REGISTRATION_OPEN") return "Registration is closed";
  if (t.registrationOpensAt && t.registrationOpensAt > now) return `Registration opens on ${fmt(t.registrationOpensAt)}`;
  if (t.registrationClosesAt && t.registrationClosesAt <= now) return "Registration is closed";
  return null;
}

function checkPreferences(t: TournamentFull, prefs: string[]) {
  const valid = new Set(stageOneOptions(t).map((o) => o.id));
  const seen = new Set<string>();
  prefs.forEach((p, i) => {
    if (!valid.has(p)) throw new AppError("VALIDATION_ERROR", "Pick time slots from the list", { [`timePreferences.${i}`]: "Not one of the time slots" });
    if (seen.has(p)) throw new AppError("VALIDATION_ERROR", "Each time slot can only be picked once", { [`timePreferences.${i}`]: "Picked twice" });
    seen.add(p);
  });
}

/** Tournaments (not TDM battles) need a full team: at least `teamSize` members. The reason it's blocked, or null. */
async function rosterShortReason(t: { mode: string; teamSize: number }, teamId: string): Promise<string | null> {
  if (t.mode === "TDM") return null;
  const n = await prisma.teamMember.count({ where: { teamId } });
  return n < t.teamSize
    ? `Tournaments need a full team of ${t.teamSize} players — yours has ${n}. Invite your players from the My team page, then register.`
    : null;
}

export async function registerForTournament(teamId: string, id: string, input: RegisterTournamentInput, registeredById: string | null = null): Promise<MyTournamentStatus> {
  const t = await loadVisible(id);
  const closed = registrationClosedReason(t);
  if (closed) throw new AppError("REGISTRATION_CLOSED", closed);
  const short = await rosterShortReason(t, teamId);
  if (short) throw new AppError("ROSTER_INCOMPLETE", short);
  checkPreferences(t, input.timePreferences);

  await prisma.$transaction(async (tx) => {
    await lockTournament(tx, id);
    const fresh = await tx.tournament.findUniqueOrThrow({ where: { id }, select: { status: true, maxTeams: true } });
    if (fresh.status !== "REGISTRATION_OPEN") throw new AppError("REGISTRATION_CLOSED", "Registration is closed");
    const existing = await tx.tournamentEntry.findUnique({ where: { tournamentId_teamId: { tournamentId: id, teamId } } });
    if (existing && (existing.status === "CONFIRMED" || existing.status === "WAITLISTED")) throw conflict("Your team is already registered for this tournament");
    if (existing?.status === "REMOVED") throw new AppError("FORBIDDEN", "The organiser removed your team from this tournament");
    const confirmed = await tx.tournamentEntry.count({ where: { tournamentId: id, type: "REGISTERED", status: "CONFIRMED" } });
    const waiting = await tx.tournamentEntry.count({ where: { tournamentId: id, status: "WAITLISTED" } });
    // FCFS: a spot only goes straight to a newcomer when nobody is queued ahead of them
    const status = confirmed < fresh.maxTeams && waiting === 0 ? "CONFIRMED" : "WAITLISTED";
    const data = { type: "REGISTERED" as const, status: status as "CONFIRMED" | "WAITLISTED", entryStage: 1, timePreferences: input.timePreferences, registeredAt: new Date(), registeredById };
    if (existing) await tx.tournamentEntry.update({ where: { id: existing.id }, data });
    else await tx.tournamentEntry.create({ data: { tournamentId: id, teamId, ...data } });
  }, TX_OPTS);
  await markSuggestionsDone(teamId, { tournamentId: id });
  return myStatus((await loadTournament(id))!, teamId);
}

export async function updatePreferences(teamId: string, id: string, input: RegisterTournamentInput): Promise<MyTournamentStatus> {
  const t = await loadVisible(id);
  const entry = await prisma.tournamentEntry.findUnique({ where: { tournamentId_teamId: { tournamentId: id, teamId } } });
  if (!entry || (entry.status !== "CONFIRMED" && entry.status !== "WAITLISTED")) throw notFound("Your team isn't registered for this tournament");
  if (entry.entryStage !== 1) throw conflict("Invited teams don't pick qualifier time slots");
  if (t.stages[0] && t.stages[0].status !== "PENDING") throw conflict("Groups are already drawn, so time preferences can't change");
  checkPreferences(t, input.timePreferences);
  await prisma.tournamentEntry.update({ where: { id: entry.id }, data: { timePreferences: input.timePreferences } });
  return myStatus(t, teamId);
}

export async function withdrawFromTournament(teamId: string, id: string): Promise<void> {
  await loadVisible(id);
  await prisma.$transaction(async (tx) => {
    await lockTournament(tx, id);
    const entry = await tx.tournamentEntry.findUnique({ where: { tournamentId_teamId: { tournamentId: id, teamId } } });
    if (!entry || (entry.status !== "CONFIRMED" && entry.status !== "WAITLISTED")) throw notFound("Your team isn't registered for this tournament");
    const stage = await tx.tournamentStage.findFirst({ where: { tournamentId: id, order: entry.entryStage }, select: { status: true, name: true } });
    if (stage && stage.status !== "PENDING") throw conflict(`The ${stage.name} groups are already drawn. Contact the organiser to withdraw.`);
    await tx.tournamentEntry.update({ where: { id: entry.id }, data: { status: "WITHDRAWN" } });
    await promoteWaitlist(tx, id);
  }, TX_OPTS);
}

// ---------------------------------------------------------------- "me"

const NONE: Omit<MyTournamentStatus, "state" | "canRegister" | "registerBlockedReason"> = {
  entry: null,
  stageOrder: null,
  groupName: null,
  slotNumber: null,
  groupRank: null,
  nextGoal: null,
  nextMatch: null,
  assignedSlot: null,
};

async function myStatus(t: TournamentFull, teamId: string | null): Promise<MyTournamentStatus> {
  if (!teamId) {
    // phase 5c: a player without a team browses; registering needs a team (the web asks them to create/join one)
    const closed = registrationClosedReason(t);
    return { ...NONE, entry: null, canRegister: !closed, registerBlockedReason: closed, rosterWarning: null, state: "NOT_REGISTERED", nextGoal: closed ? null : "Create or join a team to take part" };
  }
  const entry = await prisma.tournamentEntry.findUnique({ where: { tournamentId_teamId: { tournamentId: t.id, teamId } }, include: entryInclude });
  const closed = registrationClosedReason(t);
  const active = entry && (entry.status === "CONFIRMED" || entry.status === "WAITLISTED");
  const removed = entry?.status === "REMOVED";
  // a BR tournament needs a full team to register (TDM battles don't)
  const short = await rosterShortReason(t, teamId);
  const canRegister = !closed && !active && !removed && !short;
  const registerBlockedReason = active ? null : removed ? "The organiser removed your team from this tournament" : (closed ?? short);
  const entryRow = entry ? toEntryRow(entry, await waitlistPosition(entry)) : null;

  // a registered team that later lost players: still in, but warned (blocked teams see registerBlockedReason instead)
  const rosterWarning = active && short ? short.replace(", then register.", " before your first match.") : null;

  const base = { ...NONE, entry: entryRow, canRegister, registerBlockedReason, rosterWarning };
  const s1 = t.stages[0];

  if (!entry || entry.status === "WITHDRAWN" || removed) {
    return { ...base, state: entry?.status === "WITHDRAWN" ? "WITHDRAWN" : "NOT_REGISTERED", nextGoal: canRegister ? "Register your team to take part" : null };
  }
  if (entry.status === "WAITLISTED") {
    const pos = entryRow?.waitlistPosition ?? null;
    return {
      ...base,
      state: "WAITLISTED",
      stageOrder: 1,
      nextGoal: `You're #${pos ?? "?"} on the waitlist. You'll get a spot automatically if a team drops out before the draw.`,
    };
  }

  // CONFIRMED: where is the team now? (latest stage it was drawn into)
  const placements = await prisma.groupTeam.findMany({
    where: { teamId, group: { stage: { tournamentId: t.id } } },
    include: { group: { include: { stage: { select: { id: true, order: true } } } } },
  });
  placements.sort((a, b) => b.group.stage.order - a.group.stage.order);
  const gt = placements[0];
  const stage1Group = placements.find((p) => p.group.stage.order === 1);
  const assignedSlot = stage1Group?.group.slotId ?? null;

  if (t.championTeamId === teamId) {
    return { ...base, state: "CHAMPION", stageOrder: gt?.group.stage.order ?? null, groupName: gt?.group.name ?? null, slotNumber: gt?.slotNumber ?? null, assignedSlot, groupRank: 1, nextGoal: null };
  }

  if (!gt) {
    const entryStage = t.stages.find((s) => s.order === entry.entryStage);
    if (entry.type === "INVITED") {
      return { ...base, state: "INVITED", stageOrder: entry.entryStage, nextGoal: `You're invited straight into the ${entryStage?.name ?? `stage ${entry.entryStage}`}. Wait for the draw.` };
    }
    return {
      ...base,
      state: "CONFIRMED",
      stageOrder: 1,
      nextGoal: `You're in! Groups for the ${s1?.name ?? "first stage"} are drawn after registration closes.`,
    };
  }

  const stage = t.stages.find((s) => s.id === gt.group.stage.id)!;
  const next = t.stages.find((s) => s.order === stage.order + 1) ?? null;
  const groupRank = await rankInGroup(t, gt.groupId, teamId);
  const where = { stageOrder: stage.order, groupName: gt.group.name, slotNumber: gt.slotNumber, groupRank, assignedSlot };

  // invited into a later stage that isn't drawn yet, while an earlier placement exists? (not possible: invites skip earlier stages)
  let state: MyTournamentState;
  let nextGoal: string | null = null;
  if (gt.status === "DISQUALIFIED") {
    state = "DISQUALIFIED";
    nextGoal = gt.dqReason ? `Disqualified: ${gt.dqReason}` : null;
  } else if (gt.status === "ELIMINATED") {
    state = "ELIMINATED";
    nextGoal = `Knocked out in the ${stage.name} (Group ${gt.group.name}). Thanks for playing — check the results to see how you did.`;
  } else if (gt.status === "ADVANCED") {
    state = next ? "QUALIFIED" : "CHAMPION";
    nextGoal = next ? `You're through to the ${next.name}. Wait for the draw.` : null;
  } else {
    state = "PLAYING";
    if (!next) nextGoal = `Finish first in the ${stage.name} to become the champion`;
    else {
      const parts: string[] = [];
      if (stage.advancePerGroup > 0) parts.push(`Finish in the top ${stage.advancePerGroup} of Group ${gt.group.name} to reach the ${next.name}`);
      if (stage.wildcardCount > 0) {
        parts.push(
          stage.advancePerGroup > 0
            ? `or be one of the ${stage.wildcardCount} best wildcard${stage.wildcardCount === 1 ? "" : "s"}`
            : `Be one of the ${stage.wildcardCount} best teams by points per match to reach the ${next.name}`,
        );
      }
      nextGoal = parts.join(" ") || null;
    }
  }

  let nextMatch: MyTournamentStatus["nextMatch"] = null;
  if (state === "PLAYING") {
    const m = await prisma.match.findFirst({ where: { groupId: gt.groupId, status: { not: "PUBLISHED" } }, orderBy: { number: "asc" } });
    if (m) nextMatch = { matchId: m.id, number: m.number, map: m.map as GameMap, scheduledAt: iso(m.scheduledAt), groupName: gt.group.name };
  }
  return { ...base, ...where, state, nextGoal, nextMatch };
}

/** Team's current rank in its group (published matches only; null before any result). */
async function rankInGroup(t: TournamentFull, groupId: string, teamId: string): Promise<number | null> {
  const rows = await prisma.matchTeam.findMany({
    where: { match: { groupId, status: "PUBLISHED" }, teamId: { not: null }, placement: { not: null } },
    select: { teamId: true, placement: true, kills: true, match: { select: { number: true } } },
  });
  const members = new Set(
    (await prisma.groupTeam.findMany({ where: { groupId, status: { not: "DISQUALIFIED" } }, select: { teamId: true } })).map((x) => x.teamId),
  );
  const results: TeamMatchResult[] = rows
    .filter((r) => members.has(r.teamId!))
    .map((r) => ({ teamId: r.teamId!, matchNumber: r.match.number, placement: r.placement!, kills: r.kills ?? 0 }));
  const st = computeStandings(tournamentPoints(t), results);
  return st.find((r) => r.teamId === teamId)?.rank ?? null;
}
