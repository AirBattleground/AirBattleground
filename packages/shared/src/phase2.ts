/**
 * PHASE 2 CONTRACT — matches, screenshot reading, review, points table, rosters, training.
 *
 * Flow per match (one Match per map of a scrim session, created automatically):
 *   SCHEDULED ──upload SLOT_LIST screenshots──▶ LINEUP_REVIEW ──manager confirms lineup──▶ LIVE
 *   LIVE ──upload RESULTS screenshots──▶ RESULTS_REVIEW ──manager publishes──▶ PUBLISHED
 *   PUBLISHED ──unpublish──▶ RESULTS_REVIEW   (edit + publish again; points recomputed)
 * Screenshots are read asynchronously by the extractor service (services/extractor). The manager can
 * always type/fix values by hand — OCR only pre-fills. Confirmed data becomes training data.
 *
 * ENDPOINTS (add to the catalogue in api.ts; same auth/cookies/error shape as phase 1)
 *
 * MANAGER (own scrims only)
 *   GET    /api/manager/scrims/:id/sessions/:date/matches              → ListResponse<MatchSummary>   (creates matches from scrim.maps on first call)
 *   GET    /api/manager/matches/:matchId                               → MatchDetail
 *   POST   /api/manager/matches/:matchId/screenshots  multipart: files[] (png/jpeg/webp ≤10MB each, ≤10 files), kind=SLOT_LIST|RESULTS
 *                                                                      → ListResponse<ScreenshotRow> (201; status QUEUED; duplicates by sha256 are skipped)
 *   GET    /api/manager/screenshots/:id/image                          → image bytes
 *   POST   /api/manager/screenshots/:id/retry                          → ScreenshotRow (FAILED → QUEUED)
 *   DELETE /api/manager/screenshots/:id                                → 204 (only while match not PUBLISHED)
 *   PUT    /api/manager/matches/:matchId/lineup      SaveLineupInput   → MatchDetail  (confirm=true moves to LIVE; saves roster names; creates training samples)
 *   PUT    /api/manager/matches/:matchId/results     SaveResultsInput  → MatchDetail  (draft; status RESULTS_REVIEW)
 *   POST   /api/manager/matches/:matchId/publish                       → MatchDetail  (400 VALIDATION_ERROR if placements missing/duplicated)
 *   POST   /api/manager/matches/:matchId/unpublish                     → MatchDetail
 *   GET    /api/manager/scrims/:id/sessions/:date/standings            → SessionStandings
 *   PATCH  /api/manager/scrims/:id  { pointsSystem }                   (UpdateScrimInput gains optional pointsSystem)
 *
 * TEAM
 *   GET    /api/team/results                                           → ListResponse<TeamSessionResult>  (sessions with ≥1 published match the team played, newest first)
 *   GET    /api/team/sessions/:scrimId/:date/standings                 → SessionStandings (403 unless the team was APPROVED in that session)
 *   GET    /api/team/matches/:matchId                                  → MatchScorecard   (published only; every team's scorecard)
 *   GET    /api/team/roster                                            → TeamRoster
 *   PUT    /api/team/roster                          SaveRosterInput   → TeamRoster
 *   (TeamDashboard gains `results: TeamResultsSummary | null`)
 *
 * ADMIN — training center (models + runs are proxied to the extractor service)
 *   GET    /api/admin/training/samples?kind=&split=&q=                 → ListResponse<TrainingSampleRow>
 *   POST   /api/admin/training/samples   multipart: file, kind, labels (JSON string, SlotListLabels|ResultsLabels), split?
 *                                                                      → TrainingSampleRow (201)
 *   GET    /api/admin/training/samples/:id                             → TrainingSampleDetail
 *   PATCH  /api/admin/training/samples/:id         UpdateSampleInput   → TrainingSampleDetail (labels/split/excluded/verified)
 *   DELETE /api/admin/training/samples/:id                             → 204
 *   GET    /api/admin/training/samples/:id/image                       → image bytes
 *   POST   /api/admin/training/preview   multipart: file, kind         → ExtractionResult (run the current model on an image to pre-fill labels)
 *   POST   /api/admin/training/samples/:id/prefill                     → TrainingSampleDetail (labels := current model output, verified=false)
 *   GET    /api/admin/training/models                                  → ModelList
 *   POST   /api/admin/training/models/:version/activate                → ModelList
 *   GET    /api/admin/training/runs                                    → ListResponse<TrainingRun>
 *   POST   /api/admin/training/runs                  StartTrainingInput → TrainingRun (202; uses all non-excluded, verified samples)
 *   GET    /api/admin/training/runs/:id                                → TrainingRun
 *   GET    /api/admin/extractor/status                                 → ExtractorStatus (never throws; online=false when unreachable)
 */
