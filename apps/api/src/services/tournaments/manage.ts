/** Manager/admin tournament management: create/update, publish, registration lifecycle, entries, invites, schedules. */
import { Prisma } from "@prisma/client";
import type {
  CreateTournamentInput,
  InviteTeamInput,
  ManagerTournamentDetail,
  ScheduleConfig,
  StageSpec,
  TournamentEntryRow,
  TournamentSummary,
  UpdateTournamentInput,
} from "@7xen/shared";
import { prisma } from "../../db.js";
import { AppError, conflict, notFound } from "../../lib/errors.js";
import { storeMatchPoints } from "../standings.js";
import {
  TX_OPTS,
  assertNotFinished,
  entryInclude,
  formatIssues,
  loadManaged,
  lockTournament,
  planFor,
  plannedSizes,
  promoteWaitlist,
  scheduleOf,
  specOf,
  stageOf,
  toEntryRow,
  toManagerDetail,
  toSummaries,
  tournamentInclude,
  tournamentPoints,
  type Actor,
  type TournamentFull,
} from "./core.js";

const stageData = (s: StageSpec, order: number) => ({
  order,
  name: s.name,
  teamsIn: s.teamsIn,
  lobbySize: s.lobbySize,
  groupCount: s.groupCount,
  matchesPerGroup: s.matchesPerGroup,
  maps: s.maps,
  advancePerGroup: s.advancePerGroup,
  wildcardCount: s.wildcardCount,
  invitedSlots: s.invitedSlots,
  schedule: jsonOrNull(s.schedule),
});

