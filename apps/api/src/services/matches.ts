/**
 * Manager match center (phase 2): matches per session, screenshots, lineup/results review, publish,
 * and applying extractor output to the match draft (used by the screenshot worker).
 */
import { Prisma, type MatchStatus as DbMatchStatus } from "@prisma/client";
import {
  MAX_ROSTER_PLAYERS,
  matchIgn,
  type ExtractionResult,
  type GameMap,
  type MatchDetail,
  type MatchStatus,
  type MatchSummary,
  type MatchTeamRow,
  type ResultsLabels,
  type SaveLineupInput,
  type SaveResultsInput,
  type ScreenshotKind,
  type ScreenshotRow,
  type ScreenshotSource,
  type SessionStandings,
  type SlotListLabels,
} from "@7xen/shared";
import { prisma, type Tx } from "../db.js";
import { AppError, conflict, notFound } from "../lib/errors.js";
import type { RosterSlot } from "../lib/extractor.js";
import { todayInAppTz } from "@7xen/shared";
import { dateToStr, iso, pointsSystemOf, strToDate, toTeamSummary } from "../lib/serialize.js";
import { datedKey, deleteKey, imageInfo, newFileId, saveBuffer, sha256 } from "../lib/storage.js";
import type { UploadedImage } from "../lib/upload.js";
import { inferSlot, mergeResults, mergeSlotList, TEAM_SIZE, type DraftTeam } from "./merge.js";
import { awardMatchCoins, revokeMatchCoins } from "./coins.js";
import { ensureSession } from "./registrations.js";
import { upsertCorrectionSample } from "./samples.js";
import { scrimOccursOn } from "./schedule.js";
import { loadOwnScrim } from "./scrims.js";
import { standingsForSession, storeMatchPoints } from "./standings.js";

const MATCH_NOT_FOUND = "Match not found";
/** Sources a client may claim on upload. "STATION" is only set by the station hooks. */
export const SCREENSHOT_SOURCES = ["WEB", "APP_AUTO", "APP_MANUAL"] as const satisfies readonly ScreenshotSource[];
const ALL_SCREENSHOT_SOURCES: readonly string[] = [...SCREENSHOT_SOURCES, "STATION", "DEVICE", "STUDIO", "STUDIO_AUTO"];
const SCREENSHOT_NOT_FOUND = "Screenshot not found";
export const LOW_CONFIDENCE = 0.85;

/** What we store in Screenshot.extraction: the camelCase ExtractionResult + our merge warnings. */
type StoredExtraction = ExtractionResult & { mergeWarnings?: string[] };

const STATUS_ORDER: Record<DbMatchStatus, number> = { SCHEDULED: 0, LINEUP_REVIEW: 1, LIVE: 2, RESULTS_REVIEW: 3, PUBLISHED: 4 };
export const lineupLocked = (s: DbMatchStatus) => STATUS_ORDER[s] >= STATUS_ORDER.LIVE;

// ---------------------------------------------------------------- loading

/**
 * A match belongs to a scrim session OR a tournament group. Everything owner-specific (who may edit it,
 * which team sits on which slot, which points system applies, how it's titled) goes through these helpers,
 * so the match center works the same for both.
 */
export const ownerInclude = {
  session: { include: { scrim: true } },
  group: {
    include: {
      stage: { select: { id: true, name: true, lobbySize: true, tournament: { select: { id: true, title: true, managerId: true, firstSlot: true, pointsSystem: true, winCoins: true, mode: true } } } },
    },
  },
} satisfies Prisma.MatchInclude;
export type MatchWithOwner = Prisma.MatchGetPayload<{ include: typeof ownerInclude }>;

/** Manager who owns the match (scrim manager or tournament manager). */
export const ownerManagerId = (m: Pick<MatchWithOwner, "session" | "group">): string | null =>
  m.session?.scrim.managerId ?? m.group?.stage.tournament.managerId ?? null;

/** `bypass` = admin acting on any match. */
export async function loadOwnMatch(matchId: string, managerId: string, bypass = false): Promise<MatchWithOwner> {
  const m = await prisma.match.findUnique({ where: { id: matchId }, include: ownerInclude });
  if (!m || (!bypass && ownerManagerId(m) !== managerId)) throw notFound(MATCH_NOT_FOUND);
  return m;
}

async function loadOwnScreenshot(id: string, managerId: string, bypass = false) {
  const s = await prisma.screenshot.findUnique({
    where: { id },
    include: {
      match: {
        select: {
          id: true,
          status: true,
          session: { select: { scrim: { select: { managerId: true } } } },
          group: { select: { stage: { select: { tournament: { select: { managerId: true } } } } } },
        },
      },
    },
  });
  if (!s) throw notFound(SCREENSHOT_NOT_FOUND);
  const owner = s.match.session?.scrim.managerId ?? s.match.group?.stage.tournament.managerId;
  if (!bypass && owner !== managerId) throw notFound(SCREENSHOT_NOT_FOUND);
  return s;
}

type SlotTeam = { slotNumber: number; team: { id: string; name: string; tag: string; members: { user: { ign: string | null } }[] } };
/** phase 5: a team's roster = its members' IGNs (leader first) */
const slotTeamSelect = {
  id: true,
  name: true,
  tag: true,
  members: { orderBy: [{ role: "asc" as const }, { joinedAt: "asc" as const }], select: { user: { select: { ign: true } } } },
};
const rosterNames = (t: SlotTeam["team"]): string[] => t.members.flatMap((m) => (m.user.ign ? [m.user.ign] : []));

