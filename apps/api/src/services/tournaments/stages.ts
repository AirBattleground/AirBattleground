/**
 * Stage operations: draw (stage 1 by time preferences, later stages by snake seeding), redraw, group moves,
 * match rescheduling, start, disqualify, stage detail (standings / top teams / fraggers), promotion.
 */
import { randomBytes } from "node:crypto";
import {
  bracketPairs,
  computeStandings,
  drawGroups,
  groupName,
  groupSizes,
  nextStageSeeds,
  promote,
  rankStage,
  snakeSeed,
  type AdvancedVia,
  type DrawGroup,
  type DrawInput,
  type DrawResult,
  type GameMap,
  type GroupDetail,
  type GroupMovesInput,
  type GroupResults,
  type GroupStandingRow,
  type PromoteInput,
  type PromotionPreview,
  type PromotionResult,
  type RankedTeam,
  type RescheduleMatchInput,
  type StageDetail,
  type TeamMatchResult,
  type TeamSummary,
} from "@7xen/shared";
import { prisma, type Tx } from "../../db.js";
import { AppError, conflict, notFound } from "../../lib/errors.js";
import { iso, teamSelect, toTeamSummary } from "../../lib/serialize.js";
import { normName } from "../merge.js";
import { awardChampionCoins } from "../coins.js";
import {
  TX_OPTS,
  assertNotFinished,
  loadManaged,
  loadTournament,
  loadTournamentTx,
  lockTournament,
  planFor,
  specOf,
  stageOf,
  toStageSummary,
  tournamentPoints,
  type Actor,
  type StageWithGroups,
  type TournamentFull,
} from "./core.js";

// ---------------------------------------------------------------- helpers

const newSeed = () => randomBytes(6).toString("hex");

/** Any screenshot or lineup/result row on a match of the stage (then a redraw would destroy work). */
async function stageHasMatchData(db: Tx, stageId: string) {
  const [shots, teams] = await Promise.all([
    db.screenshot.count({ where: { match: { group: { stageId } } } }),
    db.matchTeam.count({ where: { match: { group: { stageId } } } }),
  ]);
  return shots + teams > 0;
}

/** Results entered/published on any match of the stage (then teams can't move between groups). */
async function stageHasResults(db: Tx, stageId: string) {
  const n = await db.match.count({
    where: { group: { stageId }, OR: [{ status: { in: ["RESULTS_REVIEW", "PUBLISHED"] } }, { teams: { some: { placement: { not: null } } } }] },
  });
  return n > 0;
}

/** Teams entering a stage, best seed first. Stage 1 = confirmed registrations in registration order. */
async function stageEntrants(db: Tx, t: TournamentFull, stage: StageWithGroups): Promise<{ teamId: string; preferences: string[] }[]> {
  if (stage.order === 1) {
    const entries = await db.tournamentEntry.findMany({
      where: { tournamentId: t.id, status: "CONFIRMED", entryStage: 1 },
      orderBy: [{ registeredAt: "asc" }, { id: "asc" }],
      select: { teamId: true, timePreferences: true },
    });
    return entries.map((e) => ({ teamId: e.teamId, preferences: e.timePreferences }));
  }
  const prev = t.stages.find((s) => s.order === stage.order - 1)!;
  if (prev.status !== "COMPLETED") throw conflict(`Finish the ${prev.name} and promote its teams first`);
  const qualified = await db.groupTeam.findMany({
    where: { group: { stageId: prev.id }, status: "ADVANCED" },
    orderBy: [{ finalRank: "asc" }, { createdAt: "asc" }],
    select: { teamId: true },
  });
  const invited = await db.tournamentEntry.findMany({
    where: { tournamentId: t.id, type: "INVITED", status: "CONFIRMED", entryStage: stage.order },
    orderBy: [{ registeredAt: "asc" }, { id: "asc" }],
    select: { teamId: true },
  });
  return nextStageSeeds(
    qualified.map((q) => q.teamId),
    invited.map((i) => i.teamId),
  ).map((teamId) => ({ teamId, preferences: [] }));
}

