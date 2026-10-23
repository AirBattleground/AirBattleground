/**
 * BG coins (phase 7, shared/coins.ts): the winner of a published match earns its scrim's / tournament's winCoins,
 * credited to the team's leader. One CoinAward row per match; unpublishing removes it.
 */
import { COIN_LEADERBOARD_SIZE, MAP_LABELS, type CoinLeaderboard, type CoinLeaderboardRow, type CoinTransaction, type CoinWallet, type GameMap } from "@7xen/shared";
import { prisma, type Tx } from "../db.js";
import { avatarOf, brandingUrl, dateToStr } from "../lib/serialize.js";
import { shortDate } from "./matchContext.js";

const WALLET_TX_LIMIT = 200;

/** The player's team wallet: balance, rank and every coin award (newest first). Redeeming comes later. */
export async function coinWallet(teamId: string | null): Promise<CoinWallet> {
  const empty: CoinWallet = { team: null, leader: null, balance: 0, wins: 0, rank: null, transactions: [], redeemEnabled: false };
  if (!teamId) return empty;
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true, name: true, tag: true, logoKey: true, leader: { select: { displayName: true, ign: true } } },
  });
  if (!team) return empty;
  const [awards, board] = await Promise.all([
    prisma.coinAward.findMany({
      where: { teamId },
      orderBy: { createdAt: "desc" },
      take: WALLET_TX_LIMIT,
      include: {
        user: { select: { displayName: true, ign: true } },
        tournament: { select: { id: true, title: true } },
        match: {
          select: {
            id: true,
            number: true,
            map: true,
            session: { select: { date: true, scrim: { select: { id: true, title: true } } } },
            group: { select: { name: true, stage: { select: { name: true, tournament: { select: { id: true, title: true, mode: true } } } } } },
          },
        },
      },
    }),
    coinLeaderboard(teamId),
  ]);
  const totals = await prisma.coinAward.aggregate({ where: { teamId }, _sum: { amount: true }, _count: { _all: true } });

  const transactions = awards.map((a): CoinTransaction => {
    const base = { id: a.id, amount: a.amount, creditedTo: a.user.ign ?? a.user.displayName, createdAt: a.createdAt.toISOString() };
    if (a.tournament) {
      return { ...base, kind: "CHAMPION", title: "Champion", detail: a.tournament.title, href: `/team/tournaments/${a.tournament.id}` };
    }
    const m = a.match;
    const map = m ? (MAP_LABELS[m.map as GameMap] ?? m.map) : "";
    if (m?.session) {
      const date = dateToStr(m.session.date);
      return {
        ...base,
        kind: "MATCH_WIN",
        title: `Won Match ${m.number}`,
        detail: `${m.session.scrim.title} · ${shortDate(date)} · ${map}`,
        href: `/team/results/${m.session.scrim.id}/${date}/matches/${m.id}`,
      };
    }
    if (m?.group) {
      const t = m.group.stage.tournament;
      return {
        ...base,
        kind: "MATCH_WIN",
        title: `Won Match ${m.number}`,
        detail: `${t.title} · ${m.group.stage.name} · Group ${m.group.name} · ${map}`,
        href: `/team/tournaments/${t.id}/matches/${m.id}`,
      };
    }
    return { ...base, kind: "MATCH_WIN", title: "Match win", detail: "", href: null };
  });

  return {
    team: { id: team.id, name: team.name, tag: team.tag, logoUrl: brandingUrl(team.logoKey) },
    leader: { displayName: team.leader.displayName, ign: team.leader.ign },
    balance: totals._sum.amount ?? 0,
    wins: totals._count._all,
    rank: board.myTeam?.rank ?? null,
    transactions,
    redeemEnabled: false,
  };
}

/** Award the match winner (placement #1). Call inside the publish transaction, after placements are final. */
export async function awardMatchCoins(tx: Tx, matchId: string, amount: number): Promise<void> {
  await tx.coinAward.deleteMany({ where: { matchId } });
  if (amount <= 0) return;
  const winner = await tx.matchTeam.findFirst({
    where: { matchId, placement: 1, teamId: { not: null } },
    select: { team: { select: { id: true, leaderId: true } } },
  });
  if (!winner?.team) return;
  await tx.coinAward.create({ data: { matchId, teamId: winner.team.id, userId: winner.team.leaderId, amount } });
}

/** TDM battles: the champion earns the battle's winCoins (re-run safe: replaces any earlier award). */
export async function awardChampionCoins(tx: Tx, tournamentId: string): Promise<void> {
  const t = await tx.tournament.findUnique({
    where: { id: tournamentId },
    select: { mode: true, winCoins: true, champion: { select: { id: true, leaderId: true } } },
  });
  await tx.coinAward.deleteMany({ where: { tournamentId } });
  if (!t || t.mode !== "TDM" || t.winCoins <= 0 || !t.champion) return;
  await tx.coinAward.create({ data: { tournamentId, teamId: t.champion.id, userId: t.champion.leaderId, amount: t.winCoins } });
}

/** Take back the coins of an unpublished match. */
export async function revokeMatchCoins(tx: Tx, matchId: string): Promise<void> {
  await tx.coinAward.deleteMany({ where: { matchId } });
}

/** Total coins distributed + the top teams; `myTeamId` adds the player's own team row. */
export async function coinLeaderboard(myTeamId: string | null): Promise<CoinLeaderboard> {
  const groups = await prisma.coinAward.groupBy({ by: ["teamId"], _sum: { amount: true }, _count: { _all: true } });
  const ranked = groups
    .map((g) => ({ teamId: g.teamId, coins: g._sum.amount ?? 0, wins: g._count._all }))
    .filter((g) => g.coins > 0)
    .sort((a, b) => b.coins - a.coins || b.wins - a.wins);

  const top = ranked.slice(0, COIN_LEADERBOARD_SIZE);
  const mine = myTeamId ? ranked.findIndex((g) => g.teamId === myTeamId) : -1;
  const ids = [...new Set([...top.map((g) => g.teamId), ...(mine >= 0 ? [myTeamId!] : [])])];
  const teams = await prisma.team.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, tag: true, logoKey: true, leader: { select: { displayName: true, ign: true, avatarUrl: true, avatarKey: true } } },
  });
  const byId = new Map(teams.map((t) => [t.id, t]));

  // equal coins and wins share a rank
  const rankOf = (i: number) => {
    let r = i;
    while (r > 0 && ranked[r - 1]!.coins === ranked[i]!.coins && ranked[r - 1]!.wins === ranked[i]!.wins) r--;
    return r + 1;
  };
  const row = (i: number): CoinLeaderboardRow | null => {
    const g = ranked[i]!;
    const t = byId.get(g.teamId);
    if (!t) return null;
    return {
      rank: rankOf(i),
      team: { id: t.id, name: t.name, tag: t.tag, logoUrl: brandingUrl(t.logoKey) },
      leader: { displayName: t.leader.displayName, ign: t.leader.ign, avatarUrl: avatarOf(t.leader) },
      coins: g.coins,
      wins: g.wins,
    };
  };

  return {
    totalDistributed: ranked.reduce((n, g) => n + g.coins, 0),
    totalWins: ranked.reduce((n, g) => n + g.wins, 0),
    top: top.map((_, i) => row(i)).filter((r): r is CoinLeaderboardRow => r !== null),
    myTeam: mine >= 0 ? row(mine) : null,
  };
}
