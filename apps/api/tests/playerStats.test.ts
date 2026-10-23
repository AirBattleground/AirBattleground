import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  adminAgent,
  createAdminUser,
  createManager,
  createScrim,
  createTeam,
  joinTeam,
  playerAgent,
  prisma,
  resetDb,
  server,
  yesterday,
  type TestAgent,
} from "./helpers.js";

beforeEach(async () => {
  await resetDb();
  await createAdminUser();
});
afterAll(async () => {
  await prisma.$disconnect();
  server.close();
});

/**
 * Phoenix Raiders on slot 3: PHX•Blaze (leader), PHX•Viper, PHX•Ronin, PHX•Ace. Ace sits out; an unregistered
 * player plays in his place. A second team (Rivals) on slot 4 so placements make sense.
 */
async function setup() {
  const admin = await adminAgent();
  const mgr = await createManager(admin, "boss");
  const scrim = await createScrim(mgr.agent);
  const phx = await createTeam(admin, "Phoenix Raiders", "blaze");
  expect((await phx.agent.patch("/api/player/me").send({ ign: "PHX•Blaze" })).status).toBe(200);
  const members: Record<string, { agent: TestAgent; userId: string }> = {};
  for (const ign of ["PHX•Viper", "PHX•Ronin", "PHX•Ace"]) {
    const p = await playerAgent(ign.slice(4).toLowerCase(), { ign });
    await joinTeam(phx, p);
    members[ign] = p;
  }
  const rivals = await createTeam(admin, "Rivals", "RVLOne");
  const session = await prisma.scrimSession.create({ data: { scrimId: scrim.id, date: new Date(`${yesterday()}T00:00:00.000Z`) } });
  await prisma.registration.create({ data: { sessionId: session.id, teamId: phx.row.id, status: "APPROVED", slotNumber: 3 } });
  await prisma.registration.create({ data: { sessionId: session.id, teamId: rivals.row.id, status: "APPROVED", slotNumber: 4 } });
  const list = await mgr.agent.get(`/api/manager/scrims/${scrim.id}/sessions/${yesterday()}/matches`);
  return { mgr: mgr.agent, phx, members, matchId: list.body.items[0].id as string };
}

/** Lineup as read from the lobby: separator and 1/l read differently, and one stranger. */
const LOBBY = ["PHX·Blaze", "PHX•Ronin", "PHX•Viper", "UNKNOWN"];

async function play(mgr: TestAgent, matchId: string, kills: number[], lobby = LOBBY) {
  const lineup = await mgr.put(`/api/manager/matches/${matchId}/lineup`).send({
    confirm: true,
    teams: [
      { slotNumber: 3, players: lobby.map((name, i) => ({ position: i + 1, name })) },
      { slotNumber: 4, players: [{ position: 1, name: "RVLOne" }] },
    ],
  });
  expect(lineup.status, JSON.stringify(lineup.body)).toBe(200);
  await saveAndPublish(mgr, matchId, kills);
}

