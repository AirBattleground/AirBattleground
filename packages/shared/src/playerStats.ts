/**
 * Player statistics — one player's report built from published match results (MatchPlayer rows linked to the
 * player's account), across every team they played for.
 *
 * PLAYER (role PLAYER, cookie sx_app)
 *   GET    /api/player/stats?scope=ALL|SCRIMS|TOURNAMENTS&period=ALL_TIME|LAST_30_DAYS|LAST_7_DAYS → PlayerStats
 *
 * Only what results record is used: placement + team kills (MatchTeam) and the player's own kills (MatchPlayer).
 * The radar axes and the rating are derived from those (see PLAYER_RATING); every axis is 0–100.
 */
import { z } from "zod";

export const PLAYER_STATS_SCOPES = ["ALL", "SCRIMS", "TOURNAMENTS"] as const;
export type PlayerStatsScope = (typeof PLAYER_STATS_SCOPES)[number];
export const PLAYER_STATS_PERIODS = ["ALL_TIME", "LAST_30_DAYS", "LAST_7_DAYS"] as const;
export type PlayerStatsPeriod = (typeof PLAYER_STATS_PERIODS)[number];

export const playerStatsQuerySchema = z.object({
  scope: z.enum(PLAYER_STATS_SCOPES).default("ALL"),
  period: z.enum(PLAYER_STATS_PERIODS).default("ALL_TIME"),
});
export type PlayerStatsQuery = z.infer<typeof playerStatsQuerySchema>;

/** Matches needed before a rating/grade is shown (fewer is too noisy). */
export const MIN_RATED_MATCHES = 5;

/** What "maxed out" means for each radar axis. Lobbies are up to 16 teams in scrims. */
export const PLAYER_RATING = {
  combatKillsPerMatch: 4,
  lobbySize: 16,
  winRate: 0.3,
  top5Rate: 0.7,
  killShare: 0.4,
} as const;

export const PLAYER_GRADES = ["SS", "S", "A", "B", "C", "D"] as const;
export type PlayerGrade = (typeof PLAYER_GRADES)[number];

/** One published match the player played in (input of computePlayerStats). */
export interface PlayerMatchRow {
  matchId: string;
  /** ISO time the match was played (scheduled time, else publish time) */
  playedAt: string;
  map: string;
  kind: "SCRIM" | "TOURNAMENT";
  /** scrim or tournament title */
  eventTitle: string;
  teamName: string | null;
  placement: number | null;
  kills: number | null;
  teamKills: number | null;
  teamPoints: number | null;
}

export interface PlayerStatsRadar {
  /** kills per match */
  combat: number;
  /** average placement */
  survival: number;
  /** win rate */
  wins: number;
  /** top-5 rate */
  consistency: number;
  /** share of the team's kills */
  impact: number;
}

export interface PlayerMapStats {
  map: string;
  matches: number;
  wins: number;
  kills: number;
  avgPlacement: number | null;
}

export interface PlayerRecentMatch {
  matchId: string;
  playedAt: string;
  map: string;
  kind: "SCRIM" | "TOURNAMENT";
  eventTitle: string;
  placement: number | null;
  kills: number;
}

export interface PlayerStats {
  scope: PlayerStatsScope;
  period: PlayerStatsPeriod;
  matches: number;
  wins: number;
  top5: number;
  kills: number;
  killsPerMatch: number;
  /** 0–1 */
  winRate: number;
  /** 0–1 */
  top5Rate: number;
  avgPlacement: number | null;
  /** 0–1 share of the team's kills in the matches played; null when team kills are unknown */
  killShare: number | null;
  avgTeamPoints: number | null;
  best: PlayerRecentMatch | null;
  /** null until MIN_RATED_MATCHES */
  rating: number | null;
  grade: PlayerGrade | null;
  radar: PlayerStatsRadar;
  /** most played first */
  maps: PlayerMapStats[];
  /** newest first, at most 10 */
  recent: PlayerRecentMatch[];
  /** oldest → newest, at most 20 (kills + placement per match, for the form chart) */
  trend: { playedAt: string; kills: number; placement: number | null }[];
}