/** Run the draw for a PENDING stage (inside a tx holding the tournament lock) and persist groups + matches. */
async function performDraw(tx: Tx, t: TournamentFull, stage: StageWithGroups, seed: string) {
  const spec = specOf(stage);
  const entrants = await stageEntrants(tx, t, stage);
  if (entrants.length < spec.groupCount * 2) {
    throw conflict(`${entrants.length} teams aren't enough for ${spec.groupCount} groups. Remove a group from the format or invite more teams.`);
  }
  const sizes = groupSizes(entrants.length, spec.groupCount);
  if (Math.max(...sizes) > spec.lobbySize) {
    throw conflict(`${entrants.length} teams don't fit in ${spec.groupCount} lobbies of ${spec.lobbySize}`);
  }
  const plan = planFor(spec, sizes);

  let drawn: DrawResult["groups"];
  if (stage.order === 1) {
    const valid = new Set(plan?.slotOptions.map((o) => o.id) ?? []);
    const groups: DrawGroup[] = sizes.map((size, index) => ({
      index,
      size,
      slotId: plan?.slotOptions.find((o) => o.groupIndexes.includes(index))?.id ?? null,
    }));
    const res = drawGroups(
      entrants.map((e) => ({ teamId: e.teamId, preferences: e.preferences.filter((p) => valid.has(p)) })),
      groups,
      seed,
      t.firstSlot,
    );
    drawn = res.groups;
  } else if (t.mode === "TDM") {
    // knockout: winner of M1 meets winner of M2, M3 meets M4, …
    const prev = t.stages.find((s) => s.order === stage.order - 1)!;
    const prevGroups = await tx.tournamentGroup.findMany({
      where: { stageId: prev.id },
      orderBy: { index: "asc" },
      select: { teams: { where: { status: "ADVANCED" }, select: { teamId: true }, take: 1 } },
    });
    drawn = bracketPairs(
      prevGroups.map((g) => g.teams[0]?.teamId ?? null),
      seed,
      t.firstSlot,
    );
  } else {
    drawn = snakeSeed(
      entrants.map((e) => e.teamId),
      sizes,
      seed,
      t.firstSlot,
    );
  }

  for (const g of [...drawn].sort((a, b) => a.index - b.index)) {
    const block = plan?.blocks.find((b) => b.groupIndex === g.index) ?? null;
    const option = plan?.slotOptions.find((o) => o.groupIndexes.includes(g.index)) ?? null;
    const group = await tx.tournamentGroup.create({
      data: {
        stageId: stage.id,
        index: g.index,
        name: groupName(g.index),
        lobbyIndex: block?.lobbyIndex ?? null,
        slotId: option?.id ?? null,
        startsAt: block?.matches[0] ? new Date(block.matches[0].start) : null,
      },
    });
    await tx.groupTeam.createMany({
      data: g.teams.map((x) => ({ groupId: group.id, teamId: x.teamId, slotNumber: x.slotNumber, seed: x.seed })),
    });
    await tx.match.createMany({
      data: spec.maps.slice(0, spec.matchesPerGroup).map((map, i) => {
        const sm = block?.matches.find((m) => m.number === i + 1);
        return { groupId: group.id, number: i + 1, map, scheduledAt: sm ? new Date(sm.start) : null, lobbyIndex: block?.lobbyIndex ?? null };
      }),
    });
  }
  await tx.tournamentStage.update({ where: { id: stage.id }, data: { status: "DRAWN", drawSeed: seed } });
  // the stage-1 draw ends registration (and with it the waitlist)
  if (stage.order === 1 && t.status === "REGISTRATION_OPEN") {
    await tx.tournament.update({ where: { id: t.id }, data: { status: "REGISTRATION_CLOSED" } });
  }
}

// ---------------------------------------------------------------- draw / redraw

export async function drawStage(id: string, actor: Actor, stageId: string, input: DrawInput): Promise<StageDetail> {
  const t0 = await loadManaged(id, actor);
  assertNotFinished(t0);
  if (t0.status === "DRAFT") throw conflict("Publish the tournament and collect registrations before the draw");
  await prisma.$transaction(async (tx) => {
    await lockTournament(tx, id);
    const t = await loadTournamentTx(tx, id);
    const stage = stageOf(t, stageId);
    if (stage.status !== "PENDING") throw conflict(`The ${stage.name} is already drawn`);
    if (stage.order === 1 && !specOf(stage).schedule) throw conflict(`Set the ${stage.name} schedule first`);
    await performDraw(tx, t, stage, input.seed || newSeed());
  }, TX_OPTS);
  return stageDetail(id, stageId, actor);
}

