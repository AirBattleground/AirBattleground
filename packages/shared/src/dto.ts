/**
 * API response shapes. Every successful response is the DTO itself (no envelope).
 * Every error response is `ApiErrorBody` with an HTTP 4xx/5xx status.
 * Dates are "YYYY-MM-DD"; timestamps are ISO-8601 strings.
 */
import type { GameMap, Recurrence, RegistrationStatus, Role, ScrimStatus, TeamRequestStatus } from "./enums";

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "SLOTS_FULL"
  | "REGISTRATION_CLOSED"
  | "RATE_LIMITED"
  /** phase 2: the screenshot reader service is unreachable (HTTP 503) */
  | "EXTRACTOR_OFFLINE"
  /** phase 4: resumable upload chunk sent at the wrong offset (HTTP 409; body also carries `offset`) */
  | "OFFSET_MISMATCH"
  /** phase 4: not enough free disk space for a video upload (HTTP 507) */
  | "STORAGE_FULL"
  /** phase 5 (players & teams, see players.ts) */
  | "NO_TEAM"
  | "LEADER_ONLY"
  | "ALREADY_IN_TEAM"
  | "TEAM_FULL"
  | "BGMI_ID_REQUIRED"
  | "BGMI_ID_TAKEN"
  | "INVITE_INVALID"
  | "JOIN_REQUEST_PENDING"
  | "INTERNAL";

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    /** field path → message, for VALIDATION_ERROR */
    fields?: Record<string, string>;
  };
}

export interface TeamSummary {
  id: string;
  name: string;
  tag: string;
}

export interface SessionUser {
  id: string;
  /** null for players (they sign in with Google) */
  username: string | null;
  role: Role;
  displayName: string;
  /** role PLAYER: the player's team (null when not in a team) */
  team: TeamSummary | null;
  /** role PLAYER only (null otherwise) */
  player: import("./players").SessionPlayer | null;
}

export interface AuthResponse {
  user: SessionUser;
}

// ---------- admin ----------
export interface AdminStats {
  managers: { total: number; active: number };
  teams: { total: number; active: number };
  scrims: { total: number; active: number };
  registrations: { pending: number; approvedUpcoming: number };
  /** manager-submitted team logins waiting for the admin (phase 5: always 0 — team requests are gone) */
  teamRequests: { pending: number };
  /** phase 5 (additive): player accounts */
  players?: { total: number; active: number };
}

export interface ManagerRow {
  id: string;
  /** null for managers who joined by invitation (they sign in with Google) */
  username: string | null;
  displayName: string;
  /** phase 5b (additive): organisation name from the invitation */
  orgName?: string | null;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  scrimCount: number;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface TeamRow {
  id: string;
  name: string;
  tag: string;
  /** phase 5: teams are groups of players with a leader (no team logins any more) */
  leader: import("./players").PlayerSummary | null;
  memberCount: number;
  registrationCount: number;
  createdAt: string;
}

export interface TeamRequestRow {
  id: string;
  status: TeamRequestStatus;
  teamName: string;
  tag: string;
  captainName: string | null;
  username: string;
  email: string | null;
  phone: string | null;
  rejectionReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  manager: { id: string; displayName: string };
  /** the created team once APPROVED */
  teamId: string | null;
}

export interface AvailabilityResult {
  available: boolean;
  /** why not, in plain words, e.g. "Already taken" / "Waiting for admin approval in another request" */
  message: string | null;
}
export interface TeamAvailability {
  teamName?: AvailabilityResult;
  username?: AvailabilityResult;
}

export interface ListResponse<T> {
  items: T[];
}

// ---------- branding (org logo + posters) ----------
/** The manager running a scrim/tournament, with their organisation logo. */
export interface OrganizerRef {
  id: string;
  displayName: string;
  /** organisation logo URL; null/absent = none uploaded */
  logoUrl?: string | null;
}

/** Response of every image upload/remove endpoint (org logo, scrim poster, tournament poster). */
export interface ImageUrlResponse {
  url: string | null;
}

// ---------- scrims ----------
export interface Scrim {
  id: string;
  title: string;
  description: string | null;
  maps: GameMap[];
  startTime: string;
  recurrence: Recurrence;
  startDate: string;
  endDate: string | null;
  slotCount: number;
  firstSlot: number;
  status: ScrimStatus;
  /** phase 2: points table rules */
  pointsSystem: { placement: number[]; killPoints: number };
  manager: OrganizerRef;
  /** poster image URL (GET it with the session cookie); null = none uploaded */
  posterUrl: string | null;
  /** phase 7: BG coins for each match winner (0 = none) */
  winCoins: number;
  createdAt: string;
}

/** A scrim as it runs on one specific date, with live counts. */
export interface ScrimOnDate {
  scrim: Scrim;
  date: string;
  /** ISO instant the session starts; registration closes at this time */
  startsAt: string;
  registrationOpen: boolean;
  counts: { pending: number; approved: number; slotsLeft: number };
}

/** Team view of a scrim on a date: includes the team's own registration if any. */
export interface TeamScrimOnDate extends ScrimOnDate {
  myRegistration: { id: string; status: RegistrationStatus; slotNumber: number | null; rejectionReason: string | null } | null;
  /** phase 5 (additive): the team's OPEN "ask my leader" suggestion for this scrim + date */
  mySuggestion?: { id: string; fromIgn: string | null } | null;
}

export interface Registration {
  id: string;
  status: RegistrationStatus;
  slotNumber: number | null;
  rejectionReason: string | null;
  createdAt: string;
  decidedAt: string | null;
  team: TeamSummary & { captainName: string | null };
}

/** Manager detail of one scrim on one date. */
export interface SessionDetail extends ScrimOnDate {
  registrations: Registration[];
  /** One entry per slot number in the scrim's range; team null = free */
  slots: { slotNumber: number; team: TeamSummary | null; registrationId: string | null }[];
}

export interface ManagerDashboard {
  today: string;
  todaySessions: ScrimOnDate[];
  pendingCount: number;
  activeScrims: number;
  upcomingApproved: number;
}

/** Pending request in the manager's approvals inbox. */
export interface PendingRequest {
  registration: Registration;
  scrim: Pick<Scrim, "id" | "title" | "startTime" | "slotCount">;
  date: string;
  startsAt: string;
  counts: { approved: number; slotsLeft: number };
}

// ---------- team ----------
export interface TeamRegistration {
  id: string;
  status: RegistrationStatus;
  slotNumber: number | null;
  rejectionReason: string | null;
  date: string;
  startsAt: string;
  createdAt: string;
  decidedAt: string | null;
  scrim: Pick<Scrim, "id" | "title" | "maps" | "startTime" | "slotCount" | "firstSlot" | "manager" | "posterUrl">;
}

export interface TeamDashboard {
  team: TeamSummary & { captainName: string | null };
  today: string;
  nextMatch: TeamRegistration | null;
  upcoming: TeamRegistration[];
  counts: { approvedUpcoming: number; pending: number; totalPlayed: number };
  /** phase 2: points summary (null until the team has a published match) */
  results: import("./phase2").TeamResultsSummary | null;
  /** phase 5 (additive): the caller's role in the team, and OPEN suggestions waiting for the leader */
  myTeamRole?: import("./players").TeamRole;
  openSuggestions?: number;
}
