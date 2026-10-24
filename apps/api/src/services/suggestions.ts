/**
 * Phase 5 — "Ask my leader": a team member suggests a scrim (scrim + date) or a tournament to the leader.
 * One OPEN suggestion per team and target (creating again returns the existing one). The leader dismisses it,
 * or registering for the target marks it DONE.
 */
import type { Prisma } from "@prisma/client";
import type { CreateSuggestionInput, SuggestionStatus, TeamSuggestionRow } from "@7xen/shared";
import { prisma } from "../db.js";
import { AppError, conflict, notFound } from "../lib/errors.js";
import { brandingUrl, organizerName, organizerSelect, playerSummarySelect, strToDate, toPlayerSummary } from "../lib/serialize.js";
import { MSG, membershipOf, noTeam } from "./players.js";
import { closesAtOf, scrimOccursOn } from "./schedule.js";
import { scrimInclude } from "../lib/serialize.js";

const suggestionInclude = { fromUser: { select: playerSummarySelect } } satisfies Prisma.TeamSuggestionInclude;
type SuggestionWithFrom = Prisma.TeamSuggestionGetPayload<{ include: typeof suggestionInclude }>;

/** Rows → DTOs (scrims and tournaments are looked up in bulk; they have no FK on the suggestion). */
async function toRows(rows: SuggestionWithFrom[]): Promise<TeamSuggestionRow[]> {
  const scrimIds = [...new Set(rows.flatMap((r) => (r.scrimId ? [r.scrimId] : [])))];
  const tournamentIds = [...new Set(rows.flatMap((r) => (r.tournamentId ? [r.tournamentId] : [])))];
  const [scrims, tournaments] = await Promise.all([
    scrimIds.length
      ? prisma.scrim.findMany({ where: { id: { in: scrimIds } }, select: { id: true, title: true, startTime: true, posterKey: true, manager: { select: { displayName: true, orgName: true } } } })
      : [],
    tournamentIds.length
      ? prisma.tournament.findMany({ where: { id: { in: tournamentIds } }, select: { id: true, title: true, posterKey: true, manager: { select: { displayName: true, orgName: true } } } })
      : [],
  ]);
  const scrimById = new Map(scrims.map((s) => [s.id, s]));
  const tournamentById = new Map(tournaments.map((t) => [t.id, t]));
  return rows.map((r) => {
    const s = r.scrimId ? scrimById.get(r.scrimId) : undefined;
    const t = r.tournamentId ? tournamentById.get(r.tournamentId) : undefined;
    return {
      id: r.id,
      kind: r.kind,
      status: r.status,
      from: toPlayerSummary(r.fromUser),
      note: r.note,
      scrim: s && r.date ? { id: s.id, title: s.title, date: r.date, startTime: s.startTime, posterUrl: brandingUrl(s.posterKey), organiser: organizerName(s.manager) } : null,
      tournament: t ? { id: t.id, name: t.title, posterUrl: brandingUrl(t.posterKey), organiser: organizerName(t.manager) } : null,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

async function teamOf(userId: string) {
  const m = await membershipOf(userId);
  if (!m) throw noTeam(404);
  return m;
}

export async function listSuggestions(userId: string, status: SuggestionStatus): Promise<TeamSuggestionRow[]> {
  const m = await teamOf(userId);
  const rows = await prisma.teamSuggestion.findMany({
    where: { teamId: m.teamId, status },
    include: suggestionInclude,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return toRows(rows);
}

async function assertTarget(teamId: string, input: CreateSuggestionInput, now: Date) {
  if (input.kind === "SCRIM") {
    const scrim = await prisma.scrim.findUnique({ where: { id: input.scrimId }, include: { ...scrimInclude, manager: { select: { ...organizerSelect, isActive: true } } } });
    if (!scrim || scrim.status === "ARCHIVED" || !scrim.published || !scrim.manager.isActive || !scrimOccursOn(scrim, input.date)) throw notFound("Scrim not found");
    if (scrim.status !== "ACTIVE" || now >= closesAtOf(input.date, scrim)) {
      throw new AppError("REGISTRATION_CLOSED", "Registration for this scrim has closed");
    }
    const reg = await prisma.registration.findFirst({
      where: { teamId, status: { in: ["PENDING", "APPROVED"] }, session: { scrimId: scrim.id, date: strToDate(input.date) } },
      select: { id: true },
    });
    if (reg) throw conflict("Your team is already registered for this scrim");
  } else {
    const t = await prisma.tournament.findUnique({ where: { id: input.tournamentId }, select: { status: true } });
    if (!t || t.status === "DRAFT") throw notFound("Tournament not found");
    const entry = await prisma.tournamentEntry.findFirst({
      where: { teamId, tournamentId: input.tournamentId, status: { in: ["CONFIRMED", "WAITLISTED"] } },
      select: { id: true },
    });
    if (entry) throw conflict("Your team is already registered for this tournament");
  }
}

const targetWhere = (input: CreateSuggestionInput): Prisma.TeamSuggestionWhereInput =>
  input.kind === "SCRIM" ? { kind: "SCRIM", scrimId: input.scrimId, date: input.date } : { kind: "TOURNAMENT", tournamentId: input.tournamentId };

export async function createSuggestion(userId: string, input: CreateSuggestionInput, now = new Date()): Promise<TeamSuggestionRow> {
  const m = await teamOf(userId);
  await assertTarget(m.teamId, input, now);
  const existing = await prisma.teamSuggestion.findFirst({ where: { teamId: m.teamId, status: "OPEN", ...targetWhere(input) }, include: suggestionInclude });
  if (existing) return (await toRows([existing]))[0]!;
  const row = await prisma.teamSuggestion.create({
    data: {
      teamId: m.teamId,
      fromUserId: userId,
      kind: input.kind,
      scrimId: input.kind === "SCRIM" ? input.scrimId : null,
      date: input.kind === "SCRIM" ? input.date : null,
      tournamentId: input.kind === "TOURNAMENT" ? input.tournamentId : null,
      note: input.note || null,
    },
    include: suggestionInclude,
  });
  return (await toRows([row]))[0]!;
}

export async function dismissSuggestion(userId: string, id: string): Promise<TeamSuggestionRow> {
  const m = await teamOf(userId);
  if (m.role !== "LEADER") throw new AppError("LEADER_ONLY", MSG.LEADER_ONLY_MANAGE);
  const s = await prisma.teamSuggestion.findUnique({ where: { id }, select: { teamId: true } });
  if (!s || s.teamId !== m.teamId) throw notFound("Suggestion not found");
  await prisma.teamSuggestion.updateMany({ where: { id, status: "OPEN" }, data: { status: "DISMISSED" } });
  const row = await prisma.teamSuggestion.findUniqueOrThrow({ where: { id }, include: suggestionInclude });
  return (await toRows([row]))[0]!;
}

/** Registering for a scrim/tournament completes the team's OPEN suggestions for it. */
export async function markSuggestionsDone(teamId: string, target: { scrimId: string; date: string } | { tournamentId: string }) {
  await prisma.teamSuggestion.updateMany({
    where: {
      teamId,
      status: "OPEN",
      ...("scrimId" in target ? { kind: "SCRIM", scrimId: target.scrimId, date: target.date } : { kind: "TOURNAMENT", tournamentId: target.tournamentId }),
    },
    data: { status: "DONE" },
  });
}

/** OPEN suggestions per scrim on a date (for TeamScrimOnDate.mySuggestion). */
export async function openScrimSuggestions(teamId: string, scrimIds: string[], date: string) {
  if (!scrimIds.length) return new Map<string, { id: string; fromIgn: string | null }>();
  const rows = await prisma.teamSuggestion.findMany({
    where: { teamId, status: "OPEN", kind: "SCRIM", scrimId: { in: scrimIds }, date },
    select: { id: true, scrimId: true, fromUser: { select: { ign: true } } },
    orderBy: { createdAt: "asc" },
  });
  const out = new Map<string, { id: string; fromIgn: string | null }>();
  for (const r of rows) if (r.scrimId && !out.has(r.scrimId)) out.set(r.scrimId, { id: r.id, fromIgn: r.fromUser.ign });
  return out;
}
