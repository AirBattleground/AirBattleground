/**
 * Phase 4: match-day views for the manager app (today's matches, room details) and the team's room cards.
 * Works for scrim session matches and tournament group matches alike (ownership via services/matches.ts).
 */
import type { Prisma } from "@prisma/client";
import {
  addDays,
  sessionStartsAt,
  todayInAppTz,
  type GameMap,
  type LiveMatchCard,
  type MatchStatus,
  type RoomDetails,
  type SaveRoomInput,
  type TeamRoomCard,
} from "@7xen/shared";
import { prisma } from "../db.js";
import { iso, scrimInclude, strToDate } from "../lib/serialize.js";
import { ensureMatches, loadOwnMatch, ownerInclude } from "./matches.js";
import { ensureSession } from "./registrations.js";
import { mayOccurOnWhere, scrimOccursOn } from "./schedule.js";
import { capturesFor, recordingShotSelect, toRecordingRow } from "./recordings.js";
import { matchContext } from "./matchContext.js";

// ---------------------------------------------------------------- room

type RoomFields = { roomId: string | null; roomPassword: string | null; roomRevealAt: Date | null; roomUpdatedAt: Date | null; updatedAt: Date };

export function toRoomDetails(m: RoomFields): RoomDetails | null {
  if (!m.roomId || m.roomPassword == null) return null;
  return { roomId: m.roomId, password: m.roomPassword, revealAt: iso(m.roomRevealAt), updatedAt: (m.roomUpdatedAt ?? m.updatedAt).toISOString() };
}

/** Teams may see the room once revealAt has passed (null = immediately). */
export const roomRevealed = (m: RoomFields, now = new Date()) => !!m.roomId && (!m.roomRevealAt || m.roomRevealAt <= now);

export async function getRoom(matchId: string, managerId: string, bypass = false): Promise<RoomDetails | null> {
  return toRoomDetails(await loadOwnMatch(matchId, managerId, bypass));
}

export async function saveRoom(matchId: string, managerId: string, input: SaveRoomInput, bypass = false, now = new Date()): Promise<RoomDetails> {
  const m = await loadOwnMatch(matchId, managerId, bypass);
  const { startsAt } = matchContext(m);
  const revealAt = input.revealMinutesBefore == null || !startsAt ? null : new Date(startsAt.getTime() - input.revealMinutesBefore * 60_000);
  const row = await prisma.match.update({
    where: { id: matchId },
    data: { roomId: input.roomId, roomPassword: input.password, roomRevealAt: revealAt, roomUpdatedAt: now },
  });
  return toRoomDetails(row)!;
}

export async function deleteRoom(matchId: string, managerId: string, bypass = false): Promise<void> {
  await loadOwnMatch(matchId, managerId, bypass);
  await prisma.match.update({ where: { id: matchId }, data: { roomId: null, roomPassword: null, roomRevealAt: null, roomUpdatedAt: new Date() } });
}

// ---------------------------------------------------------------- manager: today

/** Start of `date` (IST) as an instant. */
const dayStart = (date: string) => sessionStartsAt(date, "00:00");

const liveInclude = {
  ...ownerInclude,
  recordings: { orderBy: { startedAt: "desc" }, take: 1 },
  screenshots: { select: recordingShotSelect },
} satisfies Prisma.MatchInclude;