/** Who sits on which slot: the session's APPROVED registrations, or the group's teams. */
async function matchSlots(owner: { sessionId: string | null; groupId: string | null }, db: Tx = prisma): Promise<SlotTeam[]> {
  if (owner.sessionId) {
    const regs = await db.registration.findMany({
      where: { sessionId: owner.sessionId, status: "APPROVED", slotNumber: { not: null } },
      select: { slotNumber: true, team: { select: slotTeamSelect } },
      orderBy: { slotNumber: "asc" },
    });
    return regs.map((r) => ({ slotNumber: r.slotNumber!, team: r.team }));
  }
  if (owner.groupId) {
    return db.groupTeam.findMany({
      where: { groupId: owner.groupId },
      select: { slotNumber: true, team: { select: slotTeamSelect } },
      orderBy: { slotNumber: "asc" },
    });
  }
  return [];
}

/** Points system for a match: the scrim's or the tournament's. */
export const matchPointsSystem = (m: Pick<MatchWithOwner, "session" | "group">) =>
  pointsSystemOf(m.session?.scrim.pointsSystem ?? m.group?.stage.tournament.pointsSystem);

// ---------------------------------------------------------------- DTO mapping

type ScreenshotRecord = Prisma.ScreenshotGetPayload<object>;

export function toScreenshotRow(s: ScreenshotRecord): ScreenshotRow {
  let extraction: ExtractionResult | null = null;
  if (s.status === "DONE" && s.extraction && typeof s.extraction === "object") {
    const { mergeWarnings: _mw, ...rest } = s.extraction as unknown as StoredExtraction;
    extraction = rest;
  }
  return {
    id: s.id,
    kind: s.kind,
    status: s.status,
    error: s.error,
    modelVersion: s.modelVersion,
    width: s.width,
    height: s.height,
    createdAt: s.createdAt.toISOString(),
    processedAt: iso(s.processedAt),
    extraction,
    source: ALL_SCREENSHOT_SOURCES.includes(s.source) ? (s.source as ScreenshotSource) : "WEB",
  };
}

function toMatchSummary(m: {
  id: string;
  number: number;
  map: string;
  status: DbMatchStatus;
  publishedAt: Date | null;
  screenshots: { kind: ScreenshotKind; status: string }[];
  _count: { teams: number };
}): MatchSummary {
  const counts = { slotList: 0, results: 0, processing: 0, failed: 0 };
  for (const s of m.screenshots) {
    if (s.kind === "SLOT_LIST") counts.slotList++;
    else counts.results++;
    if (s.status === "QUEUED" || s.status === "PROCESSING") counts.processing++;
    if (s.status === "FAILED") counts.failed++;
  }
  return {
    id: m.id,
    number: m.number,
    map: m.map as GameMap,
    status: m.status as MatchStatus,
    screenshotCounts: counts,
    teamsInLineup: m._count.teams,
    publishedAt: iso(m.publishedAt),
  };
}

const summaryInclude = {
  screenshots: { select: { kind: true, status: true } },
  _count: { select: { teams: true } },
} satisfies Prisma.MatchInclude;

type DetailTeam = {
  slotNumber: number;
  teamId: string | null;
  team: { id: string; name: string; tag: string } | null;
  placement: number | null;
  kills: number | null;
  placementPoints: number | null;
  killPoints: number | null;
  totalPoints: number | null;
  players: { position: number; name: string; ocrName: string | null; ocrConfidence: number | null; kills: number | null }[];
};

/** Plain-English review flags for one team row. */
function teamFlags(t: DetailTeam, all: DetailTeam[]): string[] {
  const flags: string[] = [];
  if (!t.teamId) flags.push(`Slot ${t.slotNumber} has no registered team`);
  if (t.placement != null && all.some((o) => o !== t && o.placement === t.placement)) {
    flags.push(`Placement #${t.placement} is used by more than one team`);
  }
  const pk = t.players.map((p) => p.kills).filter((k): k is number => k != null);
  if (t.kills != null && pk.length) {
    const sum = pk.reduce((a, b) => a + b, 0);
    if (sum !== t.kills) flags.push(`Team kills (${t.kills}) differ from the players' total (${sum})`);
  }
  const unsure = t.players.filter((p) => p.ocrName != null && p.ocrConfidence != null && p.ocrConfidence < LOW_CONFIDENCE && p.name === p.ocrName);
  if (unsure.length) flags.push(`Check the spelling of ${unsure.map((p) => `"${p.name}"`).join(", ")}`);
  if (t.players.length !== TEAM_SIZE) flags.push(`Team has ${t.players.length} player${t.players.length === 1 ? "" : "s"} (usually ${TEAM_SIZE})`);
  return flags;
}

function toMatchTeamRow(t: DetailTeam, all: DetailTeam[]): MatchTeamRow {
  return {
    slotNumber: t.slotNumber,
    team: t.team ? toTeamSummary(t.team) : null,
    players: t.players.map((p) => ({ position: p.position, name: p.name, ocrName: p.ocrName, ocrConfidence: p.ocrConfidence, kills: p.kills })),
    placement: t.placement,
    kills: t.kills,
    placementPoints: t.placementPoints,
    killPoints: t.killPoints,
    totalPoints: t.totalPoints,
    flags: teamFlags(t, all),
  };
}

const KIND_LABEL: Record<ScreenshotKind, string> = { SLOT_LIST: "Team list", RESULTS: "Results" };

