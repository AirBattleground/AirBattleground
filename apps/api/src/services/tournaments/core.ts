/**
 * Tournaments (phase 3) — shared building blocks: who may act, loading + row locks, stage specs and plans,
 * DTO mappers and the control center's "next action". Plan: docs/phase3/TOURNAMENTS.md.
 * Pure algorithms live in @7xen/shared (tournament/engine.ts); this layer only feeds them stored data.
 */
import type { Prisma, TournamentStage } from "@prisma/client";
import {
  DEFAULT_POINTS_SYSTEM,
  groupSizes,
  planSchedule,
  scheduleConfigSchema,
  teamsOut,
  validateFormat,
  type FormatIssue,
  type GameMap,
  type ManagerActionKey,
  type ManagerTournamentDetail,
  type PointsSystem,
  type ScheduleConfig,
  type SchedulePlan,
  type StageSpec,
  type StageSummary,
  type TimeSlotOption,
  type TournamentDetail,
  type TournamentEntryRow,
  type TournamentSummary,
} from "@7xen/shared";
import { prisma, type Tx } from "../../db.js";
import { AppError, notFound } from "../../lib/errors.js";
import { iso, pointsSystemOf, teamSelect, toTeamSummary } from "../../lib/serialize.js";

export const TOURNAMENT_NOT_FOUND = "Tournament not found";

/** The user acting on a tournament. Admins bypass ownership (and are recorded as the actor). */
export interface Actor {
  userId: string;
  admin: boolean;
}

// ---------------------------------------------------------------- loading + locks

export const tournamentInclude = {
  manager: { select: { id: true, displayName: true } },
  champion: { select: teamSelect },
  stages: {
    orderBy: { order: "asc" },
    include: { groups: { orderBy: { index: "asc" }, select: { id: true, index: true, slotId: true, _count: { select: { teams: true } } } } },
  },
} satisfies Prisma.TournamentInclude;
export type TournamentFull = Prisma.TournamentGetPayload<{ include: typeof tournamentInclude }>;
export type StageWithGroups = TournamentFull["stages"][number];

/** Registration auto-closes at registrationClosesAt (applied lazily whenever a tournament is read). */
async function syncRegistrationWindow(t: { id: string; status: string; registrationClosesAt: Date | null }) {
  if (t.status === "REGISTRATION_OPEN" && t.registrationClosesAt && t.registrationClosesAt.getTime() <= Date.now()) {
    await prisma.tournament.updateMany({ where: { id: t.id, status: "REGISTRATION_OPEN" }, data: { status: "REGISTRATION_CLOSED" } });
    return true;
  }
  return false;
}

export async function loadTournament(id: string): Promise<TournamentFull | null> {
  const t = await prisma.tournament.findUnique({ where: { id }, include: tournamentInclude });
  if (t && (await syncRegistrationWindow(t))) return prisma.tournament.findUnique({ where: { id }, include: tournamentInclude });
  return t;
}

/** Read inside a transaction (no lazy status sync, sees the transaction's own writes). */
export const loadTournamentTx = (tx: Tx, id: string) => tx.tournament.findUniqueOrThrow({ where: { id }, include: tournamentInclude });

/** Tournament the actor may manage (404 otherwise — never reveal other managers' tournaments). */
export async function loadManaged(id: string, actor: Actor): Promise<TournamentFull> {
  const t = await loadTournament(id);
  if (!t || (!actor.admin && t.managerId !== actor.userId)) throw notFound(TOURNAMENT_NOT_FOUND);
  return t;
}

/** Serialises every entry/draw change of one tournament (FCFS registration, waitlist promotion, draws). */
export const lockTournament = (tx: Tx, id: string) => tx.$queryRaw`SELECT id FROM "Tournament" WHERE id = ${id} FOR UPDATE`;

export const TX_OPTS = { maxWait: 10_000, timeout: 30_000 } as const;

export function stageOf(t: TournamentFull, stageId: string): StageWithGroups {
  const s = t.stages.find((x) => x.id === stageId);
  if (!s) throw notFound("Stage not found");
  return s;
}

// ---------------------------------------------------------------- specs, schedule, plan

export function scheduleOf(raw: Prisma.JsonValue | null | undefined): ScheduleConfig | null {
  if (raw == null) return null;
  const r = scheduleConfigSchema.safeParse(raw);
  return r.success ? (r.data as ScheduleConfig) : null;
}

export function specOf(s: TournamentStage): StageSpec {
  return {
    name: s.name,
    teamsIn: s.teamsIn,
    lobbySize: s.lobbySize,
    groupCount: s.groupCount,
    matchesPerGroup: s.matchesPerGroup,
    maps: s.maps as GameMap[],
    advancePerGroup: s.advancePerGroup,
    wildcardCount: s.wildcardCount,
    invitedSlots: s.invitedSlots,
    schedule: scheduleOf(s.schedule),
  };
}