const clamp100 = (n: number) => Math.max(0, Math.min(100, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

export function gradeFor(rating: number): PlayerGrade {
  if (rating >= 90) return "SS";
  if (rating >= 80) return "S";
  if (rating >= 70) return "A";
  if (rating >= 55) return "B";
  if (rating >= 40) return "C";
  return "D";
}

const toRecent = (r: PlayerMatchRow): PlayerRecentMatch => ({
  matchId: r.matchId,
  playedAt: r.playedAt,
  map: r.map,
  kind: r.kind,
  eventTitle: r.eventTitle,
  placement: r.placement,
  kills: r.kills ?? 0,
});

/** The player's report from their match rows (any order). Pure — the API only loads and filters the rows. */
export function computePlayerStats(rows: PlayerMatchRow[], scope: PlayerStatsScope = "ALL", period: PlayerStatsPeriod = "ALL_TIME"): PlayerStats {
  const sorted = [...rows].sort((a, b) => a.playedAt.localeCompare(b.playedAt));
  const n = sorted.length;
  const placed = sorted.filter((r) => r.placement != null);
  const kills = sorted.reduce((s, r) => s + (r.kills ?? 0), 0);
  const wins = placed.filter((r) => r.placement === 1).length;
  const top5 = placed.filter((r) => r.placement! <= 5).length;
  const withTeamKills = sorted.filter((r) => r.teamKills != null && r.teamKills > 0);
  const teamKills = withTeamKills.reduce((s, r) => s + r.teamKills!, 0);
  const pointsRows = sorted.filter((r) => r.teamPoints != null);

  const killsPerMatch = n ? kills / n : 0;
  const winRate = placed.length ? wins / placed.length : 0;
  const top5Rate = placed.length ? top5 / placed.length : 0;
  const avgPlacement = placed.length ? placed.reduce((s, r) => s + r.placement!, 0) / placed.length : null;
  const killShare = teamKills ? withTeamKills.reduce((s, r) => s + (r.kills ?? 0), 0) / teamKills : null;

  const R = PLAYER_RATING;
  const radar: PlayerStatsRadar = {
    combat: round1(clamp100((killsPerMatch / R.combatKillsPerMatch) * 100)),
    survival: avgPlacement == null ? 0 : round1(clamp100(((R.lobbySize - avgPlacement) / (R.lobbySize - 1)) * 100)),
    wins: round1(clamp100((winRate / R.winRate) * 100)),
    consistency: round1(clamp100((top5Rate / R.top5Rate) * 100)),
    impact: killShare == null ? 0 : round1(clamp100((killShare / R.killShare) * 100)),
  };
  const rated = n >= MIN_RATED_MATCHES;
  const rating = rated ? round1((radar.combat + radar.survival + radar.wins + radar.consistency + radar.impact) / 5) : null;

  const byMap = new Map<string, PlayerMatchRow[]>();
  for (const r of sorted) byMap.set(r.map, [...(byMap.get(r.map) ?? []), r]);
  const maps: PlayerMapStats[] = [...byMap].map(([map, ms]) => {
    const p = ms.filter((r) => r.placement != null);
    return {
      map,
      matches: ms.length,
      wins: p.filter((r) => r.placement === 1).length,
      kills: ms.reduce((s, r) => s + (r.kills ?? 0), 0),
      avgPlacement: p.length ? round1(p.reduce((s, r) => s + r.placement!, 0) / p.length) : null,
    };
  });
  maps.sort((a, b) => b.matches - a.matches || b.kills - a.kills);

  // best match: most kills, then better placement, then most recent
  const best = sorted.reduce<PlayerMatchRow | null>((b, r) => {
    if (!b) return r;
    const k = (r.kills ?? 0) - (b.kills ?? 0);
    if (k !== 0) return k > 0 ? r : b;
    const p = (b.placement ?? 99) - (r.placement ?? 99);
    return p > 0 || (p === 0 && r.playedAt > b.playedAt) ? r : b;
  }, null);

  return {
    scope,
    period,
    matches: n,
    wins,
    top5,
    kills,
    killsPerMatch: round1(killsPerMatch),
    winRate,
    top5Rate,
    avgPlacement: avgPlacement == null ? null : round1(avgPlacement),
    killShare,
    avgTeamPoints: pointsRows.length ? round1(pointsRows.reduce((s, r) => s + r.teamPoints!, 0) / pointsRows.length) : null,
    best: best ? toRecent(best) : null,
    rating,
    grade: rating == null ? null : gradeFor(rating),
    radar,
    maps,
    recent: sorted.slice(-10).reverse().map(toRecent),
    trend: sorted.slice(-20).map((r) => ({ playedAt: r.playedAt, kills: r.kills ?? 0, placement: r.placement })),
  };
}