// ---------------------------------------------------------------- matches list / detail

/** Matches of a session; creates the session and the Match rows (one per scrim map) on first call. */
export async function listSessionMatches(scrimId: string, managerId: string, date: string): Promise<MatchSummary[]> {
  const scrim = await loadOwnScrim(scrimId, managerId);
  const existingSession = await prisma.scrimSession.findUnique({ where: { scrimId_date: { scrimId, date: strToDate(date) } } });
  if (!existingSession && !scrimOccursOn(scrim, date)) throw notFound("This scrim doesn't run on that date");
  const session = existingSession ?? (await ensureSession(scrimId, date));
  await ensureMatches(session.id, scrim.maps);
  const rows = await prisma.match.findMany({ where: { sessionId: session.id }, include: summaryInclude, orderBy: { number: "asc" } });
  return rows.map(toMatchSummary);
}

/** Create missing Match rows from the scrim's maps; keep maps of untouched matches in sync. */
export async function ensureMatches(sessionId: string, maps: string[]) {
  const existing = await prisma.match.findMany({ where: { sessionId }, include: { _count: { select: { screenshots: true, teams: true } } } });
  const byNumber = new Map(existing.map((m) => [m.number, m]));
  const missing = maps.map((map, i) => ({ sessionId, number: i + 1, map })).filter((m) => !byNumber.has(m.number));
  if (missing.length) await prisma.match.createMany({ data: missing, skipDuplicates: true });
  for (const [i, map] of maps.entries()) {
    const m = byNumber.get(i + 1);
    if (m && m.map !== map && m.status === "SCHEDULED" && m._count.screenshots === 0 && m._count.teams === 0) {
      await prisma.match.update({ where: { id: m.id }, data: { map } });
    }
  }
}

export async function getMatchDetail(matchId: string, managerId: string, bypass = false): Promise<MatchDetail> {
  await loadOwnMatch(matchId, managerId, bypass);
  return buildMatchDetail(matchId);
}

/** The scrim-shaped header of MatchDetail (+ tournament context for group matches). */
function matchHeader(m: MatchWithOwner): Pick<MatchDetail, "scrim" | "date" | "tournament"> {
  if (m.session) {
    const sc = m.session.scrim;
    return {
      scrim: { id: sc.id, title: sc.title, slotCount: sc.slotCount, firstSlot: sc.firstSlot, pointsSystem: pointsSystemOf(sc.pointsSystem) },
      date: dateToStr(m.session.date),
      tournament: null,
    };
  }
  const g = m.group!;
  const t = g.stage.tournament;
  return {
    scrim: {
      id: t.id,
      title: `${t.title} · ${g.stage.name} · Group ${g.name}`,
      slotCount: g.stage.lobbySize,
      firstSlot: t.firstSlot,
      pointsSystem: pointsSystemOf(t.pointsSystem),
    },
    date: todayInAppTz(m.scheduledAt ?? g.startsAt ?? m.createdAt),
    tournament: { id: t.id, title: t.title, stageId: g.stage.id, stageName: g.stage.name, groupId: g.id, groupName: g.name },
  };
}

async function buildMatchDetail(matchId: string): Promise<MatchDetail> {
  const load = () =>
    prisma.match.findUniqueOrThrow({
      where: { id: matchId },
      include: {
        ...summaryInclude,
        ...ownerInclude,
        teams: {
          orderBy: { slotNumber: "asc" },
          include: { team: { select: { id: true, name: true, tag: true } }, players: { orderBy: { position: "asc" } } },
        },
      },
    });
  let m = await load();
  const regs = await matchSlots(m);
  const slotToTeam = new Map(regs.map((r) => [r.slotNumber, r.team]));

  // keep team assignments in sync with the session's registrations until results are published
  if (m.status !== "PUBLISHED") {
    let changed = false;
    for (const t of m.teams) {
      const want = slotToTeam.get(t.slotNumber)?.id ?? null;
      if (t.teamId !== want) {
        await prisma.matchTeam.update({ where: { id: t.id }, data: { teamId: want } });
        changed = true;
      }
    }
    if (changed) m = await load();
  }
  const screenshots = await prisma.screenshot.findMany({ where: { matchId }, orderBy: { createdAt: "asc" } });

  const teams = m.teams as DetailTeam[];
  const warnings: string[] = [];
  if (m.status !== "PUBLISHED") {
    if (m.teams.length > 0) {
      const inLineup = new Set(m.teams.map((t) => t.teamId).filter(Boolean));
      for (const r of regs) {
        if (!inLineup.has(r.team.id)) warnings.push(`${r.team.name} (slot ${r.slotNumber}) isn't in the lineup`);
      }
    }
    // show the warnings for the stage the match is in
    const stageKind: ScreenshotKind = lineupLocked(m.status) ? "RESULTS" : "SLOT_LIST";
    const seen = new Set<string>();
    screenshots
      .filter((s) => s.kind === stageKind && s.status === "DONE" && s.extraction)
      .forEach((s, i) => {
        const ex = s.extraction as unknown as StoredExtraction;
        for (const w of [...(ex.mergeWarnings ?? []), ...(ex.warnings ?? [])]) {
          const text = `${KIND_LABEL[s.kind]} screenshot ${i + 1}: ${w}`;
          if (!seen.has(w)) {
            seen.add(w);
            warnings.push(text);
          }
        }
      });
  }

  return {
    match: toMatchSummary(m),
    ...matchHeader(m),
    screenshots: screenshots.map(toScreenshotRow),
    teams: teams.map((t) => toMatchTeamRow(t, teams)),
    sessionSlots: regs.map((r) => ({ slotNumber: r.slotNumber, team: toTeamSummary(r.team) })),
    warnings,
    isTdm: m.group?.stage.tournament.mode === "TDM",
    tieNote: m.tieNote,
  };
}