export const tournamentPoints = (t: { pointsSystem: Prisma.JsonValue | null }): PointsSystem =>
  t.pointsSystem == null ? { placement: [...DEFAULT_POINTS_SYSTEM.placement], killPoints: DEFAULT_POINTS_SYSTEM.killPoints } : pointsSystemOf(t.pointsSystem);

/** Group sizes the stage plays with: the real groups once drawn, otherwise the planned balanced split. */
export function plannedSizes(s: StageWithGroups): number[] {
  if (s.groups.length) return s.groups.map((g) => g._count.teams);
  return groupSizes(s.teamsIn, s.groupCount);
}

export function planFor(spec: StageSpec, sizes: number[]): SchedulePlan | null {
  if (!spec.schedule || !sizes.length) return null;
  return planSchedule(spec.schedule, sizes, spec.matchesPerGroup, spec.maps);
}

export const stagePlan = (s: StageWithGroups): SchedulePlan | null => planFor(specOf(s), plannedSizes(s));

/** Stage-1 time slots teams pick from when registering. */
export function stageOneOptions(t: TournamentFull): TimeSlotOption[] {
  const s1 = t.stages[0];
  if (!s1) return [];
  return stagePlan(s1)?.slotOptions ?? [];
}

// ---------------------------------------------------------------- DTO mappers

type StageTimes = Map<string, { first: Date | null; last: Date | null }>;

/** First/last scheduled match per drawn stage (actual times beat the plan once matches exist). */
async function stageTimes(stageIds: string[]): Promise<StageTimes> {
  const out: StageTimes = new Map();
  if (!stageIds.length) return out;
  const rows = await prisma.match.groupBy({
    by: ["groupId"],
    where: { group: { stageId: { in: stageIds } }, scheduledAt: { not: null } },
    _min: { scheduledAt: true },
    _max: { scheduledAt: true },
  });
  const groupStage = new Map(
    (await prisma.tournamentGroup.findMany({ where: { stageId: { in: stageIds } }, select: { id: true, stageId: true } })).map((g) => [g.id, g.stageId]),
  );
  for (const r of rows) {
    const sid = groupStage.get(r.groupId!);
    if (!sid) continue;
    const cur = out.get(sid) ?? { first: null, last: null };
    if (r._min.scheduledAt && (!cur.first || r._min.scheduledAt < cur.first)) cur.first = r._min.scheduledAt;
    if (r._max.scheduledAt && (!cur.last || r._max.scheduledAt > cur.last)) cur.last = r._max.scheduledAt;
    out.set(sid, cur);
  }
  return out;
}

export function toStageSummary(s: StageWithGroups, isLast: boolean, times?: StageTimes): StageSummary {
  const spec = specOf(s);
  const plan = planFor(spec, plannedSizes(s));
  const minutes = spec.schedule?.matchMinutes ?? 40;
  let startsAt: string | null = null;
  let endsAt: string | null = null;
  const actual = times?.get(s.id);
  if (actual?.first) {
    startsAt = actual.first.toISOString();
    endsAt = actual.last ? new Date(actual.last.getTime() + minutes * 60_000).toISOString() : null;
  } else if (plan?.blocks.length) {
    const starts = plan.blocks.map((b) => new Date(b.matches[0]?.start ?? b.start).getTime());
    const ends = plan.blocks.map((b) => {
      const lastMatch = b.matches[b.matches.length - 1];
      return lastMatch ? new Date(lastMatch.start).getTime() + minutes * 60_000 : new Date(b.end).getTime();
    });
    startsAt = new Date(Math.min(...starts)).toISOString();
    endsAt = new Date(Math.max(...ends)).toISOString();
  }
  return {
    id: s.id,
    order: s.order,
    status: s.status,
    name: spec.name,
    teamsIn: spec.teamsIn,
    lobbySize: spec.lobbySize,
    groupCount: spec.groupCount,
    matchesPerGroup: spec.matchesPerGroup,
    maps: spec.maps,
    advancePerGroup: spec.advancePerGroup,
    wildcardCount: spec.wildcardCount,
    invitedSlots: spec.invitedSlots,
    teamsOut: teamsOut(spec, isLast),
    schedule: spec.schedule,
    plan,
    startsAt,
    endsAt,
    drawSeed: s.drawSeed,
  };
}

