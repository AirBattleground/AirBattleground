import type { TeamScrimOnDate } from "@7xen/shared";

/** The team holds a place in this scrim (joined, or waiting on an older approval). */
export const isMine = (s: TeamScrimOnDate) => s.myRegistration?.status === "APPROVED" || s.myRegistration?.status === "PENDING";

/**
 * Where a scrim sits in a team's list (lower first), or null when it shouldn't be listed:
 * 0 = open to register, 1 = my team is in it (upcoming or running), 2 = the rest (full, paused, removed).
 * Once registration closes only teams in it still see it; the API also drops finished nights for everyone —
 * checked here too so a cached list doesn't show a closed scrim until the next poll.
 */
export function listRank(s: TeamScrimOnDate, now = Date.now()): number | null {
  if (isMine(s)) return 1;
  if (now >= new Date(s.registrationClosesAt ?? s.startsAt).getTime()) return null;
  if (s.registrationOpen && s.counts.slotsLeft > 0) return 0;
  return 2;
}

/** A team's scrim list: hidden ones dropped, then open to register → mine → the rest, each by start time. */
export function forTeamList(items: TeamScrimOnDate[] | undefined, now = Date.now()): TeamScrimOnDate[] {
  return (items ?? [])
    .map((s) => ({ s, rank: listRank(s, now) }))
    .filter((x): x is { s: TeamScrimOnDate; rank: number } => x.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.s.startsAt.localeCompare(b.s.startsAt))
    .map((x) => x.s);
}
