/** phase 5: TEAM logins are gone — players sign up themselves (PLAYER) and form teams. */
export const ROLES = ["ADMIN", "MANAGER", "PLAYER"] as const;
export type Role = (typeof ROLES)[number];

/** How a scrim repeats. ONCE = single date, DAILY = every day, WEEKENDS = Saturday + Sunday only. */
export const RECURRENCES = ["ONCE", "DAILY", "WEEKENDS"] as const;
export type Recurrence = (typeof RECURRENCES)[number];

export const SCRIM_STATUSES = ["ACTIVE", "PAUSED", "ARCHIVED"] as const;
export type ScrimStatus = (typeof SCRIM_STATUSES)[number];

/** Preset artwork drawn for a scrim with no uploaded poster (add a preset here + its art in the web app). */
export const POSTER_TEMPLATES = ["TOPO", "DROPZONE", "LINEUP"] as const;
export type PosterTemplate = (typeof POSTER_TEMPLATES)[number];
export const DEFAULT_POSTER_TEMPLATE: PosterTemplate = "TOPO";

export const REGISTRATION_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

/** Battle royale maps. */
export const BR_MAPS = ["ERANGEL", "MIRAMAR", "SANHOK", "VIKENDI", "LIVIK", "KARAKIN", "NUSA", "RONDO"] as const;
/** Team Deathmatch (TDM) arena maps. */
export const TDM_MAPS = ["WAREHOUSE", "HANGAR", "RUINS", "LIBRARY", "TOWN"] as const;
/** Battlegrounds maps. Each entry in a scrim's `maps` array is one match of the session, in order. */
export const MAPS = [...BR_MAPS, ...TDM_MAPS] as const;
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
  WAREHOUSE: "TDM · Warehouse",
  HANGAR: "TDM · Hangar",
  RUINS: "TDM · Ruins",
  LIBRARY: "TDM · Library",
  TOWN: "TDM · Town",
};

export const isTdmMap = (m: GameMap): boolean => (TDM_MAPS as readonly string[]).includes(m);

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

/** How far ahead of a match day a scrim's registration may open. */
export const MAX_REG_OPEN_DAYS_BEFORE = 7;

/** A manager's request for a new team login; only the admin can approve it. */
export const TEAM_REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type TeamRequestStatus = (typeof TEAM_REQUEST_STATUSES)[number];

export const TEAM_REQUEST_STATUS_LABELS: Record<TeamRequestStatus, string> = {
  PENDING: "Waiting for admin",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};
