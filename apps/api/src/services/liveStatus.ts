/**
 * Live team status (shared/studioLink.ts): which players of each registered team are alive, knocked or eliminated,
 * marked by the manager on the Match Center screen or read from 7XEN Studio auto captures, and polled by the studio's
 * Team Status board.
 *
 * Rows = the teams registered on the match (approved registrations / group teams), so a team added mid-match shows up
 * on the next poll. Players = the confirmed lineup (first 4 by position), else the team's roster; a player with no
 * stored state is alive. Before the lineup is confirmed every player is alive.
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
  type GameMap,
  type LiveAutoCapture,
  type LivePlayerState,
  type LiveStateSource,
  type MatchStatus,
  type SaveLiveTeamInput,
  type StudioLinkLive,
  type StudioLinkLiveState,
  type StudioLinkLiveTeam,
} from "@7xen/shared";
import { prisma, type Tx } from "../db.js";
import { conflict, forbidden, notFound } from "../lib/errors.js";
import { brandingUrl } from "../lib/serialize.js";
import { loadOwnMatch, ownerInclude, ownerManagerId, type MatchWithOwner } from "./matches.js";
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
  if (s === "RESULTS_REVIEW" || s === "PUBLISHED") return "finished";
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

/** Board player names per team id: the confirmed lineup (first 4 by position), else the roster (null = no IGN). */
export async function playerNames(matchId: string, slots: SlotTeam[], db: Tx = prisma): Promise<Map<string, (string | null)[]>> {
  const lineup = await db.matchTeam.findMany({
    where: { matchId, teamId: { not: null } },
    select: { teamId: true, players: { orderBy: { position: "asc" }, take: LIVE_TEAM_SIZE, select: { name: true } } },
  });
  const fromLineup = new Map(lineup.filter((t) => t.players.length).map((t) => [t.teamId!, t.players.map((p) => p.name)]));
  return new Map(slots.map(({ team }) => [team.id, fromLineup.get(team.id) ?? team.members.slice(0, LIVE_TEAM_SIZE).map((x) => x.user.ign)]));
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

async function buildBody(m: MatchWithOwner): Promise<Body> {
  const state = liveState(m.status);
  const slots = await registeredTeams(m);
  const names = await playerNames(m.id, slots);
  const stored = state === "scheduled" ? {} : storedTeams(m.liveTeams);

  const teams = slots.map(({ slotNumber, team }): StudioLinkLiveTeam => {
    const saved = stored[team.id] ?? [];
    const players = names.get(team.id)!.map((name, i) => {
      const p = saved[i];
      return { ...(name ? { name } : {}), state: p?.state ?? ("alive" as const), ...(p?.source ? { source: p.source } : {}), ...(p?.at ? { updatedAt: p.at } : {}) };
    });
    const logo = brandingUrl(team.logoKey);
    return {
      id: team.id,
      slot: slotNumber,
      name: team.name,
      ...(logo ? { logo: `${publicUrl()}${logo}` } : {}),
      status: players.filter((p) => p.state === "alive").length,
      players,
    };
  });
  return { match: { id: m.id, title: matchTitle(m), state, map: MAP_LABELS[m.map as GameMap] ?? m.map }, teams };
}

const hashOf = (b: Body) => createHash("sha256").update(JSON.stringify(b)).digest("base64url");

const PROCESSED: LiveCaptureStatus[] = ["APPLIED", "FAILED"];

async function autoCapture(m: { id: string; liveAutoPaused: boolean }, imagePrefix: string | null, now = Date.now()): Promise<LiveAutoCapture> {
  const [last, applied, processed] = await Promise.all([
    prisma.liveCapture.findFirst({ where: { matchId: m.id }, orderBy: { createdAt: "desc" }, select: { id: true, createdAt: true } }),
    prisma.liveCapture.findFirst({ where: { matchId: m.id, status: "APPLIED" }, orderBy: { processedAt: "desc" }, select: { processedAt: true } }),
    prisma.liveCapture.findFirst({ where: { matchId: m.id, status: { in: PROCESSED } }, orderBy: { processedAt: "desc" }, select: { status: true, error: true } }),
  ]);
  return {
    active: !!last && now - last.createdAt.getTime() < LIVE_CAPTURE_ACTIVE_MS,
    paused: m.liveAutoPaused,
    lastCaptureAt: last?.createdAt.toISOString() ?? null,
    lastAppliedAt: applied?.processedAt?.toISOString() ?? null,
    lastError: processed?.status === "FAILED" ? processed.error : null,
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

/** Match Center: set one team's player states (only while the match is live). Changed players lock against auto. */
export async function saveLiveTeam(matchId: string, managerId: string, input: SaveLiveTeamInput, bypass = false): Promise<StudioLinkLive> {
  const m = await loadOwnMatch(matchId, managerId, bypass);
  if (m.status !== "LIVE") {
    throw conflict(
      lineupPending(m.status) ? "Confirm the team list first — that starts the match." : "This match has ended. Live status can't be changed any more.",
    );
  }
  if (!(await registeredTeams(m)).some((s) => s.team.id === input.teamId)) throw notFound("That team isn't in this match");

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Match" WHERE id = ${matchId} FOR UPDATE`;
    const row = await tx.match.findUniqueOrThrow({ where: { id: matchId }, select: { liveTeams: true } });
    const teams = storedTeams(row.liveTeams);
    const at = new Date().toISOString();
    const cur = teams[input.teamId] ?? [];
    teams[input.teamId] = input.players.map((state, i) => (cur[i]?.state === state ? cur[i]! : { state, source: "manager", at }));
    await tx.match.update({ where: { id: matchId }, data: { liveTeams: teams as unknown as Prisma.InputJsonValue } });
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
    const names = await playerNames(matchId, slots, tx);
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
