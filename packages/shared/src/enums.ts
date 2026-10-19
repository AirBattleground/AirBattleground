/** phase 5: TEAM logins are gone — players sign up themselves (PLAYER) and form teams. */
export const ROLES = ["ADMIN", "MANAGER", "PLAYER"] as const;
export type Role = (typeof ROLES)[number];

/** How a scrim repeats. ONCE = single date, DAILY = every day, WEEKENDS = Saturday + Sunday only. */
export const RECURRENCES = ["ONCE", "DAILY", "WEEKENDS"] as const;
export type Recurrence = (typeof RECURRENCES)[number];

export const SCRIM_STATUSES = ["ACTIVE", "PAUSED", "ARCHIVED"] as const;
export type ScrimStatus = (typeof SCRIM_STATUSES)[number];

export const REGISTRATION_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

/** Battlegrounds maps. Each entry in a scrim's `maps` array is one match of the session, in order. */
export const MAPS = ["ERANGEL", "MIRAMAR", "SANHOK", "VIKENDI", "LIVIK", "KARAKIN", "NUSA", "RONDO"] as const;
export type GameMap = (typeof MAPS)[number];

export const MAP_LABELS: Record<GameMap, string> = {
  ERANGEL: "Erangel",
  MIRAMAR: "Miramar",
  SANHOK: "Sanhok",
  VIKENDI: "Vikendi",
  LIVIK: "Livik",
  KARAKIN: "Karakin",
  NUSA: "Nusa",
  RONDO: "Rondo",
};

export const RECURRENCE_LABELS: Record<Recurrence, string> = {
  ONCE: "One-time",
  DAILY: "Daily",
  WEEKENDS: "Weekends (Sat & Sun)",
};

export const REGISTRATION_STATUS_LABELS: Record<RegistrationStatus, string> = {
  PENDING: "Waiting for approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

/** Max squads in a Battlegrounds custom room. Slot numbers run 1..MAX_ROOM_SLOTS. */
export const MAX_ROOM_SLOTS = 25;

/** A manager's request for a new team login; only the admin can approve it. */
export const TEAM_REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type TeamRequestStatus = (typeof TEAM_REQUEST_STATUSES)[number];

export const TEAM_REQUEST_STATUS_LABELS: Record<TeamRequestStatus, string> = {
  PENDING: "Waiting for admin",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};
