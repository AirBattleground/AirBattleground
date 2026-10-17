/** Team-facing results (phase 2): sessions played, standings, match scorecards, roster. */
import {
  MAX_ROSTER_PLAYERS,
  todayInAppTz,
  type GameMap,
  type MatchScorecard,
  type SaveRosterInput,
  type SessionStandings,
  type TeamResultsSummary,
  type TeamRoster,
  type TeamSessionResult,
} from "@7xen/shared";
import { prisma } from "../db.js";
import { AppError, forbidden, notFound } from "../lib/errors.js";
import { dateToStr, strToDate, toTeamSummary } from "../lib/serialize.js";
import { standingsForSession } from "./standings.js";

const NOT_PLAYED = "Your team didn't play in this scrim";

async function assertPlayed(teamId: string, sessionId: string) {
  const reg = await prisma.registration.findUnique({ where: { sessionId_teamId: { sessionId, teamId } }, select: { status: true } });
  if (reg?.status !== "APPROVED") throw forbidden(NOT_PLAYED);
}

/** Sessions with ≥1 published match the team played, newest first. */
export async function teamResults(teamId: string): Promise<TeamSessionResult[]> {
  const sessions = await prisma.scrimSession.findMany({
    where: { matches: { some: { status: "PUBLISHED", teams: { some: { teamId } } } } },
    select: { id: true, date: true, scrim: { select: { id: true, title: true, maps: true } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
  const out: TeamSessionResult[] = [];
  for (const s of sessions) {
    const st = await standingsForSession(s.id);
    const row = st.rows.find((r) => r.team.id === teamId);
    if (!row) continue;
    out.push({
      scrim: { id: s.scrim.id, title: s.scrim.title },
      date: dateToStr(s.date),
      slotNumber: row.slotNumber,
      rank: row.rank,
      teamsCount: st.rows.length,
      totalPoints: row.totalPoints,
      kills: row.kills,
      wins: row.wins,
      matchesPublished: st.matches.filter((m) => m.status === "PUBLISHED").length,
      matchesTotal: Math.max(st.matches.length, s.scrim.maps.length),
    });
  }
  return out;
}

export async function teamResultsSummary(teamId: string): Promise<TeamResultsSummary | null> {
  const results = await teamResults(teamId);
  if (!results.length) return null;
  const played = await prisma.matchTeam.findMany({
    where: { teamId, placement: { not: null }, match: { status: "PUBLISHED" } },
    select: { placement: true, kills: true },
  });
  return {
    sessionsPlayed: results.length,
    matchesPlayed: played.length,
    totalKills: played.reduce((s, p) => s + (p.kills ?? 0), 0),
    wins: played.filter((p) => p.placement === 1).length,
    bestRank: Math.min(...results.map((r) => r.rank)),
    latest: results[0] ?? null,
  };
}

export async function teamSessionStandings(teamId: string, scrimId: string, date: string): Promise<SessionStandings> {
  const session = await prisma.scrimSession.findUnique({ where: { scrimId_date: { scrimId, date: strToDate(date) } }, select: { id: true } });
  if (!session) throw forbidden(NOT_PLAYED);
  await assertPlayed(teamId, session.id);
  return standingsForSession(session.id);
}

export async function teamMatchScorecard(teamId: string, matchId: string): Promise<MatchScorecard> {
  const m = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      session: { select: { id: true, date: true, scrim: { select: { id: true, title: true } } } },
      group: {
        select: {
          id: true,
          name: true,
          startsAt: true,
          stage: { select: { id: true, name: true, tournament: { select: { id: true, title: true, status: true } } } },
        },
      },
      teams: {
        where: { teamId: { not: null }, placement: { not: null } },
        orderBy: { placement: "asc" },
        include: { team: { select: { id: true, name: true, tag: true } }, players: { orderBy: { position: "asc" } } },
      },
    },
  });
  if (!m || m.status !== "PUBLISHED" || !m.publishedAt) throw notFound("Results for this match aren't published yet");
  let header: Pick<MatchScorecard, "scrim" | "date" | "tournament">;
  if (m.session) {
    await assertPlayed(teamId, m.session.id);
    header = { scrim: m.session.scrim, date: dateToStr(m.session.date), tournament: null };
  } else if (m.group && m.group.stage.tournament.status !== "DRAFT") {
    // published tournament matches are public to every team
    const g = m.group;
    const t = g.stage.tournament;
    header = {
      scrim: { id: t.id, title: `${t.title} · ${g.stage.name} · Group ${g.name}` },
      date: todayInAppTz(m.scheduledAt ?? g.startsAt ?? m.publishedAt),
      tournament: { id: t.id, title: t.title, stageId: g.stage.id, stageName: g.stage.name, groupId: g.id, groupName: g.name },
    };
  } else {
    throw notFound("Results for this match aren't published yet");
  }
  return {
    match: { id: m.id, number: m.number, map: m.map as GameMap, publishedAt: m.publishedAt.toISOString() },
    ...header,
    teams: m.teams.map((t) => ({
      rank: t.placement!,
      slotNumber: t.slotNumber,
      team: toTeamSummary(t.team!),
      players: t.players.map((p) => ({ name: p.name, kills: p.kills })),
      kills: t.kills ?? 0,
      placementPoints: t.placementPoints ?? 0,
      killPoints: t.killPoints ?? 0,
      totalPoints: t.totalPoints ?? 0,
    })),
  };
}

// ---------------------------------------------------------------- roster

export async function getRoster(teamId: string): Promise<TeamRoster> {
  const [players, seen] = await Promise.all([
    prisma.teamPlayer.findMany({ where: { teamId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
    prisma.matchPlayer.findMany({
      where: { matchTeam: { teamId, match: { status: { in: ["LIVE", "RESULTS_REVIEW", "PUBLISHED"] } } } },
      select: { name: true },
      distinct: ["name"],
      take: 200,
    }),
  ]);
  const onRoster = new Set(players.map((p) => p.ign.trim().toLowerCase()));
  const suggestions: string[] = [];
  const added = new Set<string>();
  for (const { name } of seen) {
    const k = name.trim().toLowerCase();
    if (!k || onRoster.has(k) || added.has(k)) continue;
    added.add(k);
    suggestions.push(name.trim());
  }
  return {
    players: players.map((p) => ({ id: p.id, ign: p.ign, bgmiId: p.bgmiId })),
    suggestions: suggestions.sort((a, b) => a.localeCompare(b)).slice(0, 20),
  };
}

export async function saveRoster(teamId: string, input: SaveRosterInput): Promise<TeamRoster> {
  const players = input.players.slice(0, MAX_ROSTER_PLAYERS);
  const fields: Record<string, string> = {};
  const seen = new Set<string>();
  players.forEach((p, i) => {
    const k = p.ign.toLowerCase();
    if (seen.has(k)) fields[`players.${i}.ign`] = "This player is listed twice";
    seen.add(k);
  });
  if (Object.keys(fields).length) throw new AppError("VALIDATION_ERROR", "Each player can only be listed once", fields);
  await prisma.$transaction([
    prisma.teamPlayer.deleteMany({ where: { teamId } }),
    prisma.teamPlayer.createMany({
      data: players.map((p, i) => ({ teamId, ign: p.ign, bgmiId: p.bgmiId ?? null, position: i + 1 })),
    }),
  ]);
  return getRoster(teamId);
}