export async function redrawStage(id: string, actor: Actor, stageId: string, input: DrawInput): Promise<StageDetail> {
  await loadManaged(id, actor);
  await prisma.$transaction(async (tx) => {
    await lockTournament(tx, id);
    const t = await loadTournamentTx(tx, id);
    assertNotFinished(t);
    const stage = stageOf(t, stageId);
    if (stage.status !== "DRAWN") throw conflict(stage.status === "PENDING" ? `The ${stage.name} isn't drawn yet` : `The ${stage.name} has started, so it can't be redrawn`);
    if (await stageHasMatchData(tx, stageId)) throw conflict("Matches of this stage already have screenshots or results, so it can't be redrawn");
    await tx.tournamentGroup.deleteMany({ where: { stageId } });
    await tx.tournamentStage.update({ where: { id: stageId }, data: { status: "PENDING", drawSeed: null } });
    const fresh = await loadTournamentTx(tx, id);
    await performDraw(tx, fresh, stageOf(fresh, stageId), input.seed || newSeed());
  }, TX_OPTS);
  return stageDetail(id, stageId, actor);
}

// ---------------------------------------------------------------- group moves / reschedule / start / DQ

export async function moveTeams(id: string, actor: Actor, stageId: string, input: GroupMovesInput): Promise<StageDetail> {
  const t = await loadManaged(id, actor);
  const stage = stageOf(t, stageId);
  if (stage.status !== "DRAWN" && stage.status !== "LIVE") throw conflict("Teams can only be moved after the draw and before results");
  await prisma.$transaction(async (tx) => {
    await lockTournament(tx, id);
    if (await stageHasResults(tx, stageId)) throw conflict("Results are already in for this stage, so teams can't change groups");
    const groups = await tx.tournamentGroup.findMany({ where: { stageId }, select: { id: true } });
    const groupIds = new Set(groups.map((g) => g.id));
    const slots = Array.from({ length: stage.lobbySize }, (_, i) => t.firstSlot + i);
    for (const [i, mv] of input.moves.entries()) {
      if (!groupIds.has(mv.toGroupId)) throw new AppError("VALIDATION_ERROR", "Group not found in this stage", { [`moves.${i}.toGroupId`]: "Not a group of this stage" });
      const mover = await tx.groupTeam.findFirst({ where: { teamId: mv.teamId, groupId: { in: [...groupIds] } } });
      if (!mover) throw new AppError("VALIDATION_ERROR", "That team isn't in this stage", { [`moves.${i}.teamId`]: "Team not in this stage" });
      const target = await tx.groupTeam.findMany({ where: { groupId: mv.toGroupId }, select: { id: true, teamId: true, slotNumber: true } });
      let slot = mv.slotNumber;
      if (slot == null) {
        if (mover.groupId === mv.toGroupId) continue;
        const used = new Set(target.map((x) => x.slotNumber));
        slot = slots.find((s) => !used.has(s));
        if (slot == null) throw conflict(`That group is full (${stage.lobbySize} teams)`);
      } else if (slot < t.firstSlot || slot >= t.firstSlot + stage.lobbySize) {
        throw new AppError("VALIDATION_ERROR", `Slots run from ${t.firstSlot} to ${t.firstSlot + stage.lobbySize - 1}`, { [`moves.${i}.slotNumber`]: "Slot out of range" });
      }
      const occupant = target.find((x) => x.slotNumber === slot && x.id !== mover.id);
      if (!occupant && mover.groupId !== mv.toGroupId && target.length >= stage.lobbySize) throw conflict(`That group is full (${stage.lobbySize} teams)`);
      // park the mover on a temporary slot so the (group, slot) unique index never clashes mid-swap
      await tx.groupTeam.update({ where: { id: mover.id }, data: { slotNumber: -1 } });
      if (occupant) await tx.groupTeam.update({ where: { id: occupant.id }, data: { groupId: mover.groupId, slotNumber: mover.slotNumber } });
      await tx.groupTeam.update({ where: { id: mover.id }, data: { groupId: mv.toGroupId, slotNumber: slot } });
    }
  }, TX_OPTS);
  return stageDetail(id, stageId, actor);
}