// ---------------------------------------------------------------- screenshots

export async function uploadScreenshots(
  matchId: string,
  managerId: string,
  kind: ScreenshotKind,
  images: UploadedImage[],
  bypass = false,
  source: ScreenshotSource = "WEB",
): Promise<{ items: ScreenshotRow[]; skipped: number }> {
  const m = await loadOwnMatch(matchId, managerId, bypass);
  if (m.status === "PUBLISHED") throw conflict("Results are published. Unpublish the match to add screenshots.");
  if (!images.length) throw new AppError("VALIDATION_ERROR", "Choose at least one screenshot", { files: "Choose a screenshot" });

  const existing = new Set((await prisma.screenshot.findMany({ where: { matchId }, select: { sha256: true } })).map((s) => s.sha256));
  const items: ScreenshotRow[] = [];
  let skipped = 0;
  for (const img of images) {
    if (existing.has(img.sha256)) {
      skipped++;
      continue;
    }
    existing.add(img.sha256);
    const id = newFileId();
    const storageKey = datedKey("screenshots", id, img.info.ext);
    await saveBuffer(storageKey, img.buffer);
    try {
      const row = await prisma.screenshot.create({
        data: {
          id,
          matchId,
          kind,
          storageKey,
          mimeType: img.info.mime,
          sha256: img.sha256,
          width: img.info.width,
          height: img.info.height,
          source,
          uploadedById: managerId,
        },
      });
      items.push(toScreenshotRow(row));
    } catch (e) {
      await deleteKey(storageKey);
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        skipped++;
        continue;
      }
      throw e;
    }
  }
  return { items, skipped };
}

export async function screenshotFile(id: string, managerId: string, bypass = false) {
  const s = await loadOwnScreenshot(id, managerId, bypass);
  return { storageKey: s.storageKey, mimeType: s.mimeType };
}

export async function retryScreenshot(id: string, managerId: string, bypass = false): Promise<ScreenshotRow> {
  const s = await loadOwnScreenshot(id, managerId, bypass);
  if (s.status !== "FAILED") throw conflict("Only screenshots that failed can be retried");
  const row = await prisma.screenshot.update({
    where: { id },
    data: { status: "QUEUED", attempts: 0, error: null, processedAt: null },
  });
  return toScreenshotRow(row);
}

export async function deleteScreenshot(id: string, managerId: string, bypass = false): Promise<void> {
  const s = await loadOwnScreenshot(id, managerId, bypass);
  if (s.match.status === "PUBLISHED") throw conflict("Results are published. Unpublish the match to remove screenshots.");
  await prisma.screenshot.delete({ where: { id } });
  await deleteKey(s.storageKey);
}

// ---------------------------------------------------------------- lineup

function lineupErrors(input: SaveLineupInput) {
  const fields: Record<string, string> = {};
  const slots = new Set<number>();
  input.teams.forEach((t, i) => {
    if (slots.has(t.slotNumber)) fields[`teams.${i}.slotNumber`] = `Slot ${t.slotNumber} is listed twice`;
    slots.add(t.slotNumber);
    const pos = new Set<number>();
    t.players.forEach((p, j) => {
      if (pos.has(p.position)) fields[`teams.${i}.players.${j}.position`] = "Two players have the same position";
      pos.add(p.position);
    });
  });
  if (Object.keys(fields).length) throw new AppError("VALIDATION_ERROR", "Please check the highlighted fields", fields);
}

const lockMatch = (tx: Tx, matchId: string) => tx.$queryRaw`SELECT id FROM "Match" WHERE id = ${matchId} FOR UPDATE`;

export async function saveLineup(matchId: string, managerId: string, input: SaveLineupInput, bypass = false): Promise<MatchDetail> {
  const m = await loadOwnMatch(matchId, managerId, bypass);
  if (m.status === "PUBLISHED") throw conflict("Results are published. Unpublish the match to change the lineup.");
  lineupErrors(input);
  if (input.confirm && !input.teams.some((t) => t.players.length > 0)) {
    throw new AppError("VALIDATION_ERROR", "Add at least one team with players before confirming the lineup");
  }

  await prisma.$transaction(
    async (tx) => {
      await lockMatch(tx, matchId);
      const regs = await matchSlots(m, tx);
      const slotToTeam = new Map(regs.map((r) => [r.slotNumber, r.team.id]));
      const current = await tx.matchTeam.findMany({ where: { matchId }, include: { players: true } });
      const keep = new Set(input.teams.map((t) => t.slotNumber));
      await tx.matchTeam.deleteMany({ where: { matchId, slotNumber: { notIn: [...keep] } } });

      for (const t of input.teams) {
        const prev = current.find((c) => c.slotNumber === t.slotNumber);
        const mt = await tx.matchTeam.upsert({
          where: { matchId_slotNumber: { matchId, slotNumber: t.slotNumber } },
          create: { matchId, slotNumber: t.slotNumber, teamId: slotToTeam.get(t.slotNumber) ?? null },
          update: { teamId: slotToTeam.get(t.slotNumber) ?? null },
        });
        const prevByPos = new Map((prev?.players ?? []).map((p) => [p.position, p]));
        await tx.matchPlayer.deleteMany({ where: { matchTeamId: mt.id, position: { notIn: t.players.map((p) => p.position) } } });
        for (const p of t.players) {
          const old = prevByPos.get(p.position);
          await tx.matchPlayer.upsert({
            where: { matchTeamId_position: { matchTeamId: mt.id, position: p.position } },
            create: { matchTeamId: mt.id, position: p.position, name: p.name },
            update: { name: p.name, ...(old ? {} : { ocrName: null, ocrConfidence: null }) },
          });
        }
      }

      let status: DbMatchStatus = m.status;
      if (input.confirm && STATUS_ORDER[m.status] < STATUS_ORDER.LIVE) status = "LIVE";
      else if (m.status === "SCHEDULED" && input.teams.length) status = "LINEUP_REVIEW";
      if (status !== m.status) await tx.match.update({ where: { id: matchId }, data: { status, ...(status === "LIVE" ? { liveAt: new Date() } : {}) } });
    },
    { maxWait: 10_000, timeout: 20_000 },
  );

  if (input.confirm) {
    await linkMatchPlayers(matchId);
    await recordLineupSamples(matchId, managerId);
  }
  return buildMatchDetail(matchId);
}

