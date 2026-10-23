/**
 * Weekly Board (shared/weekly.ts): a scrim's Monday–Friday points table, and the Finals Slot its #1 wins — an invite
 * straight into the final stage of one of the organiser's upcoming tournaments (TournamentEntry.awardKey/awardNote).
 */
import {
  addDays,
  computeStandings,
  matchPoints,
  todayInAppTz,
  weekStartOf,
  WEEKLY_DAYS,
  type FinalsSlot,
  type FinalsTarget,
  type GameMap,
  type GiveFinalsSlotInput,
  type MatchStatus,
  type StandingsRow,
  type TeamMatchResult,
  type WeeklyBoard,
} from "@7xen/shared";
import { prisma } from "../db.js";
import { conflict, notFound } from "../lib/errors.js";
import { brandingUrl, dateToStr, pointsSystemOf, strToDate, toTeamSummary } from "../lib/serialize.js";
import { loadOwnScrim } from "./scrims.js";
import { inviteTeam } from "./tournaments/manage.js";

type ScrimRef = { id: string; title: string; maps: string[]; startTime: string; pointsSystem: Parameters<typeof pointsSystemOf>[0] };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-19", "2026-10-23" → "19–23 Oct" (or "28 Sep – 2 Oct") */
function weekRange(start: string, end: string): string {
  const [, sm, sd] = start.split("-").map(Number) as [number, number, number];
  const [, em, ed] = end.split("-").map(Number) as [number, number, number];
  return sm === em ? `${sd}–${ed} ${MONTHS[em - 1]}` : `${sd} ${MONTHS[sm - 1]} – ${ed} ${MONTHS[em - 1]}`;
}

const awardKeyOf = (scrimId: string, start: string) => `weekly:${scrimId}:${start}`;
const stageStart = (schedule: unknown): string | null => {
  const d = (schedule as { startDate?: unknown } | null)?.startDate;
  return typeof d === "string" ? d : null;
};

async function boardFor(scrim: ScrimRef, week: string | undefined): Promise<WeeklyBoard> {
  const today = todayInAppTz();
  const start = weekStartOf(week ?? today);
  const days = Array.from({ length: WEEKLY_DAYS }, (_, i) => addDays(start, i));
  const end = days[WEEKLY_DAYS - 1]!;
  const ps = pointsSystemOf(scrim.pointsSystem);

  const sessions = await prisma.scrimSession.findMany({
    where: { scrimId: scrim.id, date: { gte: strToDate(start), lte: strToDate(end) } },
    include: {
      matches: {
        orderBy: { number: "asc" },
        include: { teams: { where: { teamId: { not: null } }, select: { teamId: true, placement: true, kills: true, team: { select: { id: true, name: true, tag: true } } } } },
      },
    },
  });
  const byDate = new Map(sessions.map((s) => [dateToStr(s.date), s]));

  const results: TeamMatchResult[] = [];
  const teams = new Map<string, { id: string; name: string; tag: string }>();
  const per = new Map<string, Map<number, { placement: number; kills: number; totalPoints: number }>>();
  const columns: WeeklyBoard["matches"] = [];
  const stamps: number[] = [];

  days.forEach((day, i) => {
    const matches = byDate.get(day)?.matches ?? [];
    const published = matches.filter((m) => m.status === "PUBLISHED");
    for (const m of published) {
      if (m.publishedAt) stamps.push(m.publishedAt.getTime());
      for (const t of m.teams) {
        if (!t.teamId || !t.team || t.placement == null) continue;
        const kills = t.kills ?? 0;
        // order matches across the week for the "latest placement" tie-breaker
        results.push({ teamId: t.teamId, matchNumber: i * 100 + m.number, placement: t.placement, kills });
        teams.set(t.teamId, t.team);
        const nights = per.get(t.teamId) ?? new Map();
        const prev = nights.get(i + 1);
        const pts = matchPoints(ps, t.placement, kills).totalPoints;
        // a night with more than one match: best placement, kills + points added up
        nights.set(i + 1, prev ? { placement: Math.min(prev.placement, t.placement), kills: prev.kills + kills, totalPoints: prev.totalPoints + pts } : { placement: t.placement, kills, totalPoints: pts });
        per.set(t.teamId, nights);
      }
    }
    const last = published.map((m) => m.publishedAt?.getTime() ?? 0).filter(Boolean);
    columns.push({
      id: matches[0]?.id ?? `day-${day}`,
      number: i + 1,
      map: (matches[0]?.map ?? scrim.maps[0] ?? "ERANGEL") as GameMap,
      status: (published.length ? "PUBLISHED" : (matches[0]?.status ?? "SCHEDULED")) as MatchStatus,
      publishedAt: last.length ? new Date(Math.max(...last)).toISOString() : null,
    });
  });

  const rows: StandingsRow[] = computeStandings(ps, results).map((r) => {
    const perMatch: StandingsRow["perMatch"] = {};
    for (let n = 1; n <= WEEKLY_DAYS; n++) perMatch[n] = per.get(r.teamId)?.get(n) ?? null;
    return { ...r, team: toTeamSummary(teams.get(r.teamId)!), slotNumber: null, perMatch };
  });

  const award = await prisma.tournamentEntry.findFirst({
    where: { awardKey: awardKeyOf(scrim.id, start), status: "CONFIRMED" },
    select: { teamId: true, entryStage: true, tournament: { select: { id: true, title: true, stages: { select: { order: true, name: true } } } } },
  });

  return {
    scrim: { id: scrim.id, title: scrim.title, maps: scrim.maps as GameMap[], startTime: scrim.startTime },
    date: start,
    pointsSystem: ps,
    matches: columns,
    rows,
    updatedAt: stamps.length ? new Date(Math.max(...stamps)).toISOString() : null,
    week: { start, end, days, current: today >= start && today <= addDays(start, 6), over: today > end },
    finalsSlot: award
      ? {
          teamId: award.teamId,
          tournament: { id: award.tournament.id, title: award.tournament.title },
          stageName: award.tournament.stages.find((s) => s.order === award.entryStage)?.name ?? "Final",
        }
      : null,
  };
}

