/**
 * Phase 5 — player accounts & teams (plan: docs/phase5/PLAYERS.md).
 *
 * Players sign up with Google, pick an in-game name (IGN), add their BGMI ID before creating/joining a team.
 * A player is in at most ONE team. The team's LEADER registers for scrims/tournaments; members ask the leader
 * (TeamSuggestion). Joining = invite link/code → join request → leader approves.
 *
 * AUTH (public)
 *   GET    /api/auth/config                                   → AuthConfig
 *   POST   /api/auth/google        GoogleLoginInput           → AuthResponse   (creates the PLAYER on first sign-in)
 *   POST   /api/auth/dev-login     DevLoginInput              → AuthResponse   (only when PLAYER_DEV_LOGIN=1, never in production)
 *   (POST /api/auth/login stays for MANAGER username/password)
 *
 * PLAYER (role PLAYER, cookie sx_app)
 *   GET    /api/player/me                                     → PlayerProfile
 *   PATCH  /api/player/me          UpdatePlayerProfileInput   → PlayerProfile   (409 BGMI_ID_TAKEN)
 *   POST   /api/player/team        CreatePlayerTeamInput      → PlayerTeam (201) (400 BGMI_ID_REQUIRED · 409 ALREADY_IN_TEAM · 409 CONFLICT name taken, fields.name)
 *   GET    /api/player/team                                   → PlayerTeam      (404 NO_TEAM)
 *   PATCH  /api/player/team        UpdatePlayerTeamInput      → PlayerTeam      leader
 *   DELETE /api/player/team                                   → 204             leader; 409 CONFLICT while it has upcoming registrations / active tournament entries
 *   POST   /api/player/team/invite-code                       → PlayerTeam      leader: new invite code (old links stop working)
 *   POST   /api/player/team/leave                             → 204             member (leader: 409 — transfer leadership or disband first)
 *   DELETE /api/player/team/members/:userId                   → PlayerTeam      leader
 *   POST   /api/player/team/transfer  TransferLeaderInput     → PlayerTeam      leader
 *   POST   /api/player/team/join-requests/:id/approve         → PlayerTeam      leader (409 TEAM_FULL · 409 ALREADY_IN_TEAM)
 *   POST   /api/player/team/join-requests/:id/reject          → PlayerTeam      leader
 *   GET    /api/player/invites/:code                          → TeamInvitePreview (404 INVITE_INVALID)
 *   POST   /api/player/join-requests  CreateJoinRequestInput  → MyJoinRequest (201) (400 BGMI_ID_REQUIRED · 409 ALREADY_IN_TEAM · 409 JOIN_REQUEST_PENDING · 409 TEAM_FULL · 404 INVITE_INVALID)
 *   GET    /api/player/join-requests                          → ListResponse<MyJoinRequest> (newest first)
 *   DELETE /api/player/join-requests/:id                      → 204             cancel own PENDING request
 *   GET    /api/player/team/suggestions?status=OPEN|DONE|DISMISSED → ListResponse<TeamSuggestionRow> (default OPEN; newest first)
 *   POST   /api/player/team/suggestions  CreateSuggestionInput → TeamSuggestionRow (201) any member; an OPEN one for the same target is returned instead of a duplicate
 *   POST   /api/player/team/suggestions/:id/dismiss           → TeamSuggestionRow leader
 *
 * EXISTING /api/team/* (dashboard, scrims, registrations, results, roster, tournaments, live, rooms): same paths and
 * shapes, now role PLAYER; the team is the caller's membership (403 NO_TEAM when none). Mutations are leader-only
 * (403 LEADER_ONLY). Registering marks matching OPEN suggestions DONE.
 *
 * ADMIN (role ADMIN)
 *   GET    /api/admin/players?q=                              → ListResponse<AdminPlayerRow>
 *   PATCH  /api/admin/players/:id  AdminUpdatePlayerInput     → AdminPlayerRow
 *   GET    /api/admin/teams?q=                                → ListResponse<TeamRow>   (TeamRow gains leader + memberCount)
 *   GET    /api/admin/teams/:id                               → AdminTeamDetail
 *   DELETE /api/admin/teams/:id                               → 204             disband (409 CONFLICT while it has upcoming registrations)
 *   (removed: POST /api/admin/teams, team reset-password, team availability, /api/admin/team-requests*)
 * MANAGER: /api/manager/team-requests* removed (teams are created by players now).
 */
import { z } from "zod";

export const MAX_TEAM_MEMBERS = 6;
export const TEAM_ROLES = ["LEADER", "MEMBER"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];
export const JOIN_REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;
export type JoinRequestStatus = (typeof JOIN_REQUEST_STATUSES)[number];
export const SUGGESTION_KINDS = ["SCRIM", "TOURNAMENT"] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];
export const SUGGESTION_STATUSES = ["OPEN", "DONE", "DISMISSED"] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

/** Invite codes: 8 chars from an alphabet without lookalikes (0/O, 1/I/L). Normalise input with normalizeInviteCode. */
export const INVITE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const INVITE_CODE_LENGTH = 8;
export const normalizeInviteCode = (raw: string) => raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
/** Web path of an invite link (prefix with the web origin). */
export const inviteLinkPath = (code: string) => `/join/${code}`;

// ---------- validation ----------
export const ignSchema = z
  .string()
  .trim()
  .min(2, "At least 2 characters")
  .max(24, "At most 24 characters");
/** BGMI character ID: digits only. */
export const bgmiIdSchema = z
  .string()
  .trim()
  .regex(/^\d{5,15}$/, "BGMI ID is 5–15 digits (find it on your in-game profile)");