import { z } from "zod";
import type { GameMap } from "./enums";
import type { PointsSystem, StandingRow } from "./points";
import type { TeamSummary } from "./dto";

// ---------- enums ----------
export const MATCH_STATUSES = ["SCHEDULED", "LINEUP_REVIEW", "LIVE", "RESULTS_REVIEW", "PUBLISHED"] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];
export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  SCHEDULED: "Not started",
  LINEUP_REVIEW: "Check lineup",
  LIVE: "In progress",
  RESULTS_REVIEW: "Check results",
  PUBLISHED: "Results published",
};

export const SCREENSHOT_KINDS = ["SLOT_LIST", "RESULTS"] as const;
export type ScreenshotKind = (typeof SCREENSHOT_KINDS)[number];
export const SCREENSHOT_KIND_LABELS: Record<ScreenshotKind, string> = {
  SLOT_LIST: "Team list (slots)",
  RESULTS: "Final results",
};

export const SCREENSHOT_STATUSES = ["QUEUED", "PROCESSING", "DONE", "FAILED"] as const;
export type ScreenshotStatus = (typeof SCREENSHOT_STATUSES)[number];

export const SAMPLE_SPLITS = ["TRAIN", "TEST"] as const;
export type SampleSplit = (typeof SAMPLE_SPLITS)[number];
export const SAMPLE_SOURCES = ["ADMIN_UPLOAD", "MANAGER_CORRECTION", "SEED"] as const;
export type SampleSource = (typeof SAMPLE_SOURCES)[number];

export const TRAINING_RUN_STATUSES = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED"] as const;
export type TrainingRunStatus = (typeof TRAINING_RUN_STATUSES)[number];

export const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
export const MAX_SCREENSHOTS_PER_UPLOAD = 10;
export const MAX_ROSTER_PLAYERS = 6;

// ---------- extractor output (what services/extractor returns; JSON field names are snake_case there,
// the API converts to these camelCase shapes) ----------
export interface ExtractedPlayer {
  name: string;
  confidence: number;
  /** "paddle" | "vlm" | "lexicon" … */
  source: string;
  /** closest roster name when a roster was supplied and the score passed the threshold */
  rosterMatch: string | null;
  /** slot whose roster this name matched best (null if no roster / no match) */
  matchedSlot: number | null;
  /** RESULTS only */
  kills: number | null;
  killsConfidence: number | null;
}
export interface ExtractedTeam {
  slot: number | null;
  slotConfidence: number;
  players: ExtractedPlayer[];
}
export interface ExtractedResultRow {
  rank: number | null;
  rankConfidence: number;
  players: ExtractedPlayer[];
  /** slot inferred from players' roster matches (majority), null if unknown */
  inferredSlot: number | null;
}
export interface ExtractionResult {
  imageId: string;
  kind: ScreenshotKind;
  modelVersion: string;
  /** SLOT_LIST */
  teams: ExtractedTeam[];
  /** RESULTS */
  rows: ExtractedResultRow[];
  needsReview: boolean;
  warnings: string[];
  timingsMs: Record<string, number>;
}

// ---------- labels (ground truth for training samples; same shape as eval/dataset labels.json) ----------
export interface SlotListLabels {
  teams: { slot: number; players: string[] }[];
}
export interface ResultsLabels {
  rows: { rank: number; players: { name: string; kills: number }[] }[];
}
export const slotListLabelsSchema = z.object({
  teams: z
    .array(z.object({ slot: z.number().int().min(1).max(100), players: z.array(z.string().min(1).max(40)).min(1).max(MAX_ROSTER_PLAYERS) }))
    .max(25),
});
export const resultsLabelsSchema = z.object({
  rows: z
    .array(
      z.object({
        rank: z.number().int().min(1).max(100),
        players: z.array(z.object({ name: z.string().min(1).max(40), kills: z.number().int().min(0).max(99) })).min(1).max(MAX_ROSTER_PLAYERS),
      }),
    )
    .max(25),
});

