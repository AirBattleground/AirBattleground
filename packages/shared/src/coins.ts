/**
 * BG coins (phase 7). The manager sets `winCoins` on a scrim or tournament; when a match is published, the team in
 * placement #1 earns that many coins, credited to the team's leader. Unpublishing a match takes them back.
 *
 * PLAYER (role PLAYER; works without a team)
 *   GET /api/team/coins/leaderboard                     → CoinLeaderboard   (total distributed + top 10 teams)
 *   GET /api/team/coins                                 → CoinWallet        (the player's team: balance + transactions;
 *                                                                            team null when not in a team)
 *   Redeeming is planned (CoinWallet.redeemEnabled is false for now).
 * MANAGER
 *   POST/PATCH /api/manager/scrims[/:id]       { winCoins }   (CreateScrimInput / UpdateScrimInput; default 0)
 *   POST/PATCH /api/manager/tournaments[/:id]  { winCoins }   (CreateTournamentInput / UpdateTournamentInput; default 0)
 *   Scrim.winCoins and TournamentSummary.winCoins carry the amount.
 */
import { z } from "zod";

export const MAX_WIN_COINS = 100_000;
export const COIN_LEADERBOARD_SIZE = 10;

export const winCoinsSchema = z
  .number({ invalid_type_error: "Enter a number" })
  .int("Whole coins only")
  .min(0, "Can't be negative")
  .max(MAX_WIN_COINS, `At most ${MAX_WIN_COINS.toLocaleString("en-IN")} coins`);

export interface CoinLeaderboardRow {
  rank: number;
  team: { id: string; name: string; tag: string; logoUrl: string | null };
  /** the team's current leader */
  leader: { displayName: string; ign: string | null; avatarUrl: string | null };
  coins: number;
  /** matches won that paid coins */
  wins: number;
}

export interface CoinTransaction {
  id: string;
  /** coins in (+); redemptions will be negative later */
  amount: number;
  kind: "MATCH_WIN" | "CHAMPION";
  /** "Won Match 2" / "Champion" */
  title: string;
  /** event + details, e.g. "Evening Scrims · Sat, 18 Oct · Match 2" */
  detail: string;
  /** who the coins were credited to (the leader at the time) */
  creditedTo: string;
  /** link inside the team portal, when there is one */
  href: string | null;
  createdAt: string;
}

export interface CoinWallet {
  team: { id: string; name: string; tag: string; logoUrl: string | null } | null;
  /** the team's current leader */
  leader: { displayName: string; ign: string | null } | null;
  balance: number;
  wins: number;
  /** rank among teams with coins; null when the team has none yet */
  rank: number | null;
  transactions: CoinTransaction[];
  /** redeeming coins is coming later */
  redeemEnabled: boolean;
}

export interface CoinLeaderboard {
  /** all BG coins ever awarded */
  totalDistributed: number;
  /** coin-paying match wins */
  totalWins: number;
  top: CoinLeaderboardRow[];
  /** the signed-in player's team, when it has coins (also when outside the top 10); null otherwise */
  myTeam: CoinLeaderboardRow | null;
}
