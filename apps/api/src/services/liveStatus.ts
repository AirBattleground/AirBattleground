/**
 * Live team status (shared/studioLink.ts): which players of each registered team are alive, knocked or eliminated,
 * marked by the manager on the Match Center screen or read from 7XEN Studio auto captures, and polled by the studio's
 * Team Status board.
 *
 * Rows = the teams registered on the match (approved registrations / group teams), so a team added mid-match shows up
 * on the next poll. Players = the confirmed lineup (first 4 by position), else the team's roster; a player with no
 * stored state is alive. Before the lineup is confirmed every team shows 4 players (roster padded), all alive, 0 kills.
 * Kills / points come from the match's results rows (MatchTeam): the manager's live figures while the match runs,
 * then what the results screenshots / results form say. Once it ends the body carries `summary` (+ MVP), once
 * published `winner`.
 * The payload is hashed: when the hash changes, liveVersion is bumped — the board's `version` and ETag. `autoCapture`
 * is left out of the hash (it changes on every capture).
 *
 * Precedence (auto vs manager): a manager edit wins and locks that player for 60 s against auto updates; auto updates
 * apply only to values read with confidence ≥ 0.8; auto never revives an eliminated player; nothing auto applies
 * unless the match is live and auto updates aren't paused.
 */
import { createHash } from "node:crypto";
import type { LiveCaptureStatus, Prisma } from "@prisma/client";
import {
  LIVE_CAPTURE_ACTIVE_MS,
  LIVE_MANAGER_LOCK_MS,
  LIVE_MIN_CONFIDENCE,
  LIVE_TEAM_SIZE,
  MAP_LABELS,
  matchPoints,
  type GameMap,
  type PointsSystem,
  type LiveAutoCapture,
  type LivePlayerState,
  type LiveStateSource,
  type MatchStatus,
  type SaveLiveTeamInput,
  type StudioLinkLive,
  type StudioLinkLiveState,
  type StudioLinkLiveTeam,
  type StudioLinkMvp,
  type StudioLinkSummary,
  type StudioLinkSummaryTeam,
  type StudioLinkWinner,
  type StudioMatchControl,
} from "@7xen/shared";
import { prisma, type Tx } from "../db.js";
import { conflict, forbidden, notFound } from "../lib/errors.js";
import { avatarOf, brandingUrl, dateToStr } from "../lib/serialize.js";
import { matchContext } from "./matchContext.js";
import { loadOwnMatch, matchPointsSystem, ownerInclude, ownerManagerId, type MatchWithOwner } from "./matches.js";
import { startsAtOf } from "./schedule.js";
import { publicUrl } from "./youtube.js";

/** One player's stored state. Older rows stored bare state strings; storedTeams() upgrades them. */
export interface StoredPlayer {
  state: LivePlayerState;
  source?: LiveStateSource;
  /** ISO instant of the last change */
  at?: string;
}
type LiveTeams = Record<string, StoredPlayer[]>;
type Body = Omit<StudioLinkLive, "version" | "updatedAt" | "autoCapture">;

const STAMP_TRIES = 3;

const lineupPending = (s: MatchStatus) => s === "SCHEDULED" || s === "LINEUP_REVIEW";

function liveState(s: MatchStatus): StudioLinkLiveState {
  if (s === "LIVE") return "live";
  if (s === "RESULTS_REVIEW") return "summary";
  if (s === "PUBLISHED") return "finished";
  return "scheduled";
}

function matchTitle(m: MatchWithOwner): string {
  if (m.session) return `${m.session.scrim.title} - Match ${m.number}`;
  const g = m.group!;
  return `${g.stage.tournament.title} · ${g.stage.name} · Group ${g.name} - Match ${m.number}`;
}

const teamSelect = {
  id: true,
  name: true,
  tag: true,
  logoKey: true,
  members: { orderBy: [{ role: "asc" as const }, { joinedAt: "asc" as const }], select: { user: { select: { ign: true } } } },
} satisfies Prisma.TeamSelect;
export type SlotTeam = { slotNumber: number; team: Prisma.TeamGetPayload<{ select: typeof teamSelect }> };

