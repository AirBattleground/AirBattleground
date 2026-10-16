/**
 * Points table: standings per session (computed on read from published matches with the shared
 * computeStandings), plus helpers to (re)store per-team points on publish.
 */
import {
  computeStandings,
  matchPoints,
  type GameMap,
  type MatchStatus,
  type PointsSystem,
  type SessionStandings,
  type StandingsRow,
  type TeamMatchResult,
} from "@7xen/shared";
import { prisma, type Tx } from "../db.js";
import { notFound } from "../lib/errors.js";
import { dateToStr, pointsSystemOf, toTeamSummary } from "../lib/serialize.js";

const sessionStandingsInclude = {
  scrim: { select: { id: true, title: true, maps: true, startTime: true, pointsSystem: true } },
  registrations: { where: { status: "APPROVED" as const }, select: { teamId: true, slotNumber: true } },
  matches: {
    orderBy: { number: "asc" as const },
    include: {
      teams: {
        where: { teamId: { not: null } },
        select: { teamId: true, slotNumber: true, placement: true, kills: true, team: { select: { id: true, name: true, tag: true } } },
      },
    },
  },
};

/** Standings for one session (by id). Only PUBLISHED matches count. */
export async function standingsForSession(sessionId: string): Promise<SessionStandings> {
  const session = await prisma.scrimSession.findUnique({ where: { id: sessionId }, include: sessionStandingsInclude });
  if (!session) throw notFound("Session not found");
  const ps = pointsSystemOf(session.scrim.pointsSystem);

  const published = session.matches.filter((m) => m.status === "PUBLISHED");
  const results: TeamMatchResult[] = [];
  const teams = new Map<string, { id: string; name: string; tag: string }>();
  const matchSlot = new Map<string, number>();
  const per = new Map<string, Map<number, { placement: number; kills: number; totalPoints: number }>>();
  for (const m of published) {
    for (const t of m.teams) {
      if (!t.teamId || !t.team || t.placement == null) continue;
      const kills = t.kills ?? 0;
      results.push({ teamId: t.teamId, matchNumber: m.number, placement: t.placement, kills });
      teams.set(t.teamId, t.team);
      matchSlot.set(t.teamId, t.slotNumber);
      const map = per.get(t.teamId) ?? new Map();
      map.set(m.number, { placement: t.placement, kills, totalPoints: matchPoints(ps, t.placement, kills).totalPoints });
      per.set(t.teamId, map);
    }
  }
  const regSlot = new Map(session.registrations.map((r) => [r.teamId, r.slotNumber]));

  const rows: StandingsRow[] = computeStandings(ps, results).map((r) => {
    const perMatch: StandingsRow["perMatch"] = {};
    for (const m of session.matches) perMatch[m.number] = per.get(r.teamId)?.get(m.number) ?? null;
    return {
      ...r,
      team: toTeamSummary(teams.get(r.teamId)!),
      slotNumber: regSlot.get(r.teamId) ?? matchSlot.get(r.teamId) ?? null,
      perMatch,
    };
  });

  const times = published.map((m) => m.publishedAt?.getTime() ?? 0).filter(Boolean);
  return {
    scrim: { id: session.scrim.id, title: session.scrim.title, maps: session.scrim.maps as GameMap[], startTime: session.scrim.startTime },
    date: dateToStr(session.date),
    pointsSystem: ps,
    matches: session.matches.map((m) => ({
      id: m.id,
      number: m.number,
      map: m.map as GameMap,
      status: m.status as MatchStatus,
      publishedAt: m.publishedAt ? m.publishedAt.toISOString() : null,
    })),
    rows,
    updatedAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
  };
}

/** Store placement/kill/total points on every placed team of a match. */
export async function storeMatchPoints(tx: Tx, matchId: string, ps: PointsSystem) {
  const teams = await tx.matchTeam.findMany({ where: { matchId }, select: { id: true, placement: true, kills: true } });
  for (const t of teams) {
    const pts = t.placement != null ? matchPoints(ps, t.placement, t.kills ?? 0) : null;
    await tx.matchTeam.update({
      where: { id: t.id },
      data: {
        placementPoints: pts?.placementPoints ?? null,
        killPoints: pts?.killPoints ?? null,
        totalPoints: pts?.totalPoints ?? null,
      },
    });
  }
}

/** After a points-system change: recompute stored points of every published match of the scrim. */
export async function recomputeScrimPoints(scrimId: string, ps: PointsSystem) {
  const matches = await prisma.match.findMany({ where: { status: "PUBLISHED", session: { scrimId } }, select: { id: true } });
  for (const m of matches) await prisma.$transaction((tx) => storeMatchPoints(tx, m.id, ps));
}