// ---------- matches ----------
export interface MatchSummary {
  id: string;
  number: number;
  map: GameMap;
  status: MatchStatus;
  screenshotCounts: { slotList: number; results: number; processing: number; failed: number };
  teamsInLineup: number;
  publishedAt: string | null;
}

export interface ScreenshotRow {
  id: string;
  kind: ScreenshotKind;
  status: ScreenshotStatus;
  error: string | null;
  modelVersion: string | null;
  width: number | null;
  height: number | null;
  createdAt: string;
  processedAt: string | null;
  /** present when status DONE */
  extraction: ExtractionResult | null;
  /** phase 4: where the screenshot came from ("WEB" | "APP_AUTO" | "APP_MANUAL") */
  source: "WEB" | "APP_AUTO" | "APP_MANUAL";
}

export interface MatchPlayerRow {
  position: number;
  name: string;
  /** what OCR read (null when typed by hand) */
  ocrName: string | null;
  ocrConfidence: number | null;
  kills: number | null;
}

export interface MatchTeamRow {
  slotNumber: number;
  /** team approved for this slot in the session (null = nobody registered on this slot) */
  team: TeamSummary | null;
  players: MatchPlayerRow[];
  placement: number | null;
  kills: number | null;
  placementPoints: number | null;
  killPoints: number | null;
  totalPoints: number | null;
  /** plain-English problems for the reviewer, e.g. "Slot 10 has no registered team", "Kills total differs from players' sum" */
  flags: string[];
}

export interface MatchDetail {
  match: MatchSummary;
  scrim: { id: string; title: string; slotCount: number; firstSlot: number; pointsSystem: PointsSystem };
  date: string;
  screenshots: ScreenshotRow[];
  teams: MatchTeamRow[];
  /** approved registrations of the session (slot → team), for the reviewer's slot picker */
  sessionSlots: { slotNumber: number; team: TeamSummary }[];
  warnings: string[];
  /** phase 3: set when the match is a tournament group match (then `scrim` is the tournament-as-scrim view) */
  tournament?: { id: string; title: string; stageId: string; stageName: string; groupId: string; groupName: string } | null;
}

export const saveLineupSchema = z.object({
  confirm: z.boolean().default(false),
  teams: z
    .array(
      z.object({
        slotNumber: z.number().int().min(1).max(100),
        players: z
          .array(z.object({ position: z.number().int().min(1).max(MAX_ROSTER_PLAYERS), name: z.string().trim().min(1).max(40) }))
          .max(MAX_ROSTER_PLAYERS),
      }),
    )
    .max(25),
});
export type SaveLineupInput = z.infer<typeof saveLineupSchema>;

export const saveResultsSchema = z.object({
  teams: z
    .array(
      z.object({
        slotNumber: z.number().int().min(1).max(100),
        placement: z.number().int().min(1).max(25).nullable(),
        kills: z.number().int().min(0).max(99).nullable(),
        players: z
          .array(z.object({ position: z.number().int().min(1).max(MAX_ROSTER_PLAYERS), kills: z.number().int().min(0).max(99).nullable() }))
          .max(MAX_ROSTER_PLAYERS)
          .optional(),
      }),
    )
    .max(25),
});
export type SaveResultsInput = z.infer<typeof saveResultsSchema>;

export const pointsSystemSchema = z.object({
  placement: z.array(z.number().int().min(0).max(100)).min(1).max(25),
  killPoints: z.number().int().min(0).max(10),
});

// ---------- standings / scorecards ----------
export interface StandingsRow extends StandingRow {
  team: TeamSummary;
  slotNumber: number | null;
  /** per match: matchNumber → { placement, kills, totalPoints } (null = didn't play / not published) */
  perMatch: Record<number, { placement: number; kills: number; totalPoints: number } | null>;
}
export interface SessionStandings {
  scrim: { id: string; title: string; maps: GameMap[]; startTime: string };
  date: string;
  pointsSystem: PointsSystem;
  matches: { id: string; number: number; map: GameMap; status: MatchStatus; publishedAt: string | null }[];
  rows: StandingsRow[];
  updatedAt: string | null;
}

