/**
 * Phase 6b: everything the broadcast overlay shows, for one match (or sample data for the layout editor).
 * Cached per match for a few seconds — the compositor re-renders the overlay every second.
 */
import { computeStandings, MAP_LABELS, type GameMap, type TeamMatchResult } from "@7xen/shared";
import { prisma } from "../../db.js";
import { pointsSystemOf } from "../../lib/serialize.js";
import { resolveKey } from "../../lib/storage.js";
import { matchContext } from "../matchContext.js";
import { ownerInclude } from "../matches.js";

export interface OverlayTeam {
  slot: number;
  name: string;
  tag: string | null;
  /** absolute path of the team logo, if any */
  logoPath: string | null;
}

export interface OverlayStanding {
  rank: number;
  name: string;
  tag: string | null;
  points: number;
  kills: number;
  wins: number;
}

export interface OverlayData {
  title: string;
  subtitle: string;
  matchNumber: number | null;
  map: GameMap | null;
  mapLabel: string | null;
  orgName: string | null;
  orgLogoPath: string | null;
  teams: OverlayTeam[];
  standings: OverlayStanding[];
  /** "after Match 2" — what the points table covers */
  standingsNote: string | null;
}

const CACHE_MS = 5_000;
const cache = new Map<string, { at: number; data: OverlayData }>();

async function managerBrand(managerId: string | null) {
  if (!managerId) return { orgName: null, orgLogoPath: null };
  const u = await prisma.user.findUnique({ where: { id: managerId }, select: { orgName: true, displayName: true, orgLogoKey: true } });
  return { orgName: u?.orgName ?? u?.displayName ?? null, orgLogoPath: u?.orgLogoKey ? safeResolve(u.orgLogoKey) : null };
}

function safeResolve(key: string): string | null {
  try {
    return resolveKey(key);
  } catch {
    return null;
  }
}

const teamSelect = { id: true, name: true, tag: true, logoKey: true } as const;

/** Overlay data for a match the manager owns (ownership is checked by the caller). */
export async function overlayDataForMatch(matchId: string, managerId: string): Promise<OverlayData> {
  const hit = cache.get(matchId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const m = await prisma.match.findUniqueOrThrow({ where: { id: matchId }, include: ownerInclude });
  const ctx = matchContext(m);
  const ps = pointsSystemOf(m.session?.scrim.pointsSystem ?? m.group?.stage.tournament.pointsSystem);

  // line-up: approved registrations (scrim) or group teams (tournament)
  const slots = m.sessionId
    ? (
        await prisma.registration.findMany({
          where: { sessionId: m.sessionId, status: "APPROVED", slotNumber: { not: null } },
          select: { slotNumber: true, team: { select: teamSelect } },
          orderBy: { slotNumber: "asc" },
        })
      ).map((r) => ({ slot: r.slotNumber!, team: r.team }))
    : m.groupId
      ? (await prisma.groupTeam.findMany({ where: { groupId: m.groupId }, select: { slotNumber: true, team: { select: teamSelect } }, orderBy: { slotNumber: "asc" } })).map((g) => ({
          slot: g.slotNumber,
          team: g.team,
        }))
      : [];

  // points table: published matches of the same session / group
  const published = await prisma.match.findMany({
    where: { status: "PUBLISHED", ...(m.sessionId ? { sessionId: m.sessionId } : { groupId: m.groupId }) },
    select: { number: true, teams: { select: { teamId: true, placement: true, kills: true } } },
    orderBy: { number: "asc" },
  });
  const results: TeamMatchResult[] = published.flatMap((pm) =>
    pm.teams.flatMap((t) => (t.teamId && t.placement != null ? [{ teamId: t.teamId, matchNumber: pm.number, placement: t.placement, kills: t.kills ?? 0 }] : [])),
  );
  const rows = computeStandings(ps, results);
  const teamIds = [...new Set(rows.map((r) => r.teamId))];
  const teamsById = new Map((await prisma.team.findMany({ where: { id: { in: teamIds } }, select: teamSelect })).map((t) => [t.id, t]));

  const data: OverlayData = {
    title: ctx.title,
    subtitle: ctx.subtitle,
    matchNumber: m.number,
    map: m.map as GameMap,
    mapLabel: MAP_LABELS[m.map as GameMap] ?? m.map,
    ...(await managerBrand(managerId)),
    teams: slots.map((s) => ({ slot: s.slot, name: s.team.name, tag: s.team.tag, logoPath: s.team.logoKey ? safeResolve(s.team.logoKey) : null })),
    standings: rows.map((r) => {
      const t = teamsById.get(r.teamId);
      return { rank: r.rank, name: t?.name ?? "—", tag: t?.tag ?? null, points: r.totalPoints, kills: r.kills, wins: r.wins };
    }),
    standingsNote: published.length ? `After match ${published[published.length - 1]!.number}` : null,
  };
  cache.set(matchId, { at: Date.now(), data });
  if (cache.size > 200) cache.clear();
  return data;
}

const SAMPLE_TEAMS = ["Team Soul", "GodLike Esports", "Orangutan", "Team XSpark", "Revenant Esports", "Blind Esports", "Global Esports", "Medal Esports", "Team Insane", "Enigma Gaming", "Big Brother", "8Bit", "Gods Reign", "True Rippers", "Hyderabad Hydras", "Team Tamilas"];

/** Realistic placeholder data so the layout editor looks right before a match is picked. */
export async function sampleOverlayData(managerId: string): Promise<OverlayData> {
  const brand = await managerBrand(managerId);
  return {
    title: "Evening Scrims",
    subtitle: "Sample · Match 3",
    matchNumber: 3,
    map: "ERANGEL" as GameMap,
    mapLabel: MAP_LABELS["ERANGEL" as GameMap] ?? "Erangel",
    ...brand,
    teams: SAMPLE_TEAMS.map((name, i) => ({ slot: i + 3, name, tag: name.split(" ")[0]!.slice(0, 4).toUpperCase(), logoPath: null })),
    standings: SAMPLE_TEAMS.slice(0, 16).map((name, i) => ({ rank: i + 1, name, tag: null, points: 78 - i * 4 - (i % 3), kills: 30 - i * 2, wins: i < 2 ? 1 : 0 })),
    standingsNote: "After match 2",
  };
}