/** Prisma needs DbNull for a SQL NULL in a Json? column. */
const jsonOrNull = (v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull => (v == null ? Prisma.DbNull : (v as Prisma.InputJsonValue));

function checkWindow(opens: Date | null | undefined, closes: Date | null | undefined) {
  if (opens && closes && closes <= opens) {
    throw new AppError("VALIDATION_ERROR", "Registration must close after it opens", { registrationClosesAt: "Must be after the opening time" });
  }
}

const toDate = (s: string | undefined) => (s ? new Date(s) : undefined);

// ---------------------------------------------------------------- list / get / create / update

export async function listTournaments(actor: Actor): Promise<TournamentSummary[]> {
  const list = await prisma.tournament.findMany({
    where: actor.admin ? {} : { managerId: actor.userId },
    include: tournamentInclude,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return toSummaries(list);
}

export async function getTournament(id: string, actor: Actor): Promise<ManagerTournamentDetail> {
  return toManagerDetail(await loadManaged(id, actor));
}

export async function createTournament(actor: Actor, input: CreateTournamentInput): Promise<ManagerTournamentDetail> {
  const opens = toDate(input.registrationOpensAt);
  const closes = toDate(input.registrationClosesAt);
  checkWindow(opens, closes);
  const t = await prisma.tournament.create({
    data: {
      managerId: actor.userId,
      title: input.title,
      description: input.description ?? null,
      rules: input.rules ?? null,
      prize: input.prize ?? null,
      teamSize: input.teamSize,
      firstSlot: input.firstSlot,
      maxTeams: input.maxTeams,
      registrationOpensAt: opens ?? null,
      registrationClosesAt: closes ?? null,
      pointsSystem: jsonOrNull(input.pointsSystem),
      stages: { create: input.stages.map((s, i) => stageData(s as StageSpec, i + 1)) },
    },
  });
  return getTournament(t.id, { ...actor, admin: true });
}

/** Format fields that freeze once the tournament is published (schedules are handled separately). */
const FORMAT_KEYS = ["name", "teamsIn", "lobbySize", "groupCount", "matchesPerGroup", "maps", "advancePerGroup", "wildcardCount", "invitedSlots"] as const;
const sameFormat = (a: StageSpec, b: StageSpec) => FORMAT_KEYS.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));

export async function updateTournament(id: string, actor: Actor, input: UpdateTournamentInput): Promise<ManagerTournamentDetail> {
  const t = await loadManaged(id, actor);
  assertNotFinished(t);
  const draft = t.status === "DRAFT";

  const formatChange =
    (input.maxTeams !== undefined && input.maxTeams !== t.maxTeams) ||
    (input.teamSize !== undefined && input.teamSize !== t.teamSize) ||
    (input.firstSlot !== undefined && input.firstSlot !== t.firstSlot);
  if (formatChange && !draft) throw conflict("Team limits and slots can't be changed after publishing");

  const scheduleUpdates: { stageId: string; schedule: ScheduleConfig | null }[] = [];
  if (input.stages) {
    if (!draft) {
      const current = t.stages.map(specOf);
      const incoming = input.stages as StageSpec[];
      if (incoming.length !== current.length || incoming.some((s, i) => !sameFormat(s, current[i]!))) {
        throw conflict("The format can't be changed after publishing");
      }
      incoming.forEach((s, i) => {
        const stage = t.stages[i]!;
        if (JSON.stringify(s.schedule ?? null) === JSON.stringify(scheduleOf(stage.schedule))) return;
        if (stage.status !== "PENDING") throw conflict(`The ${stage.name} is already drawn. Use the stage schedule screen to change its times.`);
        scheduleUpdates.push({ stageId: stage.id, schedule: s.schedule ?? null });
      });
    }
  }

  const opens = input.registrationOpensAt !== undefined ? toDate(input.registrationOpensAt) : t.registrationOpensAt;
  const closes = input.registrationClosesAt !== undefined ? toDate(input.registrationClosesAt) : t.registrationClosesAt;
  checkWindow(opens, closes);

  const pointsChanged = input.pointsSystem !== undefined && JSON.stringify(input.pointsSystem) !== JSON.stringify(tournamentPoints(t));

  await prisma.$transaction(async (tx) => {
    await tx.tournament.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.rules !== undefined ? { rules: input.rules ?? null } : {}),
        ...(input.prize !== undefined ? { prize: input.prize ?? null } : {}),
        ...(input.teamSize !== undefined ? { teamSize: input.teamSize } : {}),
        ...(input.firstSlot !== undefined ? { firstSlot: input.firstSlot } : {}),
        ...(input.maxTeams !== undefined ? { maxTeams: input.maxTeams } : {}),
        ...(input.registrationOpensAt !== undefined ? { registrationOpensAt: opens ?? null } : {}),
        ...(input.registrationClosesAt !== undefined ? { registrationClosesAt: closes ?? null } : {}),
        ...(input.pointsSystem !== undefined ? { pointsSystem: jsonOrNull(input.pointsSystem) } : {}),
      },
    });
    if (input.stages && draft) {
      await tx.tournamentStage.deleteMany({ where: { tournamentId: id } });
      await tx.tournamentStage.createMany({
        data: input.stages.map((s, i) => ({ tournamentId: id, ...stageData(s as StageSpec, i + 1) })),
      });
    }
    for (const u of scheduleUpdates) await tx.tournamentStage.update({ where: { id: u.stageId }, data: { schedule: jsonOrNull(u.schedule) } });
  }, TX_OPTS);

  if (pointsChanged) await recomputeTournamentPoints(id);
  return getTournament(id, actor);
}

/** After a points-system change: recompute stored points of every published group match. */
async function recomputeTournamentPoints(id: string) {
  const t = await prisma.tournament.findUniqueOrThrow({ where: { id }, select: { pointsSystem: true } });
  const ps = tournamentPoints(t);
  const matches = await prisma.match.findMany({ where: { status: "PUBLISHED", group: { stage: { tournamentId: id } } }, select: { id: true } });
  for (const m of matches) await prisma.$transaction((tx) => storeMatchPoints(tx, m.id, ps));
}

// ---------------------------------------------------------------- lifecycle

export async function publishTournament(id: string, actor: Actor): Promise<ManagerTournamentDetail> {
  const t = await loadManaged(id, actor);
  if (t.status !== "DRAFT") throw conflict("This tournament is already published");
  const errors = formatIssues(t).filter((i) => i.level === "error");
  if (errors.length) {
    const where = errors[0]!.stage != null ? `${t.stages[errors[0]!.stage]?.name ?? `Stage ${errors[0]!.stage + 1}`}: ` : "";
    throw new AppError("VALIDATION_ERROR", `Fix the format first. ${where}${errors[0]!.message}`);
  }
  const s1 = t.stages[0]!;
  const spec = specOf(s1);
  if (!spec.schedule) throw new AppError("VALIDATION_ERROR", `Set the ${s1.name} schedule before publishing, so teams can pick their time slots`);
  const plan = planFor(spec, plannedSizes(s1));
  if (plan && plan.unscheduledGroups.length) {
    const tip = plan.suggestions[0] ? ` ${plan.suggestions[0]}` : "";
    throw new AppError("VALIDATION_ERROR", `The ${s1.name} schedule doesn't fit all ${s1.groupCount} groups.${tip}`);
  }
  await prisma.tournament.update({ where: { id }, data: { status: "REGISTRATION_OPEN" } });
  return getTournament(id, actor);
}