export async function rescheduleMatch(id: string, actor: Actor, matchId: string, input: RescheduleMatchInput): Promise<StageDetail> {
  const t = await loadManaged(id, actor);
  assertNotFinished(t);
  const m = await prisma.match.findUnique({ where: { id: matchId }, include: { group: { select: { id: true, stageId: true, stage: { select: { tournamentId: true } } } } } });
  if (!m || !m.group || m.group.stage.tournamentId !== id) throw notFound("Match not found");
  if (m.status === "PUBLISHED") throw conflict("This match is already played");
  const at = new Date(input.scheduledAt);
  await prisma.$transaction(async (tx) => {
    await tx.match.update({ where: { id: matchId }, data: { scheduledAt: at } });
    const first = await tx.match.aggregate({ where: { groupId: m.group!.id }, _min: { scheduledAt: true } });
    await tx.tournamentGroup.update({ where: { id: m.group!.id }, data: { startsAt: first._min.scheduledAt } });
  });
  return stageDetail(id, m.group.stageId, actor);
}

export async function startStage(id: string, actor: Actor, stageId: string): Promise<StageDetail> {
  const t = await loadManaged(id, actor);
  assertNotFinished(t);
  const stage = stageOf(t, stageId);
  if (stage.status !== "DRAWN") throw conflict(stage.status === "PENDING" ? `Draw the ${stage.name} groups first` : `The ${stage.name} has already started`);
  await prisma.$transaction(async (tx) => {
    await tx.tournamentStage.update({ where: { id: stageId }, data: { status: "LIVE", startedAt: new Date() } });
    await tx.tournament.update({ where: { id }, data: { status: "LIVE" } });
  });
  return stageDetail(id, stageId, actor);
}

export async function disqualifyTeam(id: string, actor: Actor, stageId: string, teamId: string, reason: string): Promise<StageDetail> {
  const t = await loadManaged(id, actor);
  assertNotFinished(t);
  const stage = stageOf(t, stageId);
  if (stage.status !== "DRAWN" && stage.status !== "LIVE") throw conflict(`The ${stage.name} isn't in play`);
  const gt = await prisma.groupTeam.findFirst({ where: { teamId, group: { stageId } } });
  if (!gt) throw notFound("That team isn't in this stage");
  await prisma.groupTeam.update({ where: { id: gt.id }, data: { status: "DISQUALIFIED", dqReason: reason, advancedVia: null } });
  return stageDetail(id, stageId, actor);
}

// ---------------------------------------------------------------- results per stage

const stageGroupsInclude = {
  teams: { include: { team: { select: teamSelect } }, orderBy: { slotNumber: "asc" as const } },
  matches: {
    orderBy: { number: "asc" as const },
    include: {
      teams: {
        where: { teamId: { not: null } },
        select: { teamId: true, placement: true, kills: true, totalPoints: true, players: { select: { name: true, kills: true } } },
      },
    },
  },
};
type LoadedGroup = Awaited<ReturnType<typeof loadStageGroups>>[number];

const loadStageGroups = (stageId: string) =>
  prisma.tournamentGroup.findMany({ where: { stageId }, orderBy: { index: "asc" }, include: stageGroupsInclude });

/** Published results of a group, restricted to the group's teams. */
function groupResults(g: LoadedGroup): GroupResults {
  const ids = new Set(g.teams.map((x) => x.teamId));
  const results: TeamMatchResult[] = [];
  for (const m of g.matches) {
    if (m.status !== "PUBLISHED") continue;
    for (const r of m.teams) {
      if (!r.teamId || r.placement == null || !ids.has(r.teamId)) continue;
      results.push({ teamId: r.teamId, matchNumber: m.number, placement: r.placement, kills: r.kills ?? 0 });
    }
  }
  return {
    groupIndex: g.index,
    teamIds: g.teams.map((x) => x.teamId),
    results,
    disqualified: g.teams.filter((x) => x.status === "DISQUALIFIED").map((x) => x.teamId),
  };
}

