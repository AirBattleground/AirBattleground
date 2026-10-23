/**
 * Live team status (shared/studioLink.ts): which players of each registered team are alive, knocked or eliminated,
 * marked by the manager on the Match Center screen and polled by 7XEN Studio's Team Status board.
 *
 * Rows = the teams registered on the match (approved registrations / group teams), so a team added mid-match shows up
 * on the next poll. Players = the confirmed lineup (first 4 by position), else the team's roster; a player with no
 * stored state is alive. Before the lineup is confirmed every player is alive.
 * The payload is hashed: when the hash changes, liveVersion is bumped — the board's `version` and ETag.
 */
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  LIVE_TEAM_SIZE,
  MAP_LABELS,
  type GameMap,
  type LivePlayerState,
  type MatchStatus,
  type SaveLiveTeamInput,
  type StudioLinkLive,
  type StudioLinkLiveState,
  type StudioLinkLiveTeam,
} from "@7xen/shared";
import { prisma } from "../db.js";
import { conflict, notFound } from "../lib/errors.js";
import { brandingUrl } from "../lib/serialize.js";
import { loadOwnMatch, ownerInclude, type MatchWithOwner } from "./matches.js";
import { publicUrl } from "./youtube.js";

type LiveTeams = Record<string, LivePlayerState[]>;
type Body = Omit<StudioLinkLive, "version" | "updatedAt">;

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
  logoKey: true,
  members: { orderBy: [{ role: "asc" as const }, { joinedAt: "asc" as const }], select: { user: { select: { ign: true } } } },
} satisfies Prisma.TeamSelect;
type SlotTeam = { slotNumber: number; team: Prisma.TeamGetPayload<{ select: typeof teamSelect }> };

/** Registered teams by slot: the session's APPROVED registrations, or the group's teams. */
async function registeredTeams(m: MatchWithOwner): Promise<SlotTeam[]> {
  if (m.sessionId) {
    const regs = await prisma.registration.findMany({
      where: { sessionId: m.sessionId, status: "APPROVED", slotNumber: { not: null } },
      select: { slotNumber: true, team: { select: teamSelect } },
      orderBy: { slotNumber: "asc" },
    });
    return regs.map((r) => ({ slotNumber: r.slotNumber!, team: r.team }));
  }
  if (m.groupId) {
    return prisma.groupTeam.findMany({ where: { groupId: m.groupId }, select: { slotNumber: true, team: { select: teamSelect } }, orderBy: { slotNumber: "asc" } });
  }
  return [];
}

const storedTeams = (v: Prisma.JsonValue | null): LiveTeams => (v && typeof v === "object" && !Array.isArray(v) ? (v as unknown as LiveTeams) : {});

async function buildBody(m: MatchWithOwner): Promise<Body> {
  const state = liveState(m.status);
  const slots = await registeredTeams(m);
  const lineup = await prisma.matchTeam.findMany({
    where: { matchId: m.id, teamId: { not: null } },
    select: { teamId: true, players: { orderBy: { position: "asc" }, take: LIVE_TEAM_SIZE, select: { name: true } } },
  });
  const lineupNames = new Map(lineup.filter((t) => t.players.length).map((t) => [t.teamId!, t.players.map((p) => p.name)]));
  const stored = state === "scheduled" ? {} : storedTeams(m.liveTeams);

  const teams = slots.map(({ slotNumber, team }): StudioLinkLiveTeam => {
    const names: (string | null)[] = lineupNames.get(team.id) ?? team.members.slice(0, LIVE_TEAM_SIZE).map((x) => x.user.ign);
    const states = stored[team.id] ?? [];
    const players = names.map((name, i) => ({ ...(name ? { name } : {}), state: states[i] ?? ("alive" as const) }));
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

/** The board payload, bumping liveVersion when it changed since the last stamp. */
async function stamped(matchId: string): Promise<StudioLinkLive> {
  for (let i = 0; i < STAMP_TRIES; i++) {
    const m = await prisma.match.findUniqueOrThrow({ where: { id: matchId }, include: ownerInclude });
    const body = await buildBody(m);
    const hash = hashOf(body);
    if (hash === m.liveHash && m.liveUpdatedAt) return { version: m.liveVersion, updatedAt: m.liveUpdatedAt.toISOString(), ...body };
    const now = new Date();
    // optimistic: only the caller that still sees the old version bumps it; the others rebuild
    const { count } = await prisma.match.updateMany({
      where: { id: matchId, liveVersion: m.liveVersion },
      data: { liveVersion: { increment: 1 }, liveHash: hash, liveUpdatedAt: now },
    });
    if (count === 1) return { version: m.liveVersion + 1, updatedAt: now.toISOString(), ...body };
  }
  throw conflict("The match is changing quickly. Try again.");
}

/** Studio link: the board for a match. 404 = no such match; `null` = it belongs to another manager. */
export async function boardForStudio(matchId: string, managerId: string): Promise<StudioLinkLive | null> {
  const m = await prisma.match.findUnique({ where: { id: matchId }, include: ownerInclude });
  if (!m) throw notFound("Match not found");
  const owner = m.session?.scrim.managerId ?? m.group?.stage.tournament.managerId;
  if (owner !== managerId) return null;
  return stamped(matchId);
}

/** Match Center: the board for an own match (`bypass` = admin). */
export async function getLive(matchId: string, managerId: string, bypass = false): Promise<StudioLinkLive> {
  await loadOwnMatch(matchId, managerId, bypass);
  return stamped(matchId);
}

/** Match Center: set one team's player states (only while the match is live). */
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
    const teams = { ...storedTeams(row.liveTeams), [input.teamId]: input.players };
    await tx.match.update({ where: { id: matchId }, data: { liveTeams: teams } });
  });
  return stamped(matchId);
}