export async function closeRegistration(id: string, actor: Actor): Promise<ManagerTournamentDetail> {
  const t = await loadManaged(id, actor);
  if (t.status !== "REGISTRATION_OPEN") throw conflict("Registration isn't open");
  await prisma.tournament.update({ where: { id }, data: { status: "REGISTRATION_CLOSED" } });
  return getTournament(id, actor);
}

export async function reopenRegistration(id: string, actor: Actor): Promise<ManagerTournamentDetail> {
  const t = await loadManaged(id, actor);
  if (t.status !== "REGISTRATION_CLOSED") throw conflict("Registration isn't closed");
  if (t.stages[0] && t.stages[0].status !== "PENDING") throw conflict("Groups are already drawn, so registration can't reopen");
  const closesPassed = t.registrationClosesAt && t.registrationClosesAt.getTime() <= Date.now();
  await prisma.tournament.update({
    where: { id },
    data: { status: "REGISTRATION_OPEN", ...(closesPassed ? { registrationClosesAt: null } : {}) },
  });
  return getTournament(id, actor);
}

export async function cancelTournament(id: string, actor: Actor): Promise<ManagerTournamentDetail> {
  const t = await loadManaged(id, actor);
  assertNotFinished(t);
  await prisma.tournament.update({ where: { id }, data: { status: "CANCELLED" } });
  return getTournament(id, actor);
}

export async function completeTournament(id: string, actor: Actor): Promise<ManagerTournamentDetail> {
  const t = await loadManaged(id, actor);
  assertNotFinished(t);
  const last = t.stages[t.stages.length - 1];
  if (!last || last.status !== "COMPLETED") throw conflict(`Finish the ${last?.name ?? "final"} and confirm its results first`);
  let championTeamId = t.championTeamId;
  if (!championTeamId) {
    const top = await prisma.groupTeam.findFirst({
      where: { group: { stageId: last.id }, status: { not: "DISQUALIFIED" }, finalRank: { not: null } },
      orderBy: { finalRank: "asc" },
      select: { teamId: true },
    });
    championTeamId = top?.teamId ?? null;
  }
  await prisma.tournament.update({ where: { id }, data: { status: "COMPLETED", championTeamId } });
  return getTournament(id, actor);
}

// ---------------------------------------------------------------- entries + invites

export async function listEntries(id: string, actor: Actor): Promise<TournamentEntryRow[]> {
  await loadManaged(id, actor);
  const rows = await prisma.tournamentEntry.findMany({ where: { tournamentId: id }, include: entryInclude, orderBy: [{ registeredAt: "asc" }, { id: "asc" }] });
  const rank: Record<string, number> = { CONFIRMED: 0, WAITLISTED: 1, WITHDRAWN: 2, REMOVED: 3 };
  let pos = 0;
  const withPos = rows.map((e) => toEntryRow(e, e.status === "WAITLISTED" ? ++pos : null));
  return withPos.sort((a, b) => rank[a.status]! - rank[b.status]! || a.entryStage - b.entryStage);
}

export async function removeEntry(id: string, actor: Actor, entryId: string): Promise<void> {
  const t = await loadManaged(id, actor);
  assertNotFinished(t);
  await prisma.$transaction(async (tx) => {
    await lockTournament(tx, id);
    const e = await tx.tournamentEntry.findFirst({ where: { id: entryId, tournamentId: id } });
    if (!e) throw notFound("Entry not found");
    if (e.status === "WITHDRAWN" || e.status === "REMOVED") return;
    await tx.tournamentEntry.update({ where: { id: e.id }, data: { status: "REMOVED" } });
    // already placed in a group that's still running → disqualify there
    await tx.groupTeam.updateMany({
      where: { teamId: e.teamId, status: "ACTIVE", group: { stage: { tournamentId: id, status: { in: ["DRAWN", "LIVE"] } } } },
      data: { status: "DISQUALIFIED", dqReason: "Removed by the organiser" },
    });
    await promoteWaitlist(tx, id);
  }, TX_OPTS);
}