function groupStandings(ps: ReturnType<typeof tournamentPoints>, g: LoadedGroup): GroupStandingRow[] {
  const rows = computeStandings(ps, groupResults(g).results);
  const byTeam = new Map(rows.map((r) => [r.teamId, r]));
  const out: GroupStandingRow[] = [];
  const push = (gt: LoadedGroup["teams"][number], rank: number) => {
    const r = byTeam.get(gt.teamId);
    out.push({
      rank,
      team: toTeamSummary(gt.team),
      slotNumber: gt.slotNumber,
      seed: gt.seed,
      matchesPlayed: r?.matchesPlayed ?? 0,
      wins: r?.wins ?? 0,
      kills: r?.kills ?? 0,
      placementPoints: r?.placementPoints ?? 0,
      killPoints: r?.killPoints ?? 0,
      totalPoints: r?.totalPoints ?? 0,
      status: gt.status,
      advancedVia: (gt.advancedVia as AdvancedVia | null) ?? null,
    });
  };
  const teamById = new Map(g.teams.map((x) => [x.teamId, x]));
  // ranked (non-DQ) first, then teams with no result yet, then disqualified teams
  const active = rows.filter((r) => teamById.get(r.teamId)?.status !== "DISQUALIFIED");
  let rank = 0;
  let prev: (typeof rows)[number] | null = null;
  active.forEach((r, i) => {
    rank = prev && prev.rank === r.rank ? rank : i + 1;
    prev = r;
    push(teamById.get(r.teamId)!, rank);
  });
  const without = g.teams.filter((x) => !byTeam.has(x.teamId) && x.status !== "DISQUALIFIED");
  for (const x of without) push(x, active.length + 1);
  const dq = g.teams.filter((x) => x.status === "DISQUALIFIED");
  for (const x of dq) push(x, active.length + without.length + 1);
  return out;
}