export const googleLoginSchema = z.object({ credential: z.string().min(20) });
export type GoogleLoginInput = z.infer<typeof googleLoginSchema>;

export const devLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter an email"),
  name: z.string().trim().max(60).optional(),
});
export type DevLoginInput = z.infer<typeof devLoginSchema>;

export const updatePlayerProfileSchema = z.object({
  ign: ignSchema.optional(),
  /** "" clears it (only allowed while not in a team) */
  bgmiId: z.union([bgmiIdSchema, z.literal("")]).optional(),
  displayName: z.string().trim().min(2).max(60).optional(),
});
export type UpdatePlayerProfileInput = z.infer<typeof updatePlayerProfileSchema>;

const teamName = z.string().trim().min(2, "At least 2 characters").max(40, "At most 40 characters");
const teamTag = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, "2–5 characters")
  .max(5, "2–5 characters")
  .regex(/^[A-Z0-9]+$/, "Letters and numbers only");

export const createPlayerTeamSchema = z.object({ name: teamName, tag: teamTag });
export type CreatePlayerTeamInput = z.infer<typeof createPlayerTeamSchema>;
export const updatePlayerTeamSchema = z.object({ name: teamName.optional(), tag: teamTag.optional() });
export type UpdatePlayerTeamInput = z.infer<typeof updatePlayerTeamSchema>;

export const transferLeaderSchema = z.object({ userId: z.string().min(1) });
export type TransferLeaderInput = z.infer<typeof transferLeaderSchema>;

export const createJoinRequestSchema = z.object({
  code: z.string().transform(normalizeInviteCode).pipe(z.string().length(INVITE_CODE_LENGTH, "Invite codes are 8 characters")),
  message: z.string().trim().max(200).optional(),
});
export type CreateJoinRequestInput = z.infer<typeof createJoinRequestSchema>;

export const createSuggestionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("SCRIM"), scrimId: z.string().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().trim().max(200).optional() }),
  z.object({ kind: z.literal("TOURNAMENT"), tournamentId: z.string().min(1), note: z.string().trim().max(200).optional() }),
]);
export type CreateSuggestionInput = z.infer<typeof createSuggestionSchema>;
export const suggestionQuerySchema = z.object({ status: z.enum(SUGGESTION_STATUSES).default("OPEN") });

export const adminPlayersQuerySchema = z.object({ q: z.string().trim().max(60).optional() });
export const adminUpdatePlayerSchema = z.object({ isActive: z.boolean() });
export type AdminUpdatePlayerInput = z.infer<typeof adminUpdatePlayerSchema>;

// ---------- DTOs ----------
export interface AuthConfig {
  /** null until the owner sets GOOGLE_CLIENT_ID */
  googleClientId: string | null;
  /** dev-only email login (PLAYER_DEV_LOGIN=1) */
  devLogin: boolean;
}

/** Small player identity used in lists. */
export interface PlayerSummary {
  id: string;
  ign: string | null;
  displayName: string;
  avatarUrl: string | null;
}

export interface PlayerTeamSummary {
  id: string;
  name: string;
  tag: string;
  role: TeamRole;
}

/** On SessionUser for role PLAYER. */
export interface SessionPlayer {
  ign: string | null;
  bgmiId: string | null;
  avatarUrl: string | null;
  email: string | null;
  team: PlayerTeamSummary | null;
  /** IGN not chosen yet → web sends them to /welcome */
  needsOnboarding: boolean;
}

export interface PlayerProfile extends PlayerSummary {
  email: string | null;
  bgmiId: string | null;
  team: PlayerTeamSummary | null;
  /** the caller's PENDING join request, if any */
  pendingJoinRequest: MyJoinRequest | null;
  createdAt: string;
}

export interface TeamMemberRow extends PlayerSummary {
  bgmiId: string | null;
  role: TeamRole;
  joinedAt: string;
}

/** A join request as the team leader sees it. */
export interface TeamJoinRequestRow {
  id: string;
  player: PlayerSummary & { bgmiId: string | null };
  message: string | null;
  createdAt: string;
}

export interface PlayerTeam {
  id: string;
  name: string;
  tag: string;
  leaderId: string;
  myRole: TeamRole;
  members: TeamMemberRow[];
  maxMembers: number;
  /** leader only (null for members) */
  inviteCode: string | null;
  /** leader only (empty for members) */
  joinRequests: TeamJoinRequestRow[];
  openSuggestions: number;
  createdAt: string;
}

export interface TeamInvitePreview {
  code: string;
  team: { id: string; name: string; tag: string };
  leader: PlayerSummary;
  memberCount: number;
  maxMembers: number;
  full: boolean;
}

export interface MyJoinRequest {
  id: string;
  status: JoinRequestStatus;
  team: { id: string; name: string; tag: string };
  message: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface TeamSuggestionRow {
  id: string;
  kind: SuggestionKind;
  status: SuggestionStatus;
  from: PlayerSummary;
  note: string | null;
  /** SCRIM */
  scrim: { id: string; title: string; date: string; startTime: string; posterUrl: string | null; organiser: string } | null;
  /** TOURNAMENT */
  tournament: { id: string; name: string; posterUrl: string | null; organiser: string } | null;
  createdAt: string;
}

export interface AdminPlayerRow extends PlayerSummary {
  email: string | null;
  bgmiId: string | null;
  isActive: boolean;
  team: PlayerTeamSummary | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AdminTeamDetail {
  id: string;
  name: string;
  tag: string;
  leader: PlayerSummary | null;
  members: TeamMemberRow[];
  upcomingRegistrations: number;
  createdAt: string;
}