/** Stage the tournament is on: first not COMPLETED, else the last one. */
export function currentStage(t: TournamentFull): StageWithGroups | null {
  return t.stages.find((s) => s.status !== "COMPLETED") ?? t.stages[t.stages.length - 1] ?? null;
}

type Counts = Map<string, { confirmed: number; waitlist: number }>;

async function entryCounts(ids: string[]): Promise<Counts> {
  const rows = await prisma.tournamentEntry.groupBy({
    by: ["tournamentId", "status"],
    where: { tournamentId: { in: ids }, type: "REGISTERED", status: { in: ["CONFIRMED", "WAITLISTED"] } },
    _count: { _all: true },
  });
  const out: Counts = new Map();
  for (const r of rows) {
    const c = out.get(r.tournamentId) ?? { confirmed: 0, waitlist: 0 };
    if (r.status === "CONFIRMED") c.confirmed = r._count._all;
    else c.waitlist = r._count._all;
    out.set(r.tournamentId, c);
  }
  return out;
}

function summaryOf(t: TournamentFull, counts: Counts, times: StageTimes): TournamentSummary {
  const c = counts.get(t.id) ?? { confirmed: 0, waitlist: 0 };
  const cur = currentStage(t);
  const first = t.stages[0];
  const firstSummary = first ? toStageSummary(first, t.stages.length === 1, times) : null;
  return {
    id: t.id,
    title: t.title,
    prize: t.prize,
    status: t.status,
    maxTeams: t.maxTeams,
    confirmedCount: c.confirmed,
    waitlistCount: c.waitlist,
    registrationOpensAt: iso(t.registrationOpensAt),
    registrationClosesAt: iso(t.registrationClosesAt),
    startsAt: firstSummary?.startsAt ?? null,
    stagesCount: t.stages.length,
    currentStage: cur ? { order: cur.order, name: cur.name, status: cur.status } : null,
    manager: t.manager,
    champion: t.champion ? toTeamSummary(t.champion) : null,
    createdAt: t.createdAt.toISOString(),
  };
}

export async function toSummaries(list: TournamentFull[]): Promise<TournamentSummary[]> {
  const ids = list.map((t) => t.id);
  const stageIds = list.flatMap((t) => (t.stages[0] && t.stages[0].status !== "PENDING" ? [t.stages[0].id] : []));
  const [counts, times] = await Promise.all([entryCounts(ids), stageTimes(stageIds)]);
  return list.map((t) => summaryOf(t, counts, times));
}

export async function toDetail(t: TournamentFull): Promise<TournamentDetail> {
  const drawn = t.stages.filter((s) => s.status !== "PENDING").map((s) => s.id);
  const [counts, times] = await Promise.all([entryCounts([t.id]), stageTimes(drawn)]);
  const options = stageOneOptions(t);
  const taken = await slotTaken(t, options);
  return {
    ...summaryOf(t, counts, times),
    description: t.description,
    rules: t.rules,
    teamSize: t.teamSize,
    firstSlot: t.firstSlot,
    pointsSystem: tournamentPoints(t),
    stages: t.stages.map((s, i) => toStageSummary(s, i === t.stages.length - 1, times)),
    slotOptions: options.map((o) => ({ ...o, taken: taken.get(o.id) ?? 0 })),
  };
}