export async function stageDetail(id: string, stageId: string, actor: Actor | null): Promise<StageDetail> {
  const t = actor ? await loadManaged(id, actor) : await loadTournament(id);
  if (!t || (!actor && t.status === "DRAFT")) throw notFound("Tournament not found");
  const stage = stageOf(t, stageId);
  const isLast = stage.order === t.stages.length;
  const ps = tournamentPoints(t);
  const groups = await loadStageGroups(stageId);

  const times = new Map<string, { first: Date | null; last: Date | null }>();
  const all = groups.flatMap((g) => g.matches.map((m) => m.scheduledAt).filter((d): d is Date => !!d));
  if (all.length) times.set(stageId, { first: new Date(Math.min(...all.map(Number))), last: new Date(Math.max(...all.map(Number))) });

  const teamInfo = new Map<string, { team: TeamSummary; groupName: string }>();
  const groupDtos: GroupDetail[] = groups.map((g) => {
    for (const gt of g.teams) teamInfo.set(gt.teamId, { team: toTeamSummary(gt.team), groupName: g.name });
    return {
      id: g.id,
      index: g.index,
      name: g.name,
      lobbyIndex: g.lobbyIndex,
      startsAt: iso(g.startsAt),
      teams: groupStandings(ps, g),
      matches: g.matches.map((m) => ({ id: m.id, number: m.number, map: m.map as GameMap, scheduledAt: iso(m.scheduledAt), status: m.status, publishedAt: iso(m.publishedAt) })),
    };
  });

  const topTeams = groupDtos
    .flatMap((g) => g.teams.filter((r) => r.matchesPlayed > 0).map((r) => ({ r, groupName: g.name })))
    .map(({ r, groupName: gn }) => ({
      team: r.team,
      groupName: gn,
      totalPoints: r.totalPoints,
      matchesPlayed: r.matchesPlayed,
      pointsPerMatch: Math.round((r.totalPoints / r.matchesPlayed) * 100) / 100,
      kills: r.kills,
    }))
    .sort((a, b) => b.pointsPerMatch - a.pointsPerMatch || b.totalPoints - a.totalPoints || b.kills - a.kills)
    .slice(0, 10);

  const fraggers = new Map<string, { name: string; teamId: string; kills: number; matches: Set<string> }>();
  for (const g of groups) {
    for (const m of g.matches) {
      if (m.status !== "PUBLISHED") continue;
      for (const mt of m.teams) {
        if (!mt.teamId) continue;
        for (const p of mt.players) {
          const key = `${mt.teamId}:${normName(p.name)}`;
          const f = fraggers.get(key) ?? { name: p.name, teamId: mt.teamId, kills: 0, matches: new Set<string>() };
          f.kills += p.kills ?? 0;
          f.matches.add(m.id);
          fraggers.set(key, f);
        }
      }
    }
  }
  const topFraggers = [...fraggers.values()]
    .filter((f) => teamInfo.has(f.teamId) && f.kills > 0)
    .sort((a, b) => b.kills - a.kills || a.matches.size - b.matches.size)
    .slice(0, 10)
    .map((f) => ({ name: f.name, team: teamInfo.get(f.teamId)!.team, kills: f.kills, matchesPlayed: f.matches.size }));

  let unmetPreferences: StageDetail["unmetPreferences"] = [];
  if (stage.order === 1 && groups.length) {
    const entries = await prisma.tournamentEntry.findMany({
      where: { tournamentId: id, status: "CONFIRMED", entryStage: 1, NOT: { timePreferences: { isEmpty: true } } },
      select: { teamId: true, timePreferences: true },
    });
    const slotOf = new Map<string, string | null>();
    for (const g of groups) for (const gt of g.teams) slotOf.set(gt.teamId, g.slotId);
    unmetPreferences = entries
      .filter((e) => slotOf.has(e.teamId) && !e.timePreferences.includes(slotOf.get(e.teamId) ?? ""))
      .map((e) => ({ team: teamInfo.get(e.teamId)!.team, wanted: e.timePreferences, got: slotOf.get(e.teamId) ?? null }));
  }

  return {
    tournament: { id: t.id, title: t.title, status: t.status },
    stage: toStageSummary(stage, isLast, times),
    groups: groupDtos,
    topTeams,
    topFraggers,
    unmetPreferences,
  };
}

// ---------------------------------------------------------------- promotion

interface PromotionComputation {
  t: TournamentFull;
  stage: StageWithGroups;
  groups: LoadedGroup[];
  blockers: string[];
  result: PromotionResult;
  ranked: RankedTeam[];
}

async function computePromotion(id: string, actor: Actor, stageId: string, overrides: PromoteInput): Promise<PromotionComputation> {
  const t = await loadManaged(id, actor);
  const stage = stageOf(t, stageId);
  const groups = await loadStageGroups(stageId);
  const blockers: string[] = [];
  if (stage.status === "PENDING") blockers.push(`The ${stage.name} isn't drawn yet`);
  else if (stage.status === "DRAWN") blockers.push(`Start the ${stage.name} first`);
  else if (stage.status === "COMPLETED") blockers.push(`The ${stage.name} is already complete`);
  for (const g of groups) {
    for (const m of g.matches) if (m.status !== "PUBLISHED") blockers.push(`Group ${g.name} match ${m.number} isn't published`);
  }
  const allTeams = new Set(groups.flatMap((g) => g.teams.map((x) => x.teamId)));
  for (const tid of [...overrides.include, ...overrides.exclude]) {
    if (!allTeams.has(tid)) throw new AppError("VALIDATION_ERROR", "An override names a team that isn't in this stage");
  }
  const ps = tournamentPoints(t);
  const gr = groups.map(groupResults);
  const isLast = stage.order === t.stages.length;
  const result = promote(ps, gr, isLast ? 0 : stage.advancePerGroup, isLast ? 0 : stage.wildcardCount, {
    include: overrides.include,
    exclude: overrides.exclude,
  });
  const ranked = rankStage(ps, gr);
  return { t, stage, groups, blockers, result, ranked };
}

/** Engine messages name teams by id; swap in team names for people. */
function namesForIds(msg: string, info: Map<string, { team: TeamSummary }>): string {
  let out = msg;
  // longest ids first so one id that prefixes another can't corrupt it
  for (const id of [...info.keys()].sort((a, b) => b.length - a.length)) out = out.split(id).join(info.get(id)!.team.name);
  return out;
}

