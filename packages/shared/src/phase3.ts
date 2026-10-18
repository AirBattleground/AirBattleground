/**
 * PHASE 3 CONTRACT — tournaments. Plan: docs/phase3/TOURNAMENTS.md. Pure algorithms: ./tournament/engine.ts.
 *
 * MANAGER (own tournaments). ADMIN can do the same on ANY tournament via /api/admin/tournaments/... (same paths
 * after the prefix, same bodies/responses, ownership not checked).
 *   GET    /api/manager/tournaments                                   → ListResponse<TournamentSummary>
 *   POST   /api/manager/tournaments            CreateTournamentInput  → ManagerTournamentDetail (201, DRAFT)
 *   GET    /api/manager/tournaments/:id                               → ManagerTournamentDetail
 *   PATCH  /api/manager/tournaments/:id        UpdateTournamentInput  → ManagerTournamentDetail (format/stages editable only in DRAFT;
 *                                                                        basics anytime; stage-1 schedule only before the draw — 409 otherwise)
 *   POST   /api/manager/tournaments/:id/publish                       → ManagerTournamentDetail (DRAFT → REGISTRATION_OPEN; 400 if validateFormat has errors
 *                                                                        or stage 1 has no schedule)
 *   POST   /api/manager/tournaments/:id/close-registration            → ManagerTournamentDetail
 *   POST   /api/manager/tournaments/:id/reopen-registration           → ManagerTournamentDetail (only before the first draw)
 *   POST   /api/manager/tournaments/:id/cancel                        → ManagerTournamentDetail
 *   POST   /api/manager/tournaments/:id/complete                      → ManagerTournamentDetail (final stage must be COMPLETED; sets champion)
 *   GET    /api/manager/tournaments/:id/entries                       → ListResponse<TournamentEntryRow> (confirmed first by registeredAt, then waitlist)
 *   DELETE /api/manager/tournaments/:id/entries/:entryId              → 204 (remove; next waitlisted team auto-confirmed if before the draw)
 *   POST   /api/manager/tournaments/:id/invites    InviteTeamInput    → TournamentEntryRow (invited team enters at stageOrder; counts toward invitedSlots)
 *   PUT    /api/manager/tournaments/:id/stages/:stageId/schedule  ScheduleConfig → StageDetail (stores config; recomputes plan; stage must be PENDING/DRAWN)
 *   POST   /api/manager/tournaments/:id/stages/:stageId/draw  DrawInput   → StageDetail (PENDING → DRAWN; creates groups, GroupTeams, Matches with scheduledAt)
 *   POST   /api/manager/tournaments/:id/stages/:stageId/redraw DrawInput  → StageDetail (only while DRAWN and no match has screenshots/results)
 *   PATCH  /api/manager/tournaments/:id/stages/:stageId/groups  GroupMovesInput → StageDetail (move/swap teams; DRAWN or LIVE before results)
 *   PATCH  /api/manager/tournaments/:id/matches/:matchId/schedule  RescheduleMatchInput → StageDetail
 *   POST   /api/manager/tournaments/:id/stages/:stageId/start                       → StageDetail (DRAWN → LIVE; tournament → LIVE; registration closed)
 *   GET    /api/manager/tournaments/:id/stages/:stageId                             → StageDetail
 *   GET    /api/manager/tournaments/:id/stages/:stageId/promotion                   → PromotionPreview
 *   POST   /api/manager/tournaments/:id/stages/:stageId/promote  PromoteInput       → ManagerTournamentDetail (LIVE → COMPLETED; next stage entrants seeded)
 *   POST   /api/manager/tournaments/:id/stages/:stageId/teams/:teamId/disqualify  DisqualifyInput → StageDetail
 *   Group matches are played with the existing match center: GET/PUT/POST /api/manager/matches/:matchId/... work for them
 *   (MatchDetail gains `tournament` context; `scrim` holds the tournament-as-scrim view: title, slotCount = lobbySize, firstSlot, pointsSystem).
 *
 * TEAM (any signed-in team; DRAFT tournaments are invisible)
 *   GET    /api/team/tournaments?scope=open|live|mine|completed       → ListResponse<TournamentSummary> (default: open + live)
 *   GET    /api/team/tournaments/:id                                  → TeamTournamentDetail
 *   POST   /api/team/tournaments/:id/entry       RegisterTournamentInput → MyTournamentStatus (201; CONFIRMED or WAITLISTED;
 *                                                                        409 REGISTRATION_CLOSED / CONFLICT already registered)
 *   PUT    /api/team/tournaments/:id/entry       RegisterTournamentInput → MyTournamentStatus (change time preferences before the draw)
 *   DELETE /api/team/tournaments/:id/entry                            → 204 (withdraw before the draw)
 *   GET    /api/team/tournaments/:id/stages/:stageId                  → StageDetail (public)
 *   GET    /api/team/matches/:matchId                                 → MatchScorecard (published tournament matches are viewable by every team)
 *
 * ADMIN
 *   GET    /api/admin/tournaments                                     → ListResponse<TournamentSummary> (all, any status)
 *   + every manager endpoint above under /api/admin/tournaments/...
 */