export async function teamWeeklyBoard(scrimId: string, week: string | undefined): Promise<WeeklyBoard> {
  const scrim = await prisma.scrim.findUnique({ where: { id: scrimId } });
  if (!scrim) throw notFound("Scrim not found");
  return boardFor(scrim, week);
}

export async function managerWeeklyBoard(scrimId: string, managerId: string, week: string | undefined): Promise<WeeklyBoard> {
  return boardFor(await loadOwnScrim(scrimId, managerId), week);
}

/** The manager's tournaments whose final stage hasn't been drawn yet — where a Finals Slot can go. */
export async function finalsTargets(managerId: string): Promise<FinalsTarget[]> {
  const ts = await prisma.tournament.findMany({
    where: { managerId, mode: "BR", status: { in: ["DRAFT", "REGISTRATION_OPEN", "REGISTRATION_CLOSED", "LIVE"] } },
    orderBy: { createdAt: "desc" },
    include: { stages: { orderBy: { order: "desc" }, take: 1 } },
  });
  const out: FinalsTarget[] = [];
  for (const t of ts) {
    const final = t.stages[0];
    if (!final || final.order < 2 || final.status !== "PENDING") continue;
    const used = await prisma.tournamentEntry.count({ where: { tournamentId: t.id, type: "INVITED", status: "CONFIRMED", entryStage: final.order } });
    out.push({ id: t.id, title: t.title, stageName: final.name, startDate: stageStart(final.schedule), invitesLeft: Math.max(0, final.invitedSlots - used) });
  }
  return out;
}

/** Give the week's #1 a direct slot in the tournament's final stage. */
export async function giveFinalsSlot(scrimId: string, managerId: string, input: GiveFinalsSlotInput): Promise<WeeklyBoard> {
  const scrim = await loadOwnScrim(scrimId, managerId);
  const board = await boardFor(scrim, input.week);
  if (!board.week.over) throw conflict("The week isn't over yet. Give the Finals Slot after Friday's match.");
  if (board.finalsSlot) throw conflict("This week's Finals Slot has already been given.");
  const [top, second] = board.rows;
  if (!top) throw conflict("No results were published this week.");
  if (second && second.rank === top.rank) throw conflict("Two teams are tied for #1. Settle the tie before giving the Finals Slot.");

  const final = await prisma.tournamentStage.findFirst({ where: { tournamentId: input.tournamentId, tournament: { managerId } }, orderBy: { order: "desc" } });
  if (!final) throw notFound("Tournament not found");
  const entry = await inviteTeam(input.tournamentId, { userId: managerId, admin: false }, { teamId: top.teamId, stageOrder: final.order });
  await prisma.tournamentEntry.update({
    where: { id: entry.id },
    data: { awardKey: awardKeyOf(scrim.id, board.week.start), awardNote: `${scrim.title} · Weekly Board #1 · ${weekRange(board.week.start, board.week.end)}` },
  });
  return boardFor(scrim, input.week);
}

/** Finals Slots my team holds: invites into the last stage of tournaments that haven't finished. */
export async function teamFinalsSlots(teamId: string): Promise<FinalsSlot[]> {
  const entries = await prisma.tournamentEntry.findMany({
    where: { teamId, type: "INVITED", status: "CONFIRMED", tournament: { status: { notIn: ["COMPLETED", "CANCELLED"] } } },
    orderBy: { registeredAt: "desc" },
    include: {
      tournament: {
        select: { id: true, title: true, posterKey: true, manager: { select: { displayName: true } }, stages: { orderBy: { order: "desc" }, take: 1 } },
      },
    },
  });
  return entries
    .filter((e) => e.tournament.stages[0]?.order === e.entryStage)
    .map((e) => {
      const stage = e.tournament.stages[0]!;
      return {
        entryId: e.id,
        tournament: { id: e.tournament.id, title: e.tournament.title, posterUrl: brandingUrl(e.tournament.posterKey), organizer: e.tournament.manager.displayName },
        stage: { order: stage.order, name: stage.name, startDate: stageStart(stage.schedule) },
        note: e.awardNote,
        awardedAt: e.registeredAt.toISOString(),
      };
    });
}