/** Registered teams by slot: the session's APPROVED registrations, or the group's teams. */
export async function registeredTeams(m: { sessionId: string | null; groupId: string | null }, db: Tx = prisma): Promise<SlotTeam[]> {
  if (m.sessionId) {
    const regs = await db.registration.findMany({
      where: { sessionId: m.sessionId, status: "APPROVED", slotNumber: { not: null } },
      select: { slotNumber: true, team: { select: teamSelect } },
      orderBy: { slotNumber: "asc" },
    });
    return regs.map((r) => ({ slotNumber: r.slotNumber!, team: r.team }));
  }
  if (m.groupId) {
    return db.groupTeam.findMany({ where: { groupId: m.groupId }, select: { slotNumber: true, team: { select: teamSelect } }, orderBy: { slotNumber: "asc" } });
  }
  return [];
}

/**
 * Board player names per team id: the lineup read from the lobby (first 4 by position). Before the match starts (no
 * lobby yet) the registered roster stands in (null = no IGN); once it has, a team nobody joined from has no players.
 */
export async function playerNames(matchId: string, slots: SlotTeam[], db: Tx = prisma, rosterFallback = true): Promise<Map<string, (string | null)[]>> {
  const lineup = await db.matchTeam.findMany({
    where: { matchId, teamId: { not: null } },
    select: { teamId: true, players: { orderBy: { position: "asc" }, take: LIVE_TEAM_SIZE, select: { name: true } } },
  });
  const fromLineup = new Map(lineup.filter((t) => t.players.length).map((t) => [t.teamId!, t.players.map((p) => p.name)]));
  return new Map(slots.map(({ team }) => [team.id, fromLineup.get(team.id) ?? (rosterFallback ? team.members.slice(0, LIVE_TEAM_SIZE).map((x) => x.user.ign) : [])]));
}

// ---------------------------------------------------------------- studio control