/**
 * 7XEN Studio Start: the lineup to confirm — the players read from the lobby, slot by slot. Once a lobby was read, a
 * registered team nobody from it joined has no players (it stays in the match; it just didn't join). Only when no
 * lobby was read at all do the registered rosters stand in, so a match can still start. 409 when there's nobody.
 */
export async function startLineup(matchId: string): Promise<SaveLineupInput> {
  const m = await prisma.match.findUniqueOrThrow({ where: { id: matchId }, select: { sessionId: true, groupId: true } });
  const draft = await prisma.matchTeam.findMany({ where: { matchId }, include: { players: { orderBy: { position: "asc" } } } });
  const read = draft.filter((t) => t.players.length).map((t) => ({ slotNumber: t.slotNumber, players: t.players.map((p) => ({ position: p.position, name: p.name.slice(0, 40) })) }));
  const teams = read.length
    ? read
    : (await matchSlots(m)).map((r) => ({
        slotNumber: r.slotNumber,
        players: rosterNames(r.team).slice(0, MAX_ROSTER_PLAYERS).map((name, i) => ({ position: i + 1, name: name.slice(0, 40) })),
      }));
  const lineup = teams.filter((t) => t.players.length).sort((x, y) => x.slotNumber - y.slotNumber).slice(0, 25);
  if (!lineup.length) throw conflict("Nobody to start with — no player has joined this match yet.");
  return { confirm: true, teams: lineup };
}

/**
 * A 7XEN Studio capture the reader recognised as a team list or results screen becomes a Match Center screenshot
 * (source STUDIO_AUTO, already read) and is merged into the match draft. Frames that add nothing are dropped again —
 * a studio sends one every few seconds. Returns the screenshot (null when dropped) and how many slots changed.
 */
export async function adoptScreenshot(
  matchId: string,
  kind: ScreenshotKind,
  image: Buffer,
  mime: string,
  result: ExtractionResult,
): Promise<{ screenshotId: string | null; changed: number }> {
  const m = await prisma.match.findUniqueOrThrow({ where: { id: matchId }, include: ownerInclude });
  const sha = sha256(image);
  if (await prisma.screenshot.findUnique({ where: { matchId_sha256: { matchId, sha256: sha } }, select: { id: true } })) {
    return { screenshotId: null, changed: 0 };
  }
  const info = imageInfo(image);
  const id = newFileId();
  const storageKey = datedKey("screenshots", id, info?.ext ?? "jpg");
  await saveBuffer(storageKey, image);
  try {
    await prisma.screenshot.create({
      data: {
        id,
        matchId,
        kind,
        storageKey,
        mimeType: info?.mime ?? mime,
        sha256: sha,
        width: info?.width,
        height: info?.height,
        status: "PROCESSING",
        source: "STUDIO_AUTO",
        uploadedById: ownerManagerId(m)!,
      },
    });
  } catch (e) {
    await deleteKey(storageKey);
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { screenshotId: null, changed: 0 };
    throw e;
  }
  const { changed } = await applyExtraction(id, result);
  if (changed === 0) {
    await prisma.screenshot.delete({ where: { id } });
    await deleteKey(storageKey);
    return { screenshotId: null, changed };
  }
  return { screenshotId: id, changed };
}

/**
 * Link a match's player rows to accounts: a read name links to a member of THAT slot's team (matchIgn, ≥95% after
 * normalising) who was in the team when the match started — someone who joins later never gets an old match.
 * A link to a player who has since left the team is kept (their past matches stay theirs); a name nobody matches stays
 * unknown (the kills still count for the team). One account per slot.
 */