export interface MatchScorecard {
  match: { id: string; number: number; map: GameMap; publishedAt: string };
  scrim: { id: string; title: string };
  date: string;
  /** phase 3: set for tournament group matches */
  tournament?: { id: string; title: string; stageId: string; stageName: string; groupId: string; groupName: string } | null;
  teams: {
    rank: number;
    slotNumber: number;
    team: TeamSummary;
    players: { name: string; kills: number | null }[];
    kills: number;
    placementPoints: number;
    killPoints: number;
    totalPoints: number;
  }[];
}

export interface TeamSessionResult {
  scrim: { id: string; title: string };
  date: string;
  slotNumber: number | null;
  rank: number;
  teamsCount: number;
  totalPoints: number;
  kills: number;
  wins: number;
  matchesPublished: number;
  matchesTotal: number;
}

export interface TeamResultsSummary {
  sessionsPlayed: number;
  matchesPlayed: number;
  totalKills: number;
  wins: number;
  bestRank: number | null;
  latest: TeamSessionResult | null;
}

// ---------- roster ----------
export interface TeamRoster {
  players: { id: string; ign: string; bgmiId: string | null }[];
  /** names seen in confirmed lineups that aren't on the roster yet */
  suggestions: string[];
}
export const saveRosterSchema = z.object({
  players: z
    .array(
      z.object({
        ign: z.string().trim().min(1, "Enter the in-game name").max(40),
        bgmiId: z.string().trim().regex(/^\d{5,15}$/, "BGMI ID is 5–15 digits").optional().or(z.literal("").transform(() => undefined)),
      }),
    )
    .max(MAX_ROSTER_PLAYERS, `Up to ${MAX_ROSTER_PLAYERS} players`),
});
export type SaveRosterInput = z.infer<typeof saveRosterSchema>;

// ---------- training ----------
export interface TrainingSampleRow {
  id: string;
  kind: ScreenshotKind;
  source: SampleSource;
  split: SampleSplit;
  verified: boolean;
  excluded: boolean;
  /** names in the labels (players), for list display */
  nameCount: number;
  notes: string | null;
  createdAt: string;
  createdBy: { id: string; displayName: string } | null;
}
export interface TrainingSampleDetail extends TrainingSampleRow {
  labels: SlotListLabels | ResultsLabels;
  width: number | null;
  height: number | null;
}
export const updateSampleSchema = z.object({
  labels: z.union([slotListLabelsSchema, resultsLabelsSchema]).optional(),
  split: z.enum(["TRAIN", "TEST"]).optional(),
  excluded: z.boolean().optional(),
  verified: z.boolean().optional(),
  notes: z.string().trim().max(500).optional(),
});
export type UpdateSampleInput = z.infer<typeof updateSampleSchema>;

export interface EvalMetrics {
  /** fraction 0..1 of player names read exactly right */
  nameExact: number;
  /** character error rate 0..1 */
  cer: number;
  slotAccuracy: number;
  /** RESULTS: fraction of finishes values read right */
  killsAccuracy: number | null;
  rankAccuracy: number | null;
  names: number;
  images: number;
  split: "TEST" | "TRAIN";
}
export interface ModelVersion {
  version: string;
  parent: string | null;
  status: "TRAINING" | "READY" | "FAILED";
  active: boolean;
  trainer: string;
  createdAt: string;
  sampleCount: number;
  metrics: EvalMetrics | null;
  notes: string | null;
}
export interface ModelList {
  active: string;
  items: ModelVersion[];
}
export const startTrainingSchema = z.object({
  baseVersion: z.string().max(40).optional(),
  notes: z.string().trim().max(500).optional(),
  /** activate automatically if test-split nameExact improves */
  autoActivate: z.boolean().default(false),
});
export type StartTrainingInput = z.infer<typeof startTrainingSchema>;
export interface TrainingRun {
  id: string;
  status: TrainingRunStatus;
  progress: number;
  baseVersion: string;
  resultVersion: string | null;
  sampleCount: number;
  metricsBefore: EvalMetrics | null;
  metricsAfter: EvalMetrics | null;
  logTail: string[];
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}
export interface ExtractorStatus {
  online: boolean;
  serviceVersion: string | null;
  activeModel: string | null;
  ocrReady: boolean;
  vlmEnabled: boolean;
  queue: { queued: number; processing: number; failedLast24h: number };
}