import { z } from "zod";
import { MAPS, MAX_ROOM_SLOTS, type GameMap } from "./enums";
import type { PointsSystem } from "./points";
import type { OrganizerRef, TeamSummary } from "./dto";
import { DATE_RE, TIME_RE } from "./schedule";

// ---------- enums ----------
export const TOURNAMENT_STATUSES = ["DRAFT", "REGISTRATION_OPEN", "REGISTRATION_CLOSED", "LIVE", "COMPLETED", "CANCELLED"] as const;
export type TournamentStatus = (typeof TOURNAMENT_STATUSES)[number];
export const TOURNAMENT_STATUS_LABELS: Record<TournamentStatus, string> = {
  DRAFT: "Draft",
  REGISTRATION_OPEN: "Registration open",
  REGISTRATION_CLOSED: "Registration closed",
  LIVE: "Live",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const STAGE_STATUSES = ["PENDING", "DRAWN", "LIVE", "COMPLETED"] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

export const ENTRY_TYPES = ["REGISTERED", "INVITED"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];
export const ENTRY_STATUSES = ["CONFIRMED", "WAITLISTED", "WITHDRAWN", "REMOVED"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const GROUP_TEAM_STATUSES = ["ACTIVE", "ADVANCED", "ELIMINATED", "DISQUALIFIED"] as const;
export type GroupTeamStatus = (typeof GROUP_TEAM_STATUSES)[number];
export type AdvancedVia = "TOP" | "WILDCARD";

export const DEFAULT_LOBBY_SIZE = 16;
export const MAX_STAGES = 6;
export const MAX_TOURNAMENT_TEAMS = 1024;

// ---------- format + schedule specs (also the engine's inputs) ----------
export interface ScheduleWindow {
  /** "HH:mm" IST */
  start: string;
  end: string;
}
export interface ScheduleConfig {
  startDate: string;
  endDate: string;
  windows: ScheduleWindow[];
  excludeDates: string[];
  matchMinutes: number;
  breakMinutes: number;
  parallelLobbies: number;
}
export const DEFAULT_SCHEDULE: Omit<ScheduleConfig, "startDate" | "endDate"> = {
  windows: [{ start: "18:00", end: "23:00" }],
  excludeDates: [],
  matchMinutes: 40,
  breakMinutes: 5,
  parallelLobbies: 1,
};

export interface StageSpec {
  name: string;
  teamsIn: number;
  lobbySize: number;
  groupCount: number;
  matchesPerGroup: number;
  /** one per match, in play order (length = matchesPerGroup) */
  maps: GameMap[];
  /** top N of each group advance (0 for the final stage) */
  advancePerGroup: number;
  /** best non-qualifiers across all groups (by points per match) who also advance */
  wildcardCount: number;
  /** teams invited directly into THIS stage (0 for stage 1) */
  invitedSlots: number;
  schedule: ScheduleConfig | null;
}

export interface FormatIssue {
  /** index into stages (0-based), or null for tournament-level issues */
  stage: number | null;
  level: "error" | "warning";
  message: string;
}

export interface ScheduledMatch {
  number: number;
  map: GameMap;
  /** ISO instant */
  start: string;
}
export interface ScheduleBlock {
  groupIndex: number;
  lobbyIndex: number;
  date: string;
  start: string;
  end: string;
  matches: ScheduledMatch[];
}
export interface TimeSlotOption {
  /** = ISO start instant of the block(s) */
  id: string;
  date: string;
  start: string;
  /** e.g. "Sat, 18 Oct · 6:00 PM" */
  label: string;
  groupIndexes: number[];
  capacity: number;
}
export interface SchedulePlan {
  blocks: ScheduleBlock[];
  /** distinct dates used */
  days: number;
  slotOptions: TimeSlotOption[];
  unscheduledGroups: number[];
  /** plain-English tips, e.g. "Extend the window to 23:30 to finish in 2 days instead of 4." */
  suggestions: string[];
}

// ---------- DTOs ----------
export interface StageSummary extends Omit<StageSpec, "schedule"> {
  id: string;
  order: number;
  status: StageStatus;
  /** teams leaving this stage = groupCount × advancePerGroup + wildcardCount (0 for the final) */
  teamsOut: number;
  schedule: ScheduleConfig | null;
  plan: SchedulePlan | null;
  startsAt: string | null;
  endsAt: string | null;
  drawSeed: string | null;
}

export interface TournamentSummary {
  id: string;
  title: string;
  prize: string | null;
  status: TournamentStatus;
  maxTeams: number;
  confirmedCount: number;
  waitlistCount: number;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  startsAt: string | null;
  stagesCount: number;
  currentStage: { order: number; name: string; status: StageStatus } | null;
  manager: OrganizerRef;
  /** poster image URL; null = none uploaded */
  posterUrl: string | null;
  champion: TeamSummary | null;
  createdAt: string;
}

export interface TournamentDetail extends TournamentSummary {
  description: string | null;
  rules: string | null;
  teamSize: number;
  firstSlot: number;
  pointsSystem: PointsSystem;
  stages: StageSummary[];
  /** stage-1 time slots teams can pick when registering (with how many are already taken) */
  slotOptions: (TimeSlotOption & { taken: number })[];
}

export type ManagerActionKey =
  | "FIX_FORMAT"
  | "SET_SCHEDULE"
  | "PUBLISH"
  | "CLOSE_REGISTRATION"
  | "DRAW"
  | "START_STAGE"
  | "PLAY_MATCHES"
  | "PROMOTE"
  | "COMPLETE"
  | "DONE";
export interface ManagerTournamentDetail extends TournamentDetail {
  issues: FormatIssue[];
  canEditFormat: boolean;
  /** the single next step for the control center's big button */
  nextAction: { key: ManagerActionKey; label: string; stageId: string | null } | null;
}

export interface TournamentEntryRow {
  id: string;
  team: TeamSummary;
  type: EntryType;
  status: EntryStatus;
  /** stage order the team enters at (1, or later for invites) */
  entryStage: number;
  timePreferences: string[];
  registeredAt: string;
  /** 1-based place in the waitlist when WAITLISTED */
  waitlistPosition: number | null;
}

export interface GroupStandingRow {
  rank: number;
  team: TeamSummary;
  slotNumber: number;
  seed: number | null;
  matchesPlayed: number;
  wins: number;
  kills: number;
  placementPoints: number;
  killPoints: number;
  totalPoints: number;
  status: GroupTeamStatus;
  advancedVia: AdvancedVia | null;
}
export interface GroupMatchRow {
  id: string;
  number: number;
  map: GameMap;
  scheduledAt: string | null;
  /** MatchStatus from phase 2 */
  status: string;
  publishedAt: string | null;
}
export interface GroupDetail {
  id: string;
  index: number;
  /** "A", "B", … */
  name: string;
  lobbyIndex: number | null;
  startsAt: string | null;
  teams: GroupStandingRow[];
  matches: GroupMatchRow[];
}
export interface StageDetail {
  tournament: { id: string; title: string; status: TournamentStatus };
  stage: StageSummary;
  groups: GroupDetail[];
  /** across the whole stage, by points per match */
  topTeams: { team: TeamSummary; groupName: string; totalPoints: number; matchesPlayed: number; pointsPerMatch: number; kills: number }[];
  topFraggers: { name: string; team: TeamSummary; kills: number; matchesPlayed: number }[];
  /** time-preference outcome after the stage-1 draw */
  unmetPreferences: { team: TeamSummary; wanted: string[]; got: string | null }[];
}

export interface PromotionCandidate {
  team: TeamSummary;
  groupName: string;
  groupRank: number;
  totalPoints: number;
  pointsPerMatch: number;
  via: AdvancedVia | null;
}
export interface PromotionPreview {
  stageId: string;
  ready: boolean;
  /** why promotion can't happen yet, e.g. "Group C match 3 isn't published" */
  blockers: string[];
  qualified: PromotionCandidate[];
  eliminated: PromotionCandidate[];
  /** plain-English warnings about ties exactly at the cut-off */
  tiesAtCutoff: string[];
  nextStage: { order: number; name: string; teamsIn: number; invited: TeamSummary[] } | null;
}

export type MyTournamentState =
  | "NOT_REGISTERED"
  | "CONFIRMED"
  | "WAITLISTED"
  | "INVITED"
  | "PLAYING"
  | "QUALIFIED"
  | "ELIMINATED"
  | "DISQUALIFIED"
  | "CHAMPION"
  | "WITHDRAWN";
export interface MyTournamentStatus {
  state: MyTournamentState;
  entry: TournamentEntryRow | null;
  /** stage the team is currently in / last played */
  stageOrder: number | null;
  groupName: string | null;
  slotNumber: number | null;
  groupRank: number | null;
  /** e.g. "Finish in the top 4 of Group C to reach the Semi-final" */
  nextGoal: string | null;
  nextMatch: { matchId: string; number: number; map: GameMap; scheduledAt: string | null; groupName: string } | null;
  canRegister: boolean;
  registerBlockedReason: string | null;
  /** time slot the team was placed in (stage 1), if drawn */
  assignedSlot: string | null;
  /** soft warning (never blocks), e.g. roster smaller than the tournament's team size */
  rosterWarning?: string | null;
}
export interface TeamTournamentDetail extends TournamentDetail {
  me: MyTournamentStatus;
}

// ---------- inputs ----------
const hhmm = z.string().regex(TIME_RE, "Use HH:mm (24h)");
const ymd = z.string().regex(DATE_RE, "Use YYYY-MM-DD");

export const scheduleConfigSchema = z
  .object({
    startDate: ymd,
    endDate: ymd,
    windows: z.array(z.object({ start: hhmm, end: hhmm })).min(1, "Add at least one time window").max(4),
    excludeDates: z.array(ymd).max(60).default([]),
    matchMinutes: z.number().int().min(15).max(120).default(40),
    breakMinutes: z.number().int().min(0).max(60).default(5),
    parallelLobbies: z.number().int().min(1).max(4).default(1),
  })
  .superRefine((v, ctx) => {
    if (v.endDate < v.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date is before start date" });
    v.windows.forEach((w, i) => {
      if (w.end <= w.start) ctx.addIssue({ code: "custom", path: ["windows", i, "end"], message: "Window must end after it starts" });
    });
  });

export const stageSpecSchema = z.object({
  name: z.string().trim().min(2).max(40),
  teamsIn: z.number().int().min(2).max(MAX_TOURNAMENT_TEAMS),
  lobbySize: z.number().int().min(2).max(MAX_ROOM_SLOTS).default(DEFAULT_LOBBY_SIZE),
  groupCount: z.number().int().min(1).max(128),
  matchesPerGroup: z.number().int().min(1).max(12),
  maps: z.array(z.enum(MAPS)).min(1).max(12),
  advancePerGroup: z.number().int().min(0).max(MAX_ROOM_SLOTS),
  wildcardCount: z.number().int().min(0).max(128).default(0),
  invitedSlots: z.number().int().min(0).max(128).default(0),
  schedule: scheduleConfigSchema.nullable().default(null),
});

const pointsSystem = z.object({ placement: z.array(z.number().int().min(0).max(100)).min(1).max(25), killPoints: z.number().int().min(0).max(10) });
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal("").transform(() => undefined));

export const createTournamentSchema = z.object({
  title: z.string().trim().min(3, "At least 3 characters").max(80),
  description: optionalText(2000),
  rules: optionalText(5000),
  prize: optionalText(120),
  teamSize: z.number().int().min(1).max(6).default(4),
  firstSlot: z.number().int().min(1).max(MAX_ROOM_SLOTS).default(1),
  maxTeams: z.number().int().min(2).max(MAX_TOURNAMENT_TEAMS),
  registrationOpensAt: z.string().datetime({ offset: true }).optional(),
  registrationClosesAt: z.string().datetime({ offset: true }).optional(),
  pointsSystem: pointsSystem.optional(),
  stages: z.array(stageSpecSchema).min(1).max(MAX_STAGES),
});
export type CreateTournamentInput = z.infer<typeof createTournamentSchema>;
export const updateTournamentSchema = createTournamentSchema.partial();
export type UpdateTournamentInput = z.infer<typeof updateTournamentSchema>;

export const registerTournamentSchema = z.object({
  /** TimeSlotOption ids in preference order; empty = any time */
  timePreferences: z.array(z.string().min(1).max(40)).max(12).default([]),
});
export type RegisterTournamentInput = z.infer<typeof registerTournamentSchema>;

export const inviteTeamSchema = z.object({ teamId: z.string().min(1), stageOrder: z.number().int().min(2).max(MAX_STAGES) });
export type InviteTeamInput = z.infer<typeof inviteTeamSchema>;

export const drawSchema = z.object({ seed: z.string().trim().max(40).optional() });
export type DrawInput = z.infer<typeof drawSchema>;

export const groupMovesSchema = z.object({
  moves: z
    .array(z.object({ teamId: z.string().min(1), toGroupId: z.string().min(1), slotNumber: z.number().int().min(1).max(MAX_ROOM_SLOTS).optional() }))
    .min(1)
    .max(64),
});
export type GroupMovesInput = z.infer<typeof groupMovesSchema>;

export const rescheduleMatchSchema = z.object({ scheduledAt: z.string().datetime({ offset: true }) });
export type RescheduleMatchInput = z.infer<typeof rescheduleMatchSchema>;

export const promoteSchema = z.object({
  /** force-qualify these team ids (e.g. resolving a tie) */
  include: z.array(z.string()).max(64).default([]),
  /** force-eliminate these team ids */
  exclude: z.array(z.string()).max(64).default([]),
});
export type PromoteInput = z.infer<typeof promoteSchema>;

export const disqualifySchema = z.object({ reason: z.string().trim().min(3).max(300) });
export type DisqualifyInput = z.infer<typeof disqualifySchema>;

export const tournamentScopeSchema = z.object({ scope: z.enum(["open", "live", "mine", "completed", "all"]).optional() });