/** Teams per stage-1 slot: assigned group once drawn, otherwise confirmed teams' first preference. */
async function slotTaken(t: TournamentFull, options: TimeSlotOption[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const s1 = t.stages[0];
  if (!s1 || !options.length) return out;
  if (s1.groups.length) {
    for (const g of s1.groups) if (g.slotId) out.set(g.slotId, (out.get(g.slotId) ?? 0) + g._count.teams);
    return out;
  }
  const entries = await prisma.tournamentEntry.findMany({
    where: { tournamentId: t.id, status: "CONFIRMED", entryStage: 1 },
    select: { timePreferences: true },
  });
  const valid = new Set(options.map((o) => o.id));
  for (const e of entries) {
    const first = e.timePreferences.find((p) => valid.has(p));
    if (first) out.set(first, (out.get(first) ?? 0) + 1);
  }
  return out;
}

export function formatIssues(t: TournamentFull): FormatIssue[] {
  if (!t.stages.length) return [{ stage: null, level: "error", message: "Add at least one stage" }];
  return validateFormat(t.stages.map(specOf), t.maxTeams);
}

export async function toManagerDetail(t: TournamentFull): Promise<ManagerTournamentDetail> {
  const detail = await toDetail(t);
  const issues = formatIssues(t);
  return { ...detail, issues, canEditFormat: t.status === "DRAFT", nextAction: await nextAction(t, issues) };
}

async function nextAction(t: TournamentFull, issues: FormatIssue[]): Promise<ManagerTournamentDetail["nextAction"]> {
  const act = (key: ManagerActionKey, label: string, stageId: string | null = null) => ({ key, label, stageId });
  const s1 = t.stages[0] ?? null;
  switch (t.status) {
    case "DRAFT":
      if (issues.some((i) => i.level === "error")) return act("FIX_FORMAT", "Fix the format");
      if (s1 && !scheduleOf(s1.schedule)) return act("SET_SCHEDULE", `Set the ${s1.name} schedule`, s1.id);
      return act("PUBLISH", "Publish & open registration");
    case "REGISTRATION_OPEN":
      return act("CLOSE_REGISTRATION", "Close registration");
    case "REGISTRATION_CLOSED":
    case "LIVE": {
      const s = t.stages.find((x) => x.status !== "COMPLETED");
      if (!s) return act("COMPLETE", "Complete the tournament");
      if (s.status === "PENDING") {
        if (!scheduleOf(s.schedule)) return act("SET_SCHEDULE", `Set the ${s.name} schedule`, s.id);
        return act("DRAW", s.order === 1 ? `Draw the ${s.name} groups` : `Draw the ${s.name} groups (snake seeding)`, s.id);
      }
      if (s.status === "DRAWN") return act("START_STAGE", `Start the ${s.name}`, s.id);
      const unpublished = await prisma.match.count({ where: { group: { stageId: s.id }, status: { not: "PUBLISHED" } } });
      if (unpublished > 0) return act("PLAY_MATCHES", `Play the ${s.name} matches`, s.id);
      const last = s.order === t.stages.length;
      return act("PROMOTE", last ? `Confirm the ${s.name} results` : `Promote teams to the ${t.stages[s.order]?.name ?? "next stage"}`, s.id);
    }
    case "COMPLETED":
      return act("DONE", "Tournament complete");
    default:
      return null;
  }
}

// ---------------------------------------------------------------- entries

export const entryInclude = { team: { select: teamSelect } } satisfies Prisma.TournamentEntryInclude;
export type EntryWithTeam = Prisma.TournamentEntryGetPayload<{ include: typeof entryInclude }>;

export function toEntryRow(e: EntryWithTeam, waitlistPosition: number | null = null): TournamentEntryRow {
  return {
    id: e.id,
    team: toTeamSummary(e.team),
    type: e.type,
    status: e.status,
    entryStage: e.entryStage,
    timePreferences: e.timePreferences,
    registeredAt: e.registeredAt.toISOString(),
    waitlistPosition: e.status === "WAITLISTED" ? waitlistPosition : null,
  };
}

/** 1-based waitlist position of an entry (registration order). */
export async function waitlistPosition(e: { id: string; tournamentId: string; status: string; registeredAt: Date }): Promise<number | null> {
  if (e.status !== "WAITLISTED") return null;
  const ahead = await prisma.tournamentEntry.count({
    where: {
      tournamentId: e.tournamentId,
      status: "WAITLISTED",
      OR: [{ registeredAt: { lt: e.registeredAt } }, { registeredAt: e.registeredAt, id: { lt: e.id } }],
    },
  });
  return ahead + 1;
}

/**
 * Fill free spots from the waitlist (oldest first) while confirmed < maxTeams. Only before the stage-1 draw.
 * Must run inside a transaction that holds the tournament lock.
 */
export async function promoteWaitlist(tx: Tx, tournamentId: string): Promise<number> {
  const t = await tx.tournament.findUniqueOrThrow({
    where: { id: tournamentId },
    select: { maxTeams: true, status: true, stages: { where: { order: 1 }, select: { status: true } } },
  });
  if (t.stages[0] && t.stages[0].status !== "PENDING") return 0;
  if (t.status === "CANCELLED" || t.status === "COMPLETED") return 0;
  const confirmed = await tx.tournamentEntry.count({ where: { tournamentId, type: "REGISTERED", status: "CONFIRMED" } });
  const free = t.maxTeams - confirmed;
  if (free <= 0) return 0;
  const next = await tx.tournamentEntry.findMany({
    where: { tournamentId, status: "WAITLISTED" },
    orderBy: [{ registeredAt: "asc" }, { id: "asc" }],
    take: free,
    select: { id: true },
  });
  if (next.length) await tx.tournamentEntry.updateMany({ where: { id: { in: next.map((n) => n.id) } }, data: { status: "CONFIRMED" } });
  return next.length;
}

export function assertNotFinished(t: { status: string }) {
  if (t.status === "CANCELLED") throw new AppError("CONFLICT", "This tournament was cancelled");
  if (t.status === "COMPLETED") throw new AppError("CONFLICT", "This tournament is already complete");
}