export async function linkMatchPlayers(matchId: string) {
  const m = await prisma.match.findUniqueOrThrow({ where: { id: matchId }, select: { liveAt: true, scheduledAt: true } });
  const startedAt = m.liveAt ?? m.scheduledAt ?? new Date();
  const teams = await prisma.matchTeam.findMany({
    where: { matchId },
    include: {
      players: { orderBy: { position: "asc" } },
      team: { select: { members: { select: { userId: true, joinedAt: true, user: { select: { ign: true } } } } } },
    },
  });
  for (const t of teams) {
    const members = t.team?.members ?? [];
    const memberIds = new Set(members.map((x) => x.userId));
    const eligible = members.filter((x) => x.user.ign && x.joinedAt <= startedAt).map((x) => ({ userId: x.userId, ign: x.user.ign! }));
    const used = new Set<string>();
    for (const p of t.players) {
      let userId = matchIgn(p.name, eligible)?.userId ?? null;
      if (!userId && p.userId && !memberIds.has(p.userId)) userId = p.userId;
      if (userId && used.has(userId)) userId = null;
      if (userId) used.add(userId);
      if (p.userId !== userId) await prisma.matchPlayer.update({ where: { id: p.id }, data: { userId } });
    }
  }
}

/** One verified SLOT_LIST training sample per read team-list screenshot: labels = confirmed teams it showed. */
async function recordLineupSamples(matchId: string, userId: string) {
  const [shots, teams] = await Promise.all([
    prisma.screenshot.findMany({ where: { matchId, kind: "SLOT_LIST", status: "DONE" } }),
    prisma.matchTeam.findMany({ where: { matchId }, include: { players: { orderBy: { position: "asc" } } } }),
  ]);
  const drafts: DraftTeam[] = teams.map((t) => ({ slotNumber: t.slotNumber, teamId: t.teamId, placement: t.placement, kills: t.kills, players: t.players }));
  for (const s of shots) {
    const ex = s.extraction as unknown as StoredExtraction | null;
    if (!ex?.teams) continue;
    const slots = new Set<number>();
    for (const et of ex.teams) {
      const slot = et.slot ?? (et.players.length ? inferSlot(et.players, drafts) : null);
      if (slot != null) slots.add(slot);
    }
    const labels: SlotListLabels = {
      teams: teams
        .filter((t) => slots.has(t.slotNumber) && t.players.length > 0)
        .slice(0, 25)
        .map((t) => ({ slot: t.slotNumber, players: t.players.slice(0, MAX_ROSTER_PLAYERS).map((p) => p.name.slice(0, 40)) })),
    };
    await upsertCorrectionSample({ screenshot: s, labels, userId });
  }
}

// ---------------------------------------------------------------- results

export async function saveResults(matchId: string, managerId: string, input: SaveResultsInput, bypass = false): Promise<MatchDetail> {
  const m = await loadOwnMatch(matchId, managerId, bypass);
  if (m.status === "PUBLISHED") throw conflict("Results are published. Unpublish the match to change them.");
  const fields: Record<string, string> = {};
  const seen = new Set<number>();
  input.teams.forEach((t, i) => {
    if (seen.has(t.slotNumber)) fields[`teams.${i}.slotNumber`] = `Slot ${t.slotNumber} is listed twice`;
    seen.add(t.slotNumber);
  });
  const existing = await prisma.matchTeam.findMany({ where: { matchId }, include: { players: true } });
  const bySlot = new Map(existing.map((t) => [t.slotNumber, t]));
  input.teams.forEach((t, i) => {
    if (!bySlot.has(t.slotNumber)) fields[`teams.${i}.slotNumber`] = `Slot ${t.slotNumber} isn't in the lineup`;
  });
  if (Object.keys(fields).length) throw new AppError("VALIDATION_ERROR", "Please check the highlighted fields", fields);

  await prisma.$transaction(
    async (tx) => {
      await lockMatch(tx, matchId);
      for (const t of input.teams) {
        const mt = bySlot.get(t.slotNumber)!;
        if (t.players) {
          for (const p of t.players) {
            await tx.matchPlayer.updateMany({ where: { matchTeamId: mt.id, position: p.position }, data: { kills: p.kills } });
          }
        }
        let kills = t.kills;
        if (kills == null && t.players?.some((p) => p.kills != null)) {
          kills = t.players.reduce((s, p) => s + (p.kills ?? 0), 0);
        }
        await tx.matchTeam.update({ where: { id: mt.id }, data: { placement: t.placement, kills } });
      }
      const tieNote = input.tieNote === undefined ? undefined : input.tieNote || null;
      if (m.status !== "RESULTS_REVIEW" || tieNote !== undefined) {
        await tx.match.update({ where: { id: matchId }, data: { status: "RESULTS_REVIEW", ...(tieNote !== undefined ? { tieNote } : {}) } });
      }
    },
    { maxWait: 10_000, timeout: 20_000 },
  );
  return buildMatchDetail(matchId);
}