export async function promotionPreview(id: string, actor: Actor, stageId: string, overrides: PromoteInput = { include: [], exclude: [] }): Promise<PromotionPreview> {
  const { t, stage, groups, blockers, result } = await computePromotion(id, actor, stageId, overrides);
  const info = new Map<string, { team: TeamSummary; groupName: string }>();
  for (const g of groups) for (const gt of g.teams) info.set(gt.teamId, { team: toTeamSummary(gt.team), groupName: g.name });
  const cand = (r: RankedTeam, via: AdvancedVia | null) => ({
    team: info.get(r.teamId)!.team,
    groupName: info.get(r.teamId)!.groupName,
    groupRank: r.groupRank,
    totalPoints: r.totalPoints,
    pointsPerMatch: r.pointsPerMatch,
    via,
  });
  const next = t.stages.find((s) => s.order === stage.order + 1) ?? null;
  let nextStage: PromotionPreview["nextStage"] = null;
  if (next) {
    const invited = await prisma.tournamentEntry.findMany({
      where: { tournamentId: id, type: "INVITED", status: "CONFIRMED", entryStage: next.order },
      orderBy: [{ registeredAt: "asc" }, { id: "asc" }],
      include: { team: { select: teamSelect } },
    });
    nextStage = { order: next.order, name: next.name, teamsIn: result.qualified.length + invited.length, invited: invited.map((e) => toTeamSummary(e.team)) };
  }
  return {
    stageId,
    ready: blockers.length === 0,
    blockers,
    qualified: result.qualified.map((q) => cand(q, q.via)),
    eliminated: result.eliminated.map((e) => cand(e, null)),
    tiesAtCutoff: result.tiesAtCutoff.map((msg) => namesForIds(msg, info)),
    nextStage,
  };
}

/** Apply the promotion: GroupTeam statuses / via / stage-wide final rank; stage COMPLETED; champion after the last stage. */
export async function promoteStage(id: string, actor: Actor, stageId: string, overrides: PromoteInput): Promise<void> {
  const { t, stage, groups, blockers, result, ranked } = await computePromotion(id, actor, stageId, overrides);
  assertNotFinished(t);
  if (blockers.length) throw conflict(blockers[0]!);
  const isLast = stage.order === t.stages.length;
  const via = new Map(result.qualified.map((q) => [q.teamId, q.via]));
  const gtByTeam = new Map(groups.flatMap((g) => g.teams.map((x) => [x.teamId, x])));
  const dq = new Set(groups.flatMap((g) => g.teams.filter((x) => x.status === "DISQUALIFIED").map((x) => x.teamId)));
  const rankOf = new Map(ranked.map((r, i) => [r.teamId, i + 1]));
  const champion = isLast ? (ranked.find((r) => !dq.has(r.teamId))?.teamId ?? null) : null;

  await prisma.$transaction(async (tx) => {
    await lockTournament(tx, id);
    const fresh = await tx.tournamentStage.findUniqueOrThrow({ where: { id: stageId }, select: { status: true } });
    if (fresh.status !== "LIVE") throw conflict(`The ${stage.name} isn't live`);
    for (const [teamId, gt] of gtByTeam) {
      const finalRank = rankOf.get(teamId) ?? null;
      if (dq.has(teamId)) {
        await tx.groupTeam.update({ where: { id: gt.id }, data: { finalRank, advancedVia: null } });
        continue;
      }
      const v = isLast ? (teamId === champion ? "TOP" : null) : (via.get(teamId) ?? null);
      await tx.groupTeam.update({
        where: { id: gt.id },
        data: { status: v ? "ADVANCED" : "ELIMINATED", advancedVia: v, finalRank },
      });
    }
    await tx.tournamentStage.update({ where: { id: stageId }, data: { status: "COMPLETED", completedAt: new Date() } });
    if (isLast) {
      await tx.tournament.update({ where: { id }, data: { championTeamId: champion } });
      await awardChampionCoins(tx, id);
    }
  }, TX_OPTS);
}