/** The manager's scrim + tournament matches from today to today+days (IST), soonest first. */
export async function liveToday(managerId: string, days: number, now = new Date()): Promise<LiveMatchCard[]> {
  const first = todayInAppTz(now);
  const last = addDays(first, days);

  // make sure every scrim session in the window has its Match rows
  const scrims = await prisma.scrim.findMany({
    where: { managerId, status: { not: "ARCHIVED" }, startDate: { lte: strToDate(last) }, OR: mayOccurOnWhere(first).OR },
    include: scrimInclude,
  });
  for (let i = 0; i <= days; i++) {
    const date = addDays(first, i);
    for (const s of scrims) {
      if (!scrimOccursOn(s, date)) continue;
      const session = await ensureSession(s.id, date);
      await ensureMatches(session.id, s.maps);
    }
  }

  const from = dayStart(first);
  const to = dayStart(addDays(last, 1));
  const rows = await prisma.match.findMany({
    where: {
      OR: [
        { session: { scrim: { managerId }, date: { gte: strToDate(first), lte: strToDate(last) } } },
        {
          group: { stage: { tournament: { managerId, status: { notIn: ["DRAFT", "CANCELLED"] } } } },
          OR: [{ scheduledAt: { gte: from, lt: to } }, { scheduledAt: null, group: { startsAt: { gte: from, lt: to } } }],
        },
      ],
    },
    include: liveInclude,
  });

  const sessionIds = [...new Set(rows.map((m) => m.sessionId).filter((x): x is string => !!x))];
  const groupIds = [...new Set(rows.map((m) => m.groupId).filter((x): x is string => !!x))];
  const [approved, grouped] = await Promise.all([
    sessionIds.length
      ? prisma.registration.groupBy({ by: ["sessionId"], where: { sessionId: { in: sessionIds }, status: "APPROVED", slotNumber: { not: null } }, _count: { _all: true } })
      : [],
    groupIds.length
      ? prisma.groupTeam.groupBy({ by: ["groupId"], where: { groupId: { in: groupIds }, status: { not: "DISQUALIFIED" } }, _count: { _all: true } })
      : [],
  ]);
  const teamsBySession = new Map(approved.map((r) => [r.sessionId, r._count._all]));
  const teamsByGroup = new Map(grouped.map((r) => [r.groupId, r._count._all]));

  const cards = rows.map((m) => {
    const ctx = matchContext(m);
    const shots = m.screenshots;
    const rec = m.recordings[0];
    const card: LiveMatchCard = {
      matchId: m.id,
      kind: ctx.kind,
      title: ctx.title,
      subtitle: ctx.subtitle,
      number: m.number,
      map: m.map as GameMap,
      startsAt: iso(ctx.startsAt),
      status: m.status as MatchStatus,
      teamsCount: (m.sessionId ? teamsBySession.get(m.sessionId) : teamsByGroup.get(m.groupId!)) ?? 0,
      slotRange: ctx.slotRange,
      room: toRoomDetails(m),
      recording: rec ? toRecordingRow(rec, capturesFor(rec, shots)) : null,
      screenshotCounts: { slotList: shots.filter((s) => s.kind === "SLOT_LIST").length, results: shots.filter((s) => s.kind === "RESULTS").length },
    };
    return card;
  });
  return cards.sort((a, b) => (a.startsAt ?? "9999").localeCompare(b.startsAt ?? "9999") || a.title.localeCompare(b.title) || a.number - b.number);
}

// ---------------------------------------------------------------- team: rooms

/** Upcoming (unpublished, today or later) matches the team plays in; room only once revealed. */
export async function teamRooms(teamId: string, now = new Date()): Promise<TeamRoomCard[]> {
  const today = todayInAppTz(now);
  const from = dayStart(today);

  const regs = await prisma.registration.findMany({
    where: { teamId, status: "APPROVED", slotNumber: { not: null }, session: { date: { gte: strToDate(today) } } },
    include: { session: { include: { scrim: true } } },
  });
  for (const r of regs) await ensureMatches(r.sessionId, r.session.scrim.maps);
  const slotBySession = new Map(regs.map((r) => [r.sessionId, r.slotNumber]));

  const groupSlots = await prisma.groupTeam.findMany({ where: { teamId, status: { not: "DISQUALIFIED" } }, select: { groupId: true, slotNumber: true } });
  const slotByGroup = new Map(groupSlots.map((g) => [g.groupId, g.slotNumber]));

  const rows = await prisma.match.findMany({
    where: {
      status: { not: "PUBLISHED" },
      OR: [
        { sessionId: { in: [...slotBySession.keys()] } },
        {
          groupId: { in: [...slotByGroup.keys()] },
          group: { stage: { tournament: { status: { notIn: ["DRAFT", "CANCELLED"] } } } },
          OR: [{ scheduledAt: { gte: from } }, { scheduledAt: null }],
        },
      ],
    },
    include: ownerInclude,
  });

  return rows
    .map((m) => {
      const ctx = matchContext(m);
      const card: TeamRoomCard = {
        matchId: m.id,
        title: ctx.title,
        subtitle: ctx.subtitle,
        number: m.number,
        map: m.map as GameMap,
        startsAt: iso(ctx.startsAt),
        slotNumber: (m.sessionId ? slotBySession.get(m.sessionId) : slotByGroup.get(m.groupId!)) ?? null,
        room: roomRevealed(m, now) && m.roomPassword != null ? { roomId: m.roomId!, password: m.roomPassword } : null,
        revealAt: m.roomId ? iso(m.roomRevealAt) : null,
      };
      return card;
    })
    .filter((c) => !c.startsAt || c.startsAt >= from.toISOString())
    .sort((a, b) => (a.startsAt ?? "9999").localeCompare(b.startsAt ?? "9999") || a.number - b.number)
    .slice(0, 50);
}