export async function inviteTeam(id: string, actor: Actor, input: InviteTeamInput): Promise<TournamentEntryRow> {
  const t = await loadManaged(id, actor);
  assertNotFinished(t);
  const stage = t.stages.find((s) => s.order === input.stageOrder);
  if (!stage) throw new AppError("VALIDATION_ERROR", `This tournament has no stage ${input.stageOrder}`, { stageOrder: "No such stage" });
  if (stage.status !== "PENDING") throw conflict(`The ${stage.name} is already drawn`);
  if (stage.invitedSlots <= 0) throw conflict(`The ${stage.name} has no invite slots`);
  const team = await prisma.team.findUnique({ where: { id: input.teamId }, select: { id: true } });
  if (!team) throw new AppError("VALIDATION_ERROR", "Team not found", { teamId: "Team not found" });

  const entry = await prisma.$transaction(async (tx) => {
    await lockTournament(tx, id);
    const used = await tx.tournamentEntry.count({ where: { tournamentId: id, type: "INVITED", status: "CONFIRMED", entryStage: stage.order } });
    if (used >= stage.invitedSlots) throw conflict(`All ${stage.invitedSlots} invite slot${stage.invitedSlots === 1 ? "" : "s"} of the ${stage.name} are used`);
    const existing = await tx.tournamentEntry.findUnique({ where: { tournamentId_teamId: { tournamentId: id, teamId: team.id } } });
    if (existing && existing.status === "CONFIRMED") throw conflict("This team is already in the tournament");
    const data = { type: "INVITED" as const, status: "CONFIRMED" as const, entryStage: stage.order, timePreferences: [], registeredAt: new Date() };
    const row = existing
      ? await tx.tournamentEntry.update({ where: { id: existing.id }, data, include: entryInclude })
      : await tx.tournamentEntry.create({ data: { tournamentId: id, teamId: team.id, ...data }, include: entryInclude });
    // an invited team leaves the waitlist; nothing to promote (invites don't use registration spots)
    return row;
  }, TX_OPTS);
  return toEntryRow(entry);
}

// ---------------------------------------------------------------- schedules

/** Store a stage's schedule; once drawn, re-time its groups and unplayed matches from the new plan. */
export async function setStageSchedule(id: string, actor: Actor, stageId: string, config: ScheduleConfig): Promise<TournamentFull> {
  const t = await loadManaged(id, actor);
  assertNotFinished(t);
  const stage = stageOf(t, stageId);
  if (stage.status !== "PENDING" && stage.status !== "DRAWN") throw conflict(`The ${stage.name} has started, so its schedule is fixed. Reschedule single matches instead.`);
  await prisma.$transaction(async (tx) => {
    await tx.tournamentStage.update({ where: { id: stageId }, data: { schedule: config as unknown as Prisma.InputJsonValue } });
    if (stage.status === "DRAWN") {
      const plan = planFor({ ...specOf(stage), schedule: config }, plannedSizes(stage));
      const groups = await tx.tournamentGroup.findMany({ where: { stageId }, include: { matches: true } });
      for (const g of groups) {
        const block = plan?.blocks.find((b) => b.groupIndex === g.index) ?? null;
        const option = plan?.slotOptions.find((o) => o.groupIndexes.includes(g.index)) ?? null;
        await tx.tournamentGroup.update({
          where: { id: g.id },
          data: { lobbyIndex: block?.lobbyIndex ?? null, slotId: option?.id ?? null, startsAt: block?.matches[0] ? new Date(block.matches[0].start) : null },
        });
        for (const m of g.matches) {
          if (m.status === "PUBLISHED") continue;
          const sm = block?.matches.find((x) => x.number === m.number);
          await tx.match.update({ where: { id: m.id }, data: { scheduledAt: sm ? new Date(sm.start) : null, lobbyIndex: block?.lobbyIndex ?? null } });
        }
      }
    }
  }, TX_OPTS);
  return loadManaged(id, actor);
}