export async function publishMatch(matchId: string, managerId: string, bypass = false): Promise<MatchDetail> {
  const m = await loadOwnMatch(matchId, managerId, bypass);
  if (m.status === "PUBLISHED") return buildMatchDetail(matchId);

  const teams = await prisma.matchTeam.findMany({ where: { matchId }, orderBy: { slotNumber: "asc" } });
  const ranked = teams.filter((t) => t.teamId);
  if (!ranked.length) throw new AppError("VALIDATION_ERROR", "Add the teams and their placements before publishing");

  const fields: Record<string, string> = {};
  for (const t of ranked) if (t.placement == null) fields[`teams.${t.slotNumber}.placement`] = `Enter a placement for slot ${t.slotNumber}`;
  const placed = teams.filter((t) => t.placement != null);
  const max = Math.max(ranked.length, placed.length);
  const counts = new Map<number, number>();
  for (const t of placed) counts.set(t.placement!, (counts.get(t.placement!) ?? 0) + 1);
  for (const t of placed) {
    if ((counts.get(t.placement!) ?? 0) > 1) fields[`teams.${t.slotNumber}.placement`] = `Placement #${t.placement} is used more than once`;
    else if (t.placement! > max) fields[`teams.${t.slotNumber}.placement`] = `Placement #${t.placement} is more than the number of teams (${max})`;
  }
  if (Object.keys(fields).length) {
    const missing = Object.values(fields).filter((v) => v.startsWith("Enter")).length;
    const message = missing ? `${missing} team${missing === 1 ? " has" : "s have"} no placement yet` : "Each placement can only be used once";
    throw new AppError("VALIDATION_ERROR", message, fields);
  }

  // TDM: equal kills can't decide the match, so the manager picks the winner (rank 1) and says why
  const tdm = m.group?.stage.tournament.mode === "TDM";
  const tied = tdm && placed.length === 2 && (placed[0]!.kills ?? 0) === (placed[1]!.kills ?? 0);
  if (tied && !m.tieNote) {
    throw new AppError("VALIDATION_ERROR", "Both teams have the same kills. Give the winner rank 1 and add a short reason.", {
      tieNote: "Say why this team wins the tie",
    });
  }

  const ps = matchPointsSystem(m);
  await prisma.$transaction(async (tx) => {
    await lockMatch(tx, matchId);
    await tx.matchTeam.updateMany({ where: { matchId, kills: null, placement: { not: null } }, data: { kills: 0 } });
    await storeMatchPoints(tx, matchId, ps);
    // TDM battles pay the champion only (awardChampionCoins), not each match winner
    const tour = m.group?.stage.tournament;
    await awardMatchCoins(tx, matchId, m.session?.scrim.winCoins ?? (tour && tour.mode !== "TDM" ? tour.winCoins : 0));
    await tx.match.update({ where: { id: matchId }, data: { status: "PUBLISHED", publishedAt: new Date(), ...(tied ? {} : { tieNote: null }) } });
  });
  await recordResultsSamples(matchId, managerId);
  await linkMatchPlayers(matchId);
  return buildMatchDetail(matchId);
}

/** One verified RESULTS training sample per read results screenshot: labels = confirmed ranks it showed. */
async function recordResultsSamples(matchId: string, userId: string) {
  const [shots, teams] = await Promise.all([
    prisma.screenshot.findMany({ where: { matchId, kind: "RESULTS", status: "DONE" } }),
    prisma.matchTeam.findMany({ where: { matchId, placement: { not: null } }, include: { players: { orderBy: { position: "asc" } } } }),
  ]);
  const byRank = new Map(teams.map((t) => [t.placement!, t]));
  for (const s of shots) {
    const ex = s.extraction as unknown as StoredExtraction | null;
    if (!ex?.rows) continue;
    const ranks = [...new Set(ex.rows.map((r) => r.rank).filter((r): r is number => r != null))].sort((a, b) => a - b);
    const labels: ResultsLabels = {
      rows: ranks
        .map((rank) => ({ rank, team: byRank.get(rank) }))
        .filter((x) => x.team && x.team.players.length > 0 && x.rank <= 100)
        .slice(0, 25)
        .map(({ rank, team }) => ({
          rank,
          players: team!.players.slice(0, MAX_ROSTER_PLAYERS).map((p) => ({ name: p.name.slice(0, 40), kills: Math.min(99, p.kills ?? 0) })),
        })),
    };
    await upsertCorrectionSample({ screenshot: s, labels, userId });
  }
}

export async function unpublishMatch(matchId: string, managerId: string, bypass = false): Promise<MatchDetail> {
  const m = await loadOwnMatch(matchId, managerId, bypass);
  if (m.status !== "PUBLISHED") throw conflict("This match isn't published");
  await prisma.$transaction(async (tx) => {
    await lockMatch(tx, matchId);
    await tx.matchTeam.updateMany({ where: { matchId }, data: { placementPoints: null, killPoints: null, totalPoints: null } });
    await revokeMatchCoins(tx, matchId);
    await tx.match.update({ where: { id: matchId }, data: { status: "RESULTS_REVIEW", publishedAt: null } });
  });
  return buildMatchDetail(matchId);
}

export async function managerStandings(scrimId: string, managerId: string, date: string): Promise<SessionStandings> {
  const scrim = await loadOwnScrim(scrimId, managerId);
  const existing = await prisma.scrimSession.findUnique({ where: { scrimId_date: { scrimId, date: strToDate(date) } } });
  if (!existing && !scrimOccursOn(scrim, date)) throw notFound("This scrim doesn't run on that date");
  const session = existing ?? (await ensureSession(scrimId, date));
  await ensureMatches(session.id, scrim.maps);
  return standingsForSession(session.id);
}

// ---------------------------------------------------------------- extraction → draft (worker)

/** Roster to send with a screenshot: known names per slot (session rosters, plus the lineup for results). */
export async function rosterForScreenshot(screenshotId: string): Promise<RosterSlot[]> {
  const s = await prisma.screenshot.findUniqueOrThrow({
    where: { id: screenshotId },
    select: { kind: true, match: { select: { id: true, sessionId: true, groupId: true } } },
  });
  return rosterForMatch(s.match, s.kind);
}

