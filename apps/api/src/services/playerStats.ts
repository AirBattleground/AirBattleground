/** Player statistics: the caller's published match rows → computePlayerStats / computeTdmStats. Contract: packages/shared/src/playerStats.ts */
import { Prisma } from "@prisma/client";
import {
  computePlayerStats,
  computeTdmStats,
  type PlayerMatchRow,
  type PlayerStats,
  type PlayerStatsPeriod,
  type PlayerStatsQuery,
  type TdmMatchRow,
  type TdmPlayerStats,
  type TdmStatsQuery,
} from "@7xen/shared";
import { prisma } from "../db.js";

const PERIOD_DAYS: Record<PlayerStatsPeriod, number | null> = { ALL_TIME: null, LAST_30_DAYS: 30, LAST_7_DAYS: 7 };

const sinceOf = (period: PlayerStatsPeriod) => {
  const days = PERIOD_DAYS[period];
  return days == null ? null : new Date(Date.now() - days * 86_400_000);
};

const inPeriod = <R extends { playedAt: string }>(rows: R[], since: Date | null) => (since ? rows.filter((r) => new Date(r.playedAt) >= since) : rows);

/** TDM battles live in TDM-mode tournaments; scrims are always battle royale. */
const TDM_MATCH: Prisma.MatchWhereInput = { group: { stage: { tournament: { mode: "TDM" } } } };
const BR_MATCH: Prisma.MatchWhereInput = { OR: [{ groupId: null }, { group: { stage: { tournament: { mode: "BR" } } } }] };

const matchSelect = {
  id: true,
  map: true,
  scheduledAt: true,
  publishedAt: true,
  createdAt: true,
  session: { select: { scrim: { select: { title: true } } } },
  group: { select: { stage: { select: { tournament: { select: { title: true } } } } } },
} satisfies Prisma.MatchSelect;

const playedAt = (m: { scheduledAt: Date | null; publishedAt: Date | null; createdAt: Date }) => (m.scheduledAt ?? m.publishedAt ?? m.createdAt).toISOString();

export async function getPlayerStats(userId: string, q: PlayerStatsQuery): Promise<PlayerStats> {
  const rows = await prisma.matchPlayer.findMany({
    where: {
      userId,
      matchTeam: {
        match: {
          status: "PUBLISHED",
          AND: [BR_MATCH, q.scope === "SCRIMS" ? { sessionId: { not: null } } : q.scope === "TOURNAMENTS" ? { groupId: { not: null } } : {}],
        },
      },
    },
    select: {
      kills: true,
      matchTeam: { select: { placement: true, kills: true, totalPoints: true, team: { select: { name: true } }, match: { select: matchSelect } } },
    },
  });
  const matchRows: PlayerMatchRow[] = rows.map(({ kills, matchTeam: mt }) => {
    const m = mt.match;
    return {
      matchId: m.id,
      playedAt: playedAt(m),
      map: m.map,
      kind: m.group ? "TOURNAMENT" : "SCRIM",
      eventTitle: m.group?.stage.tournament.title ?? m.session?.scrim.title ?? "",
      teamName: mt.team?.name ?? null,
      placement: mt.placement,
      kills,
      teamKills: mt.kills,
      teamPoints: mt.totalPoints,
    };
  });
  return computePlayerStats(inPeriod(matchRows, sinceOf(q.period)), q.scope, q.period);
}

/** TDM Results: the player's published TDM battles, with the opponent's name and kills. */
export async function getTdmStats(userId: string, q: TdmStatsQuery): Promise<TdmPlayerStats> {
  const rows = await prisma.matchPlayer.findMany({
    where: { userId, matchTeam: { match: { status: "PUBLISHED", ...TDM_MATCH } } },
    select: {
      kills: true,
      matchTeam: {
        select: {
          id: true,
          placement: true,
          kills: true,
          team: { select: { name: true } },
          match: { select: { ...matchSelect, teams: { select: { id: true, kills: true, team: { select: { name: true } } } } } },
        },
      },
    },
  });
  const battleRows: TdmMatchRow[] = rows.map(({ kills, matchTeam: mt }) => {
    const m = mt.match;
    const opp = m.teams.find((t) => t.id !== mt.id);
    return {
      matchId: m.id,
      playedAt: playedAt(m),
      map: m.map,
      eventTitle: m.group?.stage.tournament.title ?? "",
      teamName: mt.team?.name ?? null,
      opponentName: opp?.team?.name ?? null,
      placement: mt.placement,
      kills,
      teamKills: mt.kills,
      opponentKills: opp?.kills ?? null,
    };
  });
  return computeTdmStats(inPeriod(battleRows, sinceOf(q.period)), q.period);
}
