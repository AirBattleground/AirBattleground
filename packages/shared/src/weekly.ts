/**
 * Weekly Board (Night Royale): a scrim's Monday–Friday points table — every published match of the week's sessions
 * added up with the scrim's points system (same tie-breakers as a session) — and the Finals Slot its #1 can win: an
 * invite straight into the final stage of one of the organiser's upcoming tournaments, shown as a card on the team's
 * profile.
 *
 * TEAM (players; every signed-in player can see a board — it's the scrim's public leaderboard)
 *   GET  /api/team/scrims/:scrimId/weekly?week=YYYY-MM-DD     → WeeklyBoard  (week = any day of it; default this week)
 *   GET  /api/team/finals-slots                                → ListResponse<FinalsSlot>  (my team's, not yet played)
 * MANAGER (own scrims)
 *   GET  /api/manager/scrims/:id/weekly?week=                  → WeeklyBoard
 *   GET  /api/manager/finals-targets                           → ListResponse<FinalsTarget>
 *   POST /api/manager/scrims/:id/weekly/finals-slot  GiveFinalsSlotInput → WeeklyBoard
 *        409 CONFLICT when the week isn't over, has no results, was already given, or the final has no free invite slot.
 */
import { z } from "zod";
import { addDays, weekdayOf } from "./schedule";
import { dateString } from "./schemas";
import type { SessionStandings } from "./phase2";

/** Nights on a Weekly Board: Monday–Friday. */
export const WEEKLY_DAYS = 5;

/** Monday of the week `date` falls in ("YYYY-MM-DD"). */
export function weekStartOf(date: string): string {
  return addDays(date, -((weekdayOf(date) + 6) % 7));
}

export const weeklyQuerySchema = z.object({ week: dateString.optional() });

export const giveFinalsSlotSchema = z.object({
  /** any day of the week (its Monday is used) */
  week: dateString,
  tournamentId: z.string().min(1, "Pick a tournament"),
});
export type GiveFinalsSlotInput = z.infer<typeof giveFinalsSlotSchema>;

/**
 * SessionStandings shape so the points table renders it as-is: `matches` holds one column per night (number 1–5 =
 * Mon–Fri, id = that night's first match or "day-<date>"), each row's `perMatch` is that night's total, and `date` is
 * the Monday.
 */
export interface WeeklyBoard extends SessionStandings {
  week: {
    start: string;
    end: string;
    /** the 5 nights, Mon–Fri (index i ↔ matches number i + 1) */
    days: string[];
    /** today is in this week */
    current: boolean;
    /** Friday has passed (in IST) — the board is final */
    over: boolean;
  };
  /** the week's Finals Slot once the organiser gave it */
  finalsSlot: { teamId: string; tournament: { id: string; title: string }; stageName: string } | null;
}

/** A Finals Slot my team holds (an invite into an upcoming tournament's last stage). */
export interface FinalsSlot {
  entryId: string;
  tournament: { id: string; title: string; posterUrl: string | null; organizer: string };
  stage: { order: number; name: string; startDate: string | null };
  /** what it was won for, e.g. "Night Royale · Weekly Board #1 · 19–23 Oct" (null = a plain invite) */
  note: string | null;
  awardedAt: string;
}

/** One of the organiser's tournaments that a Finals Slot can go to. */
export interface FinalsTarget {
  id: string;
  title: string;
  stageName: string;
  startDate: string | null;
  invitesLeft: number;
}
