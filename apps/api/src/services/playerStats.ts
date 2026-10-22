/** Player statistics: the caller's published match rows → computePlayerStats. Contract: packages/shared/src/playerStats.ts */
import { computePlayerStats, type PlayerMatchRow, type PlayerStats, type PlayerStatsQuery } from "@7xen/shared";
import { prisma } from "../db.js";

const PERIOD_DAYS: Record<PlayerStatsQuery["period"], number | null> = { ALL_TIME: null, LAST_30_DAYS: 30, LAST_7_DAYS: 7 };

export async function getPlayerStats(userId: string, q: PlayerStatsQuery): Promise<PlayerStats> {
  const days = PERIOD_DAYS[q.period];
  const since = days == null ? null : new Date(Date.now() - days * 86_400_000);
  const rows = await prisma.matchPlayer.findMany({
    where: {
      userId,
      matchTeam: {
        match: {
          status: "PUBLISHED",
          ...(q.scope === "SCRIMS" ? { sessionId: { not: null } } : q.scope === "TOURNAMENTS" ? { groupId: { not: null } } : {}),
        },
      },
    },
    select: {
      kills: true,
      matchTeam: {
        select: {
          placement: true,
          kills: true,
          totalPoints: true,
          team: { select: { name: true } },
          match: {
            select: {
              id: true,
              map: true,
              scheduledAt: true,
              publishedAt: true,
              createdAt: true,
              session: { select: { scrim: { select: { title: true } } } },
              group: { select: { stage: { select: { tournament: { select: { title: true } } } } } },
            },
          },
        },
      },
    },
  });
  const matchRows: PlayerMatchRow[] = rows.map(({ kills, matchTeam: mt }) => {
    const m = mt.match;
    return {
      matchId: m.id,
      playedAt: (m.scheduledAt ?? m.publishedAt ?? m.createdAt).toISOString(),
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
  return computePlayerStats(since ? matchRows.filter((r) => new Date(r.playedAt) >= since) : matchRows, q.scope, q.period);
}