/** "21:30" → "9:30 PM" */
function time12(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

/**
 * What 7XEN Studio may do with a match. A scrim match unlocks when registration closes (the scrim's start time) or
 * as soon as every slot is filled; a tournament group match is ready once drawn. `teams` = teams in the match.
 */
export function controlOf(m: MatchWithOwner, teams: number, now = new Date()): StudioMatchControl {
  const slots = m.session ? m.session.scrim.slotCount : (m.group?.stage.lobbySize ?? 0);
  const base = { unlocksAt: null, reason: null, teams, slots };
  if (m.status === "PUBLISHED") return { ...base, state: "published" };
  if (m.status === "RESULTS_REVIEW") return { ...base, state: "ended" };
  if (m.status === "LIVE") return { ...base, state: "live" };
  if (m.session) {
    const closes = startsAtOf(dateToStr(m.session.date), m.session.scrim.startTime);
    if (now < closes && teams < slots) {
      return {
        ...base,
        state: "locked",
        unlocksAt: closes.toISOString(),
        reason: `Registration is open until ${time12(m.session.scrim.startTime)} (${teams}/${slots} slots filled)`,
      };
    }
  }
  return { ...base, state: "ready" };
}

/** Teams in each match (approved registrations of its session / teams of its group), by match id. */
export async function teamCounts(ms: { id: string; sessionId: string | null; groupId: string | null }[]): Promise<Map<string, number>> {
  const sessionIds = [...new Set(ms.flatMap((m) => (m.sessionId ? [m.sessionId] : [])))];
  const groupIds = [...new Set(ms.flatMap((m) => (m.groupId ? [m.groupId] : [])))];
  const [regs, groups] = await Promise.all([
    sessionIds.length
      ? prisma.registration.groupBy({ by: ["sessionId"], where: { sessionId: { in: sessionIds }, status: "APPROVED", slotNumber: { not: null } }, _count: true })
      : [],
    groupIds.length ? prisma.groupTeam.groupBy({ by: ["groupId"], where: { groupId: { in: groupIds } }, _count: true }) : [],
  ]);
  const bySession = new Map(regs.map((r) => [r.sessionId, r._count]));
  const byGroup = new Map(groups.map((g) => [g.groupId, g._count]));
  return new Map(ms.map((m) => [m.id, (m.sessionId ? bySession.get(m.sessionId) : m.groupId ? byGroup.get(m.groupId) : 0) ?? 0]));
}

export async function matchControl(m: MatchWithOwner, now = new Date()): Promise<StudioMatchControl> {
  return controlOf(m, (await teamCounts([m])).get(m.id) ?? 0, now);
}

export function storedTeams(v: Prisma.JsonValue | null): LiveTeams {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: LiveTeams = {};
  for (const [teamId, players] of Object.entries(v)) {
    if (!Array.isArray(players)) continue;
    out[teamId] = players.map((p) => (typeof p === "string" ? { state: p as LivePlayerState } : (p as unknown as StoredPlayer)));
  }
  return out;
}

/** Our own media paths → absolute URLs for the studio; external URLs (Google avatars) as they are. */
const absolute = (url: string | null) => (url ? (url.startsWith("/") ? `${publicUrl()}${url}` : url) : null);

type ResultRow = Prisma.MatchTeamGetPayload<{
  select: {
    teamId: true;
    placement: true;
    kills: true;
    totalPoints: true;
    players: { select: { name: true; kills: true; user: { select: { avatarUrl: true; avatarKey: true } } } };
  };
}>;

/** The match's results rows by team id (lineup / live figures / results). */
async function resultRows(matchId: string): Promise<Map<string, ResultRow>> {
  const rows = await prisma.matchTeam.findMany({
    where: { matchId, teamId: { not: null } },
    select: {
      teamId: true,
      placement: true,
      kills: true,
      totalPoints: true,
      players: { orderBy: { position: "asc" }, select: { name: true, kills: true, user: { select: { avatarUrl: true, avatarKey: true } } } },
    },
  });
  return new Map(rows.map((r) => [r.teamId!, r]));
}

/** A team's score: placement + kill points once placed, else kill points (or the manager's live total). */
function scoreOf(r: ResultRow | undefined, ps: PointsSystem): Omit<StudioLinkSummaryTeam, "slot" | "name" | "logo"> {
  const kills = r?.kills ?? 0;
  if (r?.placement != null) return { kills, placement: r.placement, ...matchPoints(ps, r.placement, kills) };
  const killPoints = kills * ps.killPoints;
  return { kills, placement: null, placementPoints: 0, killPoints, totalPoints: r?.totalPoints ?? killPoints };
}

/** The player with the most kills; ties go to the better-placed team. */
function mvpOf(teams: StudioLinkSummaryTeam[], slots: SlotTeam[], results: Map<string, ResultRow>): StudioLinkMvp | null {
  let best: { mvp: StudioLinkMvp; placement: number } | null = null;
  for (const { slotNumber, team } of slots) {
    const placement = teams.find((t) => t.slot === slotNumber)?.placement ?? Infinity;
    for (const p of results.get(team.id)?.players ?? []) {
      const kills = p.kills ?? 0;
      if (kills <= 0 || (best && (kills < best.mvp.kills || (kills === best.mvp.kills && placement >= best.placement)))) continue;
      const photo = p.user ? absolute(avatarOf(p.user)) : null;
      best = { mvp: { name: p.name, team: team.name, kills, ...(photo ? { photo } : {}) }, placement };
    }
  }
  return best?.mvp ?? null;
}

async function buildBody(m: MatchWithOwner): Promise<Body> {
  const state = liveState(m.status);
  const slots = await registeredTeams(m);
  const [names, results] = await Promise.all([playerNames(m.id, slots, prisma, state === "scheduled"), state === "scheduled" ? new Map<string, ResultRow>() : resultRows(m.id)]);
  const stored = state === "scheduled" ? {} : storedTeams(m.liveTeams);
  const ps = matchPointsSystem(m);
  const logos = new Map(slots.map(({ team }) => [team.id, absolute(brandingUrl(team.logoKey))]));

  const teams = slots.map(({ slotNumber, team }): StudioLinkLiveTeam => {
    const saved = stored[team.id] ?? [];
    const roster = names.get(team.id)!;
    // before the match every team shows a full squad, all alive
    const shown = state === "scheduled" ? [...roster, ...Array<null>(Math.max(0, LIVE_TEAM_SIZE - roster.length)).fill(null)] : roster;
    const players = shown.map((name, i) => {
      const p = saved[i];
      return { ...(name ? { name } : {}), state: p?.state ?? ("alive" as const), ...(p?.source ? { source: p.source } : {}), ...(p?.at ? { updatedAt: p.at } : {}) };
    });
    const logo = logos.get(team.id);
    const { kills, totalPoints } = scoreOf(results.get(team.id), ps);
    return {
      id: team.id,
      slot: slotNumber,
      name: team.name,
      ...(logo ? { logo } : {}),
      status: players.filter((p) => p.state === "alive").length,
      kills,
      totalPoints,
      players,
    };
  });

  let summary: StudioLinkSummary | undefined;
  let winner: StudioLinkWinner | undefined;
  if (state === "summary" || state === "finished") {
    const rows = slots.map(({ slotNumber, team }): StudioLinkSummaryTeam => {
      const logo = logos.get(team.id);
      return { slot: slotNumber, name: team.name, ...(logo ? { logo } : {}), ...scoreOf(results.get(team.id), ps) };
    });
    rows.sort((a, b) => b.totalPoints - a.totalPoints || b.kills - a.kills || (a.placement ?? Infinity) - (b.placement ?? Infinity) || a.slot - b.slot);
    summary = { teams: rows, mvp: mvpOf(rows, slots, results) };
    const top = state === "finished" ? (rows.find((r) => r.placement === 1) ?? rows[0]) : undefined;
    const topTeam = top && slots.find((s) => s.slotNumber === top.slot)!.team;
    if (top && topTeam) {
      winner = {
        slot: top.slot,
        name: top.name,
        ...(top.logo ? { logo: top.logo } : {}),
        kills: top.kills,
        totalPoints: top.totalPoints,
        players: (results.get(topTeam.id)?.players ?? []).map((p) => {
          const photo = p.user ? absolute(avatarOf(p.user)) : null;
          return { name: p.name, kills: p.kills ?? 0, ...(photo ? { photo } : {}) };
        }),
      };
    }
  }

  return {
    // in the hashed body: a locked match unlocking (or a team joining) bumps the version
    control: controlOf(m, slots.length),
    match: {
      id: m.id,
      title: matchTitle(m),
      state,
      startsAt: matchContext(m).startsAt?.toISOString() ?? null,
      liveAt: m.liveAt?.toISOString() ?? null,
      round: m.group?.stage.name ?? null,
      matchNumber: m.number,
      map: MAP_LABELS[m.map as GameMap] ?? m.map,
    },
    teams,
    ...(summary ? { summary } : {}),
    ...(winner ? { winner } : {}),
  };
}

const hashOf = (b: Body) => createHash("sha256").update(JSON.stringify(b)).digest("base64url");

const PROCESSED: LiveCaptureStatus[] = ["APPLIED", "SKIPPED"];

async function autoCapture(m: { id: string; liveAutoPaused: boolean }, imagePrefix: string | null, now = Date.now()): Promise<LiveAutoCapture> {
  const [last, applied, processed] = await Promise.all([
    prisma.liveCapture.findFirst({ where: { matchId: m.id }, orderBy: { createdAt: "desc" }, select: { id: true, createdAt: true } }),
    prisma.liveCapture.findFirst({ where: { matchId: m.id, status: "APPLIED" }, orderBy: { processedAt: "desc" }, select: { processedAt: true } }),
    // the newest capture that was read (or failed): a reader failure or "not a game screen" shows as the last error
    prisma.liveCapture.findFirst({
      where: { matchId: m.id, OR: [{ status: "FAILED" }, { status: { in: PROCESSED }, detected: { not: null } }] },
      orderBy: { processedAt: "desc" },
      select: { status: true, error: true, detected: true, message: true },
    }),
  ]);
  const lastDetected = (processed?.detected as LiveAutoCapture["lastDetected"] | undefined) ?? null;
  return {
    active: !!last && now - last.createdAt.getTime() < LIVE_CAPTURE_ACTIVE_MS,
    paused: m.liveAutoPaused,
    lastCaptureAt: last?.createdAt.toISOString() ?? null,
    lastAppliedAt: applied?.processedAt?.toISOString() ?? null,
    lastDetected,
    lastError: processed?.status === "FAILED" ? processed.error : processed?.detected === "other" ? processed.message : null,
    ...(imagePrefix ? { latestImageUrl: last ? `${imagePrefix}/matches/${m.id}/captures/${last.id}/image` : null } : {}),
  };
}

/** The board payload, bumping liveVersion when it changed since the last stamp. `imagePrefix` = Match Center caller. */
async function stamped(matchId: string, imagePrefix: string | null = null): Promise<StudioLinkLive> {
  for (let i = 0; i < STAMP_TRIES; i++) {
    const m = await prisma.match.findUniqueOrThrow({ where: { id: matchId }, include: ownerInclude });
    const body = await buildBody(m);
    const hash = hashOf(body);
    let stamp: { version: number; updatedAt: Date } | null = null;
    if (hash === m.liveHash && m.liveUpdatedAt) stamp = { version: m.liveVersion, updatedAt: m.liveUpdatedAt };
    else {
      const now = new Date();
      // optimistic: only the caller that still sees the old version bumps it; the others rebuild
      const { count } = await prisma.match.updateMany({
        where: { id: matchId, liveVersion: m.liveVersion },
        data: { liveVersion: { increment: 1 }, liveHash: hash, liveUpdatedAt: now },
      });
      if (count === 1) stamp = { version: m.liveVersion + 1, updatedAt: now };
    }
    if (stamp) return { version: stamp.version, updatedAt: stamp.updatedAt.toISOString(), autoCapture: await autoCapture(m, imagePrefix), ...body };
  }
  throw conflict("The match is changing quickly. Try again.");
}

/** Studio link: the match, if this studio's manager owns it. 404 = no such match, 403 = another manager's. */
export async function studioMatch(matchId: string, managerId: string): Promise<MatchWithOwner> {
  const m = await prisma.match.findUnique({ where: { id: matchId }, include: ownerInclude });
  if (!m) throw notFound("Match not found");
  if (ownerManagerId(m) !== managerId) throw forbidden("This match isn't on the AirBattleground account this studio is connected to.");
  return m;
}

/** Studio link: the board for a match. */
export async function boardForStudio(matchId: string, managerId: string): Promise<StudioLinkLive> {
  await studioMatch(matchId, managerId);
  return stamped(matchId);
}

const imagePrefix = (bypass: boolean) => (bypass ? "/api/admin" : "/api/manager");

/** Match Center: the board for an own match (`bypass` = admin), with the latest capture's image link. */
export async function getLive(matchId: string, managerId: string, bypass = false): Promise<StudioLinkLive> {
  await loadOwnMatch(matchId, managerId, bypass);
  return stamped(matchId, imagePrefix(bypass));
}

/**
 * Match Center: set one team's player states and/or its kills and total points (only while the match is live).
 * Changed players lock against auto. Kills / points go on the team's results row, which the results later overwrite.
 */
export async function saveLiveTeam(matchId: string, managerId: string, input: SaveLiveTeamInput, bypass = false): Promise<StudioLinkLive> {
  const m = await loadOwnMatch(matchId, managerId, bypass);
  if (m.status !== "LIVE") {
    throw conflict(
      lineupPending(m.status) ? "Confirm the team list first — that starts the match." : "This match has ended. Live status can't be changed any more.",
    );
  }
  const slot = (await registeredTeams(m)).find((s) => s.team.id === input.teamId);
  if (!slot) throw notFound("That team isn't in this match");

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Match" WHERE id = ${matchId} FOR UPDATE`;
    if (input.players) {
      const row = await tx.match.findUniqueOrThrow({ where: { id: matchId }, select: { liveTeams: true } });
      const teams = storedTeams(row.liveTeams);
      const at = new Date().toISOString();
      const cur = teams[input.teamId] ?? [];
      teams[input.teamId] = input.players.map((state, i) => (cur[i]?.state === state ? cur[i]! : { state, source: "manager", at }));
      await tx.match.update({ where: { id: matchId }, data: { liveTeams: teams as unknown as Prisma.InputJsonValue } });
    }
    if (input.kills !== undefined || input.totalPoints !== undefined) {
      const score = { kills: input.kills, totalPoints: input.totalPoints };
      await tx.matchTeam.upsert({
        where: { matchId_slotNumber: { matchId, slotNumber: slot.slotNumber } },
        create: { matchId, slotNumber: slot.slotNumber, teamId: input.teamId, ...score },
        update: score,
      });
    }
  });
  return stamped(matchId, imagePrefix(bypass));
}