async function saveAndPublish(mgr: TestAgent, matchId: string, kills: number[]) {
  const r = await mgr.put(`/api/manager/matches/${matchId}/results`).send({
    teams: [
      { slotNumber: 3, placement: 1, kills: null, players: kills.map((k, i) => ({ position: i + 1, kills: k })) },
      { slotNumber: 4, placement: 2, kills: 0, players: [{ position: 1, kills: 0 }] },
    ],
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const p = await mgr.post(`/api/manager/matches/${matchId}/publish`);
  expect(p.status, JSON.stringify(p.body)).toBe(200);
}

const slot3 = (matchId: string) =>
  prisma.matchPlayer.findMany({ where: { matchTeam: { matchId, slotNumber: 3 } }, orderBy: { position: "asc" }, include: { user: { select: { ign: true } } } });

describe("match results → player records", () => {
  it("registered players get their own kills; the unknown player's kills count only for the team", async () => {
    const { mgr, phx, members, matchId } = await setup();
    await play(mgr, matchId, [5, 3, 2, 4]);

    const rows = await slot3(matchId);
    expect(rows.map((r) => r.user?.ign ?? null)).toEqual(["PHX•Blaze", "PHX•Ronin", "PHX•Viper", null]);
    const team = await prisma.matchTeam.findFirstOrThrow({ where: { matchId, slotNumber: 3 } });
    expect(team.kills).toBe(14);

    const blaze = (await phx.agent.get("/api/player/stats")).body;
    expect(blaze).toMatchObject({ matches: 1, wins: 1, kills: 5 });
    expect((await members["PHX•Viper"]!.agent.get("/api/player/stats")).body).toMatchObject({ matches: 1, kills: 2 });
    // Ace registered but didn't play: no record
    expect((await members["PHX•Ace"]!.agent.get("/api/player/stats")).body.matches).toBe(0);
  });

  it("a corrected republish only changes the corrected player's numbers", async () => {
    const { mgr, phx, members, matchId } = await setup();
    await play(mgr, matchId, [2, 3, 2, 4]);
    expect((await mgr.post(`/api/manager/matches/${matchId}/unpublish`)).status).toBe(200);
    await saveAndPublish(mgr, matchId, [3, 3, 2, 4]);
    expect((await mgr.post(`/api/manager/matches/${matchId}/publish`)).status).toBe(200); // publishing again changes nothing

    expect((await phx.agent.get("/api/player/stats")).body).toMatchObject({ matches: 1, kills: 3 });
    expect((await members["PHX•Ronin"]!.agent.get("/api/player/stats")).body).toMatchObject({ matches: 1, kills: 3 });
  });

  it("someone who joins after the match never gets it; someone who left keeps it", async () => {
    const { mgr, phx, members, matchId } = await setup();
    await play(mgr, matchId, [5, 3, 2, 4], ["PHX·Blaze", "PHX•Ronin", "PHX•Viper", "PHX•Late"]);
    expect((await slot3(matchId))[3]!.userId).toBeNull();

    const late = await playerAgent("late", { ign: "PHX•Late" });
    await joinTeam(phx, late);
    expect((await members["PHX•Ronin"]!.agent.post("/api/player/team/leave")).status).toBe(204);
    expect((await mgr.post(`/api/manager/matches/${matchId}/unpublish`)).status).toBe(200);
    await saveAndPublish(mgr, matchId, [5, 3, 2, 4]);

    const rows = await slot3(matchId);
    expect(rows[1]!.user?.ign).toBe("PHX•Ronin");
    expect(rows[3]!.userId).toBeNull();
    expect((await late.agent.get("/api/player/stats")).body.matches).toBe(0);
    expect((await members["PHX•Ronin"]!.agent.get("/api/player/stats")).body).toMatchObject({ matches: 1, kills: 3 });
  });

  it("names that are only close don't link", async () => {
    const { mgr, matchId } = await setup();
    await play(mgr, matchId, [5, 3, 2, 4], ["PHX•Blaxe", "PHX•Ronin", "PHX•Viper", "UNKNOWN"]);
    expect((await slot3(matchId)).map((r) => r.user?.ign ?? null)).toEqual([null, "PHX•Ronin", "PHX•Viper", null]);
  });

  it("TDM battles stay out of the battle royale stats and show in TDM Results", async () => {
    const { mgr, phx, matchId } = await setup();
    await play(mgr, matchId, [5, 3, 2, 4]);

    const managerId = (await prisma.user.findFirstOrThrow({ where: { username: "boss" } })).id;
    const tour = await prisma.tournament.create({ data: { managerId, title: "TDM Night", maxTeams: 2, mode: "TDM", status: "LIVE" } });
    const stage = await prisma.tournamentStage.create({
      data: { tournamentId: tour.id, order: 1, name: "Battles", teamsIn: 2, groupCount: 1, matchesPerGroup: 1, advancePerGroup: 1 },
    });
    const group = await prisma.tournamentGroup.create({ data: { stageId: stage.id, index: 1, name: "Battle 1" } });
    const battle = await prisma.match.create({ data: { groupId: group.id, number: 1, map: "WAREHOUSE", status: "PUBLISHED", publishedAt: new Date() } });
    const rival = await prisma.team.findFirstOrThrow({ where: { name: "Rivals" } });
    await prisma.matchTeam.create({
      data: {
        matchId: battle.id,
        slotNumber: 1,
        teamId: phx.row.id,
        placement: 1,
        kills: 40,
        players: { create: [{ position: 1, name: "PHX•Blaze", kills: 25, userId: phx.leaderId }] },
      },
    });
    await prisma.matchTeam.create({ data: { matchId: battle.id, slotNumber: 2, teamId: rival.id, placement: 2, kills: 31 } });

    expect((await phx.agent.get("/api/player/stats")).body).toMatchObject({ matches: 1, kills: 5 });
    expect((await phx.agent.get("/api/player/stats?scope=TOURNAMENTS")).body.matches).toBe(0);
    const tdm = (await phx.agent.get("/api/player/stats/tdm")).body;
    expect(tdm).toMatchObject({ battles: 1, wins: 1, losses: 0, kills: 25 });
    expect(tdm.recent[0]).toMatchObject({ won: true, teamName: "Phoenix Raiders", opponentName: "Rivals", teamKills: 40, opponentKills: 31 });
  });
});