/** Known player names per slot for the reader: the registered rosters (+ the lineup, for results). */
export async function rosterForMatch(match: { id: string; sessionId: string | null; groupId: string | null }, kind: ScreenshotKind): Promise<RosterSlot[]> {
  const s = { kind, match };
  const regs = await matchSlots(s.match);
  const bySlot = new Map<number, RosterSlot>();
  for (const r of regs) {
    bySlot.set(r.slotNumber, { slot: r.slotNumber, teamName: r.team.name, players: rosterNames(r.team) });
  }
  if (s.kind === "RESULTS") {
    const lineup = await prisma.matchTeam.findMany({
      where: { matchId: s.match.id },
      include: { players: { orderBy: { position: "asc" } }, team: { select: { name: true } } },
    });
    for (const t of lineup) {
      const entry = bySlot.get(t.slotNumber) ?? { slot: t.slotNumber, teamName: t.team?.name ?? null, players: [] };
      const names = [...t.players.map((p) => p.name), ...entry.players];
      const seen = new Set<string>();
      entry.players = names.filter((n) => {
        const k = n.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      bySlot.set(t.slotNumber, entry);
    }
  }
  return [...bySlot.values()].filter((r) => r.players.length > 0).sort((a, b) => a.slot - b.slot);
}

/** Merge an extraction into the match draft and mark the screenshot DONE (one transaction, match row locked). */
/** Merge a read screenshot into the match draft: the merge warnings, and how many slots it changed. */
export async function applyExtraction(screenshotId: string, result: ExtractionResult): Promise<{ warnings: string[]; changed: number }> {
  return prisma.$transaction(
    async (tx) => {
      const s = await tx.screenshot.findUniqueOrThrow({ where: { id: screenshotId }, select: { id: true, kind: true, matchId: true, source: true } });
      await lockMatch(tx, s.matchId);
      const m = await tx.match.findUniqueOrThrow({
        where: { id: s.matchId },
        include: { teams: { include: { players: { orderBy: { position: "asc" } } } } },
      });
      const regs = await matchSlots(m, tx);
      const ctx = {
        slotToTeam: new Map(regs.map((r) => [r.slotNumber, r.team.id])),
        rosterBySlot: new Map(regs.map((r) => [r.slotNumber, rosterNames(r.team)])),
        lineupLocked: lineupLocked(m.status),
        resultsLocked: m.status === "PUBLISHED",
      };
      const draft: DraftTeam[] = m.teams.map((t) => ({
        slotNumber: t.slotNumber,
        teamId: t.teamId,
        placement: t.placement,
        kills: t.kills,
        players: t.players.map((p) => ({ position: p.position, name: p.name, ocrName: p.ocrName, ocrConfidence: p.ocrConfidence, kills: p.kills })),
      }));
      const out = s.kind === "SLOT_LIST" ? mergeSlotList(draft, result, ctx) : mergeResults(draft, result, ctx);
      // changedSlots = slots the read touched; count those that really differ (a repeat screenshot changes nothing)
      const sig = (t: { teamId: string | null; placement: number | null; kills: number | null; players: { name: string; kills: number | null }[] } | undefined) =>
        JSON.stringify(t ? [t.teamId, t.placement, t.kills, t.players.map((p) => [p.name, p.kills])] : null);
      const changed = [...out.changedSlots].filter(
        (slot) => sig(draft.find((d) => d.slotNumber === slot)) !== sig(out.teams.find((t) => t.slotNumber === slot)),
      ).length;

      for (const slot of out.changedSlots) {
        const t = out.teams.find((x) => x.slotNumber === slot)!;
        const mt = await tx.matchTeam.upsert({
          where: { matchId_slotNumber: { matchId: m.id, slotNumber: slot } },
          create: { matchId: m.id, slotNumber: slot, teamId: t.teamId, placement: t.placement, kills: t.kills },
          update: { teamId: t.teamId, placement: t.placement, kills: t.kills },
        });
        // a re-read keeps each name's account link (linkMatchPlayers re-checks it on publish)
        const linked = new Map(
          (m.teams.find((x) => x.slotNumber === slot)?.players ?? []).flatMap((p) => (p.userId ? [[p.name.trim().toLowerCase(), p.userId] as const] : [])),
        );
        await tx.matchPlayer.deleteMany({ where: { matchTeamId: mt.id } });
        if (t.players.length) {
          await tx.matchPlayer.createMany({
            data: t.players.map((p) => ({
              matchTeamId: mt.id,
              position: p.position,
              name: p.name.slice(0, 60),
              ocrName: p.ocrName,
              ocrConfidence: p.ocrConfidence,
              kills: p.kills,
              userId: linked.get(p.name.slice(0, 60).trim().toLowerCase()) ?? null,
            })),
          });
        }
      }

      let status: DbMatchStatus = m.status;
      // a Studio auto-capture frame that read nothing (e.g. the game already started) doesn't open the lineup review
      if (s.kind === "SLOT_LIST" && m.status === "SCHEDULED" && (changed > 0 || s.source !== "STUDIO_AUTO")) status = "LINEUP_REVIEW";
      if (s.kind === "RESULTS" && m.status === "LIVE") status = "RESULTS_REVIEW";
      if (status !== m.status) await tx.match.update({ where: { id: m.id }, data: { status } });

      const stored: StoredExtraction = { ...result, mergeWarnings: out.warnings };
      await tx.screenshot.update({
        where: { id: s.id },
        data: {
          status: "DONE",
          error: null,
          processedAt: new Date(),
          modelVersion: result.modelVersion,
          extraction: stored as unknown as Prisma.InputJsonValue,
        },
      });
      return { warnings: out.warnings, changed };
    },
    { maxWait: 15_000, timeout: 30_000 },
  );
}