/** Match Center: pause / resume auto capture updates. */
export async function setAutoPaused(matchId: string, managerId: string, paused: boolean, bypass = false): Promise<StudioLinkLive> {
  await loadOwnMatch(matchId, managerId, bypass);
  await prisma.match.update({ where: { id: matchId }, data: { liveAutoPaused: paused } });
  return stamped(matchId, imagePrefix(bypass));
}

// ---------------------------------------------------------------- auto capture → live status

/** One team as read from a capture: identity + its players' states as shown (bars; usually no names). */
export interface LiveReadTeam {
  slot: number | null;
  name: string | null;
  players: LivePlayerState[];
  confidence: number;
}

const lockedByManager = (p: StoredPlayer, now: number) => p.source === "manager" && !!p.at && now - Date.parse(p.at) < LIVE_MANAGER_LOCK_MS;

/**
 * Move a team's stored players towards the counts read from a capture (the HUD shows bars, not names, so only counts
 * are known). Skips manager-locked players; never revives an eliminated player. Knocks/eliminations land on the last
 * players first; knocked players are eliminated before alive ones. Returns the new players and how many changed.
 */
export function reconcileTeam(current: StoredPlayer[], size: number, read: LivePlayerState[], now: Date): { players: StoredPlayer[]; changed: number } {
  const t = now.getTime();
  const at = now.toISOString();
  const players = Array.from({ length: size }, (_, i): StoredPlayer => ({ ...(current[i] ?? { state: "alive" }) }));
  const want = (s: LivePlayerState) => read.filter((x) => x === s).length;
  const have = (s: LivePlayerState) => players.filter((p) => p.state === s).length;
  const free = (s: LivePlayerState) => players.filter((p) => p.state === s && !lockedByManager(p, t));
  let changed = 0;
  const set = (p: StoredPlayer, state: LivePlayerState) => {
    Object.assign(p, { state, source: "auto", at });
    changed++;
  };

  let out = want("eliminated") - have("eliminated");
  for (const p of [...free("knocked").reverse(), ...free("alive").reverse()]) if (out-- > 0) set(p, "eliminated");

  const knocks = want("knocked") - have("knocked");
  if (knocks > 0) free("alive").reverse().slice(0, knocks).forEach((p) => set(p, "knocked"));
  if (knocks < 0) free("knocked").slice(0, -knocks).forEach((p) => set(p, "alive"));
  return { players, changed };
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

/** A read team → registered team: by slot first, then by name or tag (case/symbol-insensitive, one clear match). */
export function matchReadTeam(read: Pick<LiveReadTeam, "slot" | "name">, slots: SlotTeam[]): SlotTeam | null {
  if (read.slot != null) {
    const bySlot = slots.find((s) => s.slotNumber === read.slot);
    if (bySlot) return bySlot;
  }
  const n = read.name ? norm(read.name) : "";
  if (n.length < 2) return null;
  const exact = slots.filter((s) => norm(s.team.name) === n || norm(s.team.tag) === n);
  if (exact.length === 1) return exact[0]!;
  if (n.length < 3) return null;
  const loose = slots.filter((s) => {
    const name = norm(s.team.name);
    return name.length >= 3 && (name.includes(n) || n.includes(name));
  });
  return loose.length === 1 ? loose[0]! : null;
}

export type ApplyOutcome =
  | { status: "APPLIED"; changes: number; skipped: string[] }
  | { status: "SKIPPED"; reason: string };

/** Apply one read capture in a single transaction; bumps the board version when anything changed. */
export async function applyCapture(matchId: string, capturedAt: Date, teams: LiveReadTeam[], now = new Date()): Promise<ApplyOutcome> {
  const outcome = await prisma.$transaction(async (tx): Promise<ApplyOutcome> => {
    await tx.$queryRaw`SELECT id FROM "Match" WHERE id = ${matchId} FOR UPDATE`;
    const m = await tx.match.findUniqueOrThrow({ where: { id: matchId } });
    if (m.status !== "LIVE") return { status: "SKIPPED", reason: "match not live" };
    if (m.liveAutoPaused) return { status: "SKIPPED", reason: "auto updates paused" };
    if (m.liveAutoAt && m.liveAutoAt >= capturedAt) return { status: "SKIPPED", reason: "a newer capture was already applied" };

    const slots = await registeredTeams(m, tx);
    const names = await playerNames(matchId, slots, tx, false);
    const stored = storedTeams(m.liveTeams);
    const skipped: string[] = [];
    let changes = 0;
    const done = new Set<string>();
    for (const r of teams) {
      const label = r.name ?? (r.slot != null ? `slot ${r.slot}` : "unnamed team");
      if (r.confidence < LIVE_MIN_CONFIDENCE) {
        skipped.push(`${label}: low confidence (${r.confidence})`);
        continue;
      }
      const hit = matchReadTeam(r, slots);
      if (!hit || done.has(hit.team.id)) {
        skipped.push(`${label}: ${hit ? "read twice" : "no registered team matches"}`);
        continue;
      }
      done.add(hit.team.id);
      const res = reconcileTeam(stored[hit.team.id] ?? [], names.get(hit.team.id)!.length, r.players, now);
      if (res.changed) stored[hit.team.id] = res.players;
      changes += res.changed;
    }
    await tx.match.update({
      where: { id: matchId },
      data: { liveAutoAt: capturedAt, ...(changes ? { liveTeams: stored as unknown as Prisma.InputJsonValue } : {}) },
    });
    return { status: "APPLIED", changes, skipped };
  });
  if (outcome.status === "APPLIED" && outcome.changes) await stamped(matchId);
  return outcome;
}
