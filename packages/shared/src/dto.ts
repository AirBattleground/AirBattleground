/**
 * API response shapes. Every successful response is the DTO itself (no envelope).
 * Every error response is `ApiErrorBody` with an HTTP 4xx/5xx status.
 * Dates are "YYYY-MM-DD"; timestamps are ISO-8601 strings.
 */
import type { GameMap, Recurrence, RegistrationStatus, Role, ScrimStatus } from "./enums";

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "SLOTS_FULL"
  | "REGISTRATION_CLOSED"
  | "RATE_LIMITED"
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
  username: string;
  role: Role;
  displayName: string;
  /** Present when role === "TEAM" */
  team: TeamSummary | null;
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
}

export interface ManagerRow {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  scrimCount: number;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface TeamRow {
  id: string;
  /** the team's login user id */
  userId: string;
  name: string;
  tag: string;
  captainName: string | null;
  username: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  registrationCount: number;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface ListResponse<T> {
  items: T[];
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
  manager: { id: string; displayName: string };
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
  myRegistration: { id: string; status: RegistrationStatus; slotNumber: number | null } | null;
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
  scrim: Pick<Scrim, "id" | "title" | "maps" | "startTime" | "slotCount" | "firstSlot" | "manager">;
}

export interface TeamDashboard {
  team: TeamSummary & { captainName: string | null };
  today: string;
  nextMatch: TeamRegistration | null;
  upcoming: TeamRegistration[];
  counts: { approvedUpcoming: number; pending: number; totalPlayed: number };
}
