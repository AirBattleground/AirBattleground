import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, todayInAppTz, type ExtractionResult } from "@7xen/shared";
import { extractor } from "../src/lib/extractor.js";
import { runWorkerOnce } from "../src/services/screenshotWorker.js";
import { createDemoTournament } from "../src/services/tournaments/demo.js";
import { adminAgent, createAdminUser, createManager, createTeam, prisma, resetDb, server, type TestAgent } from "./helpers.js";

beforeEach(async () => {
  await resetDb();
  await createAdminUser();
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await prisma.$disconnect();
  server.close();
});

// ---------------------------------------------------------------- fixtures

const day = (n: number) => addDays(todayInAppTz(), n);
const schedule = (from: number, to: number) => ({
  startDate: day(from),
  endDate: day(to),
  windows: [{ start: "18:00", end: "23:00" }],
  excludeDates: [],
  matchMinutes: 40,
  breakMinutes: 5,
  parallelLobbies: 1,
});

/** 8 teams → Qualifier (2 groups × 4, 2 matches, top 1 + 2 wildcards) → Final (4 + 1 invited, 1 match). */
const tournamentBody = (over: Record<string, unknown> = {}) => ({
  title: "Monsoon Cup",
  prize: "₹10,000",
  maxTeams: 8,
  teamSize: 4,
  firstSlot: 1,
  pointsSystem: { placement: [10, 6, 5, 4], killPoints: 1 },
  stages: [
    {
      name: "Qualifier",
      teamsIn: 8,
      lobbySize: 4,
      groupCount: 2,
      matchesPerGroup: 2,
      maps: ["ERANGEL", "MIRAMAR"],
      advancePerGroup: 1,
      wildcardCount: 2,
      invitedSlots: 0,
      schedule: schedule(1, 2),
    },
    {
      name: "Final",
      teamsIn: 5,
      lobbySize: 16,
      groupCount: 1,
      matchesPerGroup: 1,
      maps: ["ERANGEL"],
      advancePerGroup: 0,
      wildcardCount: 0,
      invitedSlots: 1,
      schedule: schedule(3, 3),
    },
  ],
  ...over,
});

type Team = { id: string; name: string; agent: TestAgent };

async function world(teamCount = 10) {
  const admin = await adminAgent();
  const mgr = await createManager(admin, "boss");
  const teams: Team[] = [];
  for (let i = 0; i < teamCount; i++) {
    const t = await createTeam(admin, `Squad ${String.fromCharCode(65 + i)}`, `squad${i}`);
    teams.push({ id: t.row.id, name: t.row.name, agent: t.agent });
  }
  return { admin, mgr: mgr.agent, teams };
}

async function createPublished(mgr: TestAgent, over: Record<string, unknown> = {}) {
  const res = await mgr.post("/api/manager/tournaments").send(tournamentBody(over));
  expect(res.status).toBe(201);
  const pub = await mgr.post(`/api/manager/tournaments/${res.body.id}/publish`);
  expect(pub.status, JSON.stringify(pub.body)).toBe(200);
  return pub.body as { id: string; stages: { id: string; name: string }[]; slotOptions: { id: string; capacity: number }[] };
}

const register = (t: Team, id: string, timePreferences: string[] = []) => t.agent.post(`/api/team/tournaments/${id}/entry`).send({ timePreferences });

type Group = { id: string; name: string; startsAt: string | null; teams: { team: { id: string; name: string }; slotNumber: number; status: string; seed: number | null }[]; matches: { id: string; number: number }[] };

async function stage(mgr: TestAgent, tid: string, sid: string) {
  const r = await mgr.get(`/api/manager/tournaments/${tid}/stages/${sid}`);
  expect(r.status).toBe(200);
  return r.body as { stage: { status: string; drawSeed: string }; groups: Group[]; unmetPreferences: unknown[]; topTeams: unknown[]; topFraggers: { name: string; kills: number }[] };
}

const playerNames = (team: { name: string }) => [1, 2, 3, 4].map((i) => `${team.name.replace(/\s/g, "")}P${i}`);

/** Lineup + results + publish for one group match. placements[i] = place of the i-th team (by slot). */
async function playMatch(mgr: TestAgent, g: Group, matchId: string, placements: number[], kills: number[] = []) {
  const teams = [...g.teams].sort((a, b) => a.slotNumber - b.slotNumber);
  const lineup = await mgr.put(`/api/manager/matches/${matchId}/lineup`).send({
    confirm: true,
    teams: teams.map((t) => ({ slotNumber: t.slotNumber, players: playerNames(t.team).map((name, j) => ({ position: j + 1, name })) })),
  });
  expect(lineup.status, JSON.stringify(lineup.body)).toBe(200);
  const res = await mgr.put(`/api/manager/matches/${matchId}/results`).send({
    teams: teams.map((t, i) => ({
      slotNumber: t.slotNumber,
      placement: placements[i]!,
      kills: kills[i] ?? 0,
      players: [{ position: 1, kills: kills[i] ?? 0 }],
    })),
  });
  expect(res.status).toBe(200);
  const pub = await mgr.post(`/api/manager/matches/${matchId}/publish`);
  expect(pub.status, JSON.stringify(pub.body)).toBe(200);
  return pub.body;
}

const me = async (t: Team, id: string) => {
  const r = await t.agent.get(`/api/team/tournaments/${id}`);
  expect(r.status).toBe(200);
  return r.body.me as { state: string; nextGoal: string | null; groupName: string | null; nextMatch: unknown; entry: { waitlistPosition: number | null } | null; canRegister: boolean; registerBlockedReason: string | null; rosterWarning?: string | null };
};

/** A tiny buffer with a valid PNG header (enough for type + size sniffing). */
function fakePng(salt: string, w = 1600, h = 720): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "ascii");
  ihdr.writeUInt32BE(w, 8);
  ihdr.writeUInt32BE(h, 12);
  return Buffer.concat([sig, ihdr, Buffer.from(salt)]);
}

// ---------------------------------------------------------------- tests

describe("tournament setup", () => {
  it("validates the format on save, needs a schedule to publish, and freezes the format after publishing", async () => {
    const { mgr, teams } = await world(1);
    const bad = await mgr.post("/api/manager/tournaments").send(tournamentBody({ maxTeams: 12 }));
    expect(bad.status).toBe(201);
    expect(bad.body.status).toBe("DRAFT");
    expect(bad.body.issues.some((i: { level: string }) => i.level === "error")).toBe(true);
    expect(bad.body.nextAction.key).toBe("FIX_FORMAT");
    expect(bad.body.canEditFormat).toBe(true);
    const id = bad.body.id;
    expect((await mgr.post(`/api/manager/tournaments/${id}/publish`)).status).toBe(400);

    // drafts are invisible to teams
    expect((await teams[0]!.agent.get(`/api/team/tournaments/${id}`)).status).toBe(404);

    const body = tournamentBody();
    (body.stages[0] as Record<string, unknown>).schedule = null;
    const fixed = await mgr.patch(`/api/manager/tournaments/${id}`).send({ maxTeams: 8, stages: body.stages });
    expect(fixed.status).toBe(200);
    expect(fixed.body.issues.filter((i: { level: string }) => i.level === "error")).toEqual([]);
    expect(fixed.body.nextAction).toMatchObject({ key: "SET_SCHEDULE" });
    const noSched = await mgr.post(`/api/manager/tournaments/${id}/publish`);
    expect(noSched.status).toBe(400);
    expect(noSched.body.error.message).toMatch(/schedule/i);

    const withSched = await mgr.patch(`/api/manager/tournaments/${id}`).send({ stages: tournamentBody().stages });
    expect(withSched.body.nextAction.key).toBe("PUBLISH");
    expect(withSched.body.slotOptions).toHaveLength(2);
    const pub = await mgr.post(`/api/manager/tournaments/${id}/publish`);
    expect(pub.status).toBe(200);
    expect(pub.body).toMatchObject({ status: "REGISTRATION_OPEN", canEditFormat: false, nextAction: { key: "CLOSE_REGISTRATION" } });
    expect(pub.body.stages[0]).toMatchObject({ teamsOut: 4, status: "PENDING" });
    expect(pub.body.stages[0].plan.blocks).toHaveLength(2);
    expect(pub.body.startsAt).toBeTruthy();

    const fmt = tournamentBody().stages;
    (fmt[0] as Record<string, unknown>).matchesPerGroup = 3;
    expect((await mgr.patch(`/api/manager/tournaments/${id}`).send({ stages: fmt })).status).toBe(409);
    expect((await mgr.patch(`/api/manager/tournaments/${id}`).send({ maxTeams: 16 })).status).toBe(409);
    const basics = await mgr.patch(`/api/manager/tournaments/${id}`).send({ title: "Monsoon Cup S2", prize: "₹20,000" });
    expect(basics.status).toBe(200);
    expect(basics.body.title).toBe("Monsoon Cup S2");
    expect((await mgr.post(`/api/manager/tournaments/${id}/publish`)).status).toBe(409);
  });
});

describe("registration", () => {
  it("is first come first served with a waitlist that auto-promotes on withdraw and remove", async () => {
    const { mgr, teams } = await world(10);
    const t = await createPublished(mgr);
    for (let i = 0; i < 8; i++) {
      const r = await register(teams[i]!, t.id);
      expect(r.status).toBe(201);
      expect(r.body.state).toBe("CONFIRMED");
    }
    const w1 = await register(teams[8]!, t.id);
    expect(w1.body.state).toBe("WAITLISTED");
    expect(w1.body.entry.waitlistPosition).toBe(1);
    const w2 = await register(teams[9]!, t.id);
    expect(w2.body.entry.waitlistPosition).toBe(2);
    expect((await me(teams[9]!, t.id)).nextGoal).toMatch(/#2 on the waitlist/);

    // already registered
    const dup = await register(teams[0]!, t.id);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("CONFLICT");

    // withdraw → first waitlisted team gets the spot
    expect((await teams[0]!.agent.delete(`/api/team/tournaments/${t.id}/entry`)).status).toBe(204);
    expect((await me(teams[8]!, t.id)).state).toBe("CONFIRMED");
    expect((await me(teams[9]!, t.id)).entry?.waitlistPosition).toBe(1);
    expect((await me(teams[0]!, t.id)).state).toBe("WITHDRAWN");

    // manager removes a confirmed team → next one promoted
    const entries = await mgr.get(`/api/manager/tournaments/${t.id}/entries`);
    expect(entries.body.items[0].status).toBe("CONFIRMED");
    const e1 = entries.body.items.find((e: { team: { id: string } }) => e.team.id === teams[1]!.id);
    expect((await mgr.delete(`/api/manager/tournaments/${t.id}/entries/${e1.id}`)).status).toBe(204);
    expect((await me(teams[9]!, t.id)).state).toBe("CONFIRMED");
    const removed = await me(teams[1]!, t.id);
    expect(removed).toMatchObject({ state: "NOT_REGISTERED", canRegister: false });
    expect(removed.registerBlockedReason).toMatch(/removed/);

    // withdrawn team can come back (to the waitlist, at the back of the queue)
    const back = await register(teams[0]!, t.id);
    expect(back.status).toBe(201);
    expect(back.body.state).toBe("WAITLISTED");

    const detail = await mgr.get(`/api/manager/tournaments/${t.id}`);
    expect(detail.body).toMatchObject({ confirmedCount: 8, waitlistCount: 1 });
  });

  it("never confirms two teams racing for the last spot", async () => {
    const { mgr, teams } = await world(10);
    const t = await createPublished(mgr);
    for (let i = 0; i < 7; i++) expect((await register(teams[i]!, t.id)).body.state).toBe("CONFIRMED");
    const [a, b, c] = await Promise.all([register(teams[7]!, t.id), register(teams[8]!, t.id), register(teams[9]!, t.id)]);
    const states = [a.body.state, b.body.state, c.body.state].sort();
    expect(states).toEqual(["CONFIRMED", "WAITLISTED", "WAITLISTED"]);
    expect(await prisma.tournamentEntry.count({ where: { tournamentId: t.id, status: "CONFIRMED" } })).toBe(8);

    // two confirmed teams withdraw at once → exactly the two waitlisted teams get in
    const confirmedIdx = [0, 1];
    await Promise.all(confirmedIdx.map((i) => teams[i]!.agent.delete(`/api/team/tournaments/${t.id}/entry`)));
    expect(await prisma.tournamentEntry.count({ where: { tournamentId: t.id, status: "CONFIRMED" } })).toBe(8);
    expect(await prisma.tournamentEntry.count({ where: { tournamentId: t.id, status: "WAITLISTED" } })).toBe(0);
  });

  it("rejects registration outside the window, when closed, and with unknown time slots", async () => {
    const { mgr, teams } = await world(2);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const t = await createPublished(mgr, { registrationOpensAt: future });
    const early = await register(teams[0]!, t.id);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("REGISTRATION_CLOSED");
    expect(early.body.error.message).toMatch(/opens on/);
    expect((await me(teams[0]!, t.id)).canRegister).toBe(false);

    const t2 = await createPublished(mgr);
    const badPref = await register(teams[0]!, t2.id, ["2020-01-01T18:00:00+05:30"]);
    expect(badPref.status).toBe(400);
    expect((await register(teams[0]!, t2.id, [t2.slotOptions[1]!.id])).status).toBe(201);
    const upd = await teams[0]!.agent.put(`/api/team/tournaments/${t2.id}/entry`).send({ timePreferences: [t2.slotOptions[0]!.id, t2.slotOptions[1]!.id] });
    expect(upd.status).toBe(200);
    expect(upd.body.entry.timePreferences).toEqual([t2.slotOptions[0]!.id, t2.slotOptions[1]!.id]);
    // phase 5: roster = team members (just the leader here)
    expect(upd.body.rosterWarning).toMatch(/1 player;/);

    const detail = await teams[1]!.agent.get(`/api/team/tournaments/${t2.id}`);
    expect(detail.body.slotOptions.find((o: { id: string }) => o.id === t2.slotOptions[0]!.id).taken).toBe(1);

    expect((await mgr.post(`/api/manager/tournaments/${t2.id}/close-registration`)).status).toBe(200);
    const closed = await register(teams[1]!, t2.id);
    expect(closed.status).toBe(409);
    expect(closed.body.error.code).toBe("REGISTRATION_CLOSED");
    expect((await mgr.post(`/api/manager/tournaments/${t2.id}/reopen-registration`)).status).toBe(200);
    expect((await register(teams[1]!, t2.id)).status).toBe(201);

    // registrationClosesAt in the past closes registration lazily
    await prisma.tournament.update({ where: { id: t2.id }, data: { registrationClosesAt: new Date(Date.now() - 1000) } });
    const list = await teams[1]!.agent.get("/api/team/tournaments?scope=open");
    expect(list.body.items.map((x: { id: string }) => x.id)).toEqual([t.id]);
    const live = await teams[1]!.agent.get("/api/team/tournaments?scope=live");
    expect(live.body.items[0]).toMatchObject({ id: t2.id, status: "REGISTRATION_CLOSED" });
    const mine = await teams[1]!.agent.get("/api/team/tournaments?scope=mine");
    expect(mine.body.items.map((x: { id: string }) => x.id)).toEqual([t2.id]);
  });
});

describe("draw", () => {
  it("honours time preferences in registration order, deterministically for a seed", async () => {
    const { mgr, teams } = await world(9);
    const t = await createPublished(mgr);
    const [early, late] = t.slotOptions.map((o) => o.id) as [string, string];
    // 5 teams want the early slot (capacity 4): the 5th registered gets the late slot
    for (let i = 0; i < 8; i++) expect((await register(teams[i]!, t.id, i < 5 ? [early] : [late])).status).toBe(201);
    const s1 = t.stages[0]!.id;
    const drawn = await mgr.post(`/api/manager/tournaments/${t.id}/stages/${s1}/draw`).send({ seed: "fixed-seed" });
    expect(drawn.status, JSON.stringify(drawn.body)).toBe(200);
    expect(drawn.body.stage).toMatchObject({ status: "DRAWN", drawSeed: "fixed-seed" });
    expect(drawn.body.groups).toHaveLength(2);
    const groupAt = (slot: string) => (drawn.body.groups as Group[]).find((g) => new Date(g.startsAt!).getTime() === new Date(slot).getTime())!;
    const earlyIds = groupAt(early).teams.map((x) => x.team.id).sort();
    expect(earlyIds).toEqual(teams.slice(0, 4).map((x) => x.id).sort());
    expect(drawn.body.unmetPreferences).toHaveLength(1);
    expect(drawn.body.unmetPreferences[0].team.id).toBe(teams[4]!.id);
    // slots are 1..4 in every group, 2 matches per group with times
    for (const g of drawn.body.groups as Group[]) {
      expect(g.teams.map((x) => x.slotNumber).sort()).toEqual([1, 2, 3, 4]);
      expect(g.matches).toHaveLength(2);
    }
    // registration closed by the draw; withdrawing / registering now is blocked
    const det = await mgr.get(`/api/manager/tournaments/${t.id}`);
    expect(det.body.status).toBe("REGISTRATION_CLOSED");
    expect(det.body.nextAction.key).toBe("START_STAGE");
    expect((await teams[0]!.agent.delete(`/api/team/tournaments/${t.id}/entry`)).status).toBe(409);
    expect((await register(teams[8]!, t.id)).status).toBe(409);
    expect((await me(teams[0]!, t.id)).state).toBe("PLAYING");

    const snapshot = (gs: Group[]) => gs.map((g) => g.teams.map((x) => `${x.team.id}:${x.slotNumber}`).sort().join(","));
    const again = await mgr.post(`/api/manager/tournaments/${t.id}/stages/${s1}/redraw`).send({ seed: "fixed-seed" });
    expect(again.status).toBe(200);
    expect(snapshot(again.body.groups)).toEqual(snapshot(drawn.body.groups));

    // redraw is blocked once a match has data
    const g0 = again.body.groups[0] as Group;
    await mgr.put(`/api/manager/matches/${g0.matches[0]!.id}/lineup`).send({ confirm: false, teams: [{ slotNumber: g0.teams[0]!.slotNumber, players: [{ position: 1, name: "X" }] }] });
    expect((await mgr.post(`/api/manager/tournaments/${t.id}/stages/${s1}/redraw`).send({})).status).toBe(409);

    // group moves: swap two teams across groups keeps slots unique
    const [ga, gb] = again.body.groups as Group[];
    const a0 = ga!.teams[0]!;
    const b0 = gb!.teams[0]!;
    const moved = await mgr.patch(`/api/manager/tournaments/${t.id}/stages/${s1}/groups`).send({ moves: [{ teamId: a0.team.id, toGroupId: gb!.id, slotNumber: b0.slotNumber }] });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const nga = (moved.body.groups as Group[]).find((g) => g.id === ga!.id)!;
    const ngb = (moved.body.groups as Group[]).find((g) => g.id === gb!.id)!;
    expect(ngb.teams.find((x) => x.team.id === a0.team.id)?.slotNumber).toBe(b0.slotNumber);
    expect(nga.teams.find((x) => x.team.id === b0.team.id)?.slotNumber).toBe(a0.slotNumber);

    // reschedule a match
    const at = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const rs = await mgr.patch(`/api/manager/tournaments/${t.id}/matches/${ngb.matches[1]!.id}/schedule`).send({ scheduledAt: at });
    expect(rs.status).toBe(200);
    const m = (rs.body.groups as Group[]).find((g) => g.id === gb!.id)!.matches[1] as unknown as { scheduledAt: string };
    expect(new Date(m.scheduledAt).getTime()).toBe(new Date(at).getTime());
  });
});

describe("full tournament", () => {
  it("plays group matches through the match center, promotes with wildcards/DQ/ties, snake-seeds the final and crowns a champion", async () => {
    const { admin, mgr, teams } = await world(10);
    const t = await createPublished(mgr);
    for (let i = 0; i < 8; i++) expect((await register(teams[i]!, t.id)).status).toBe(201);
    const [s1, s2] = t.stages.map((s) => s.id) as [string, string];
    const invited = teams[9]!;

    // invite a team straight into the final; slots can't be exceeded; stage 1 can't take invites
    expect((await mgr.post(`/api/manager/tournaments/${t.id}/invites`).send({ teamId: invited.id, stageOrder: 2 })).status).toBe(201);
    expect((await mgr.post(`/api/manager/tournaments/${t.id}/invites`).send({ teamId: teams[8]!.id, stageOrder: 2 })).status).toBe(409);
    expect((await me(invited, t.id)).state).toBe("INVITED");
    expect((await me(teams[0]!, t.id)).state).toBe("CONFIRMED");

    expect((await mgr.post(`/api/manager/tournaments/${t.id}/close-registration`)).status).toBe(200);
    expect((await mgr.get(`/api/manager/tournaments/${t.id}`)).body.nextAction).toMatchObject({ key: "DRAW", stageId: s1 });
    expect((await mgr.post(`/api/manager/tournaments/${t.id}/stages/${s1}/draw`).send({ seed: "q" })).status).toBe(200);
    // can't promote / play before start
    expect((await mgr.get(`/api/manager/tournaments/${t.id}/stages/${s1}/promotion`)).body.ready).toBe(false);
    const started = await mgr.post(`/api/manager/tournaments/${t.id}/stages/${s1}/start`);
    expect(started.status).toBe(200);
    expect(started.body.stage.status).toBe("LIVE");
    const live = await mgr.get(`/api/manager/tournaments/${t.id}`);
    expect(live.body).toMatchObject({ status: "LIVE", nextAction: { key: "PLAY_MATCHES" }, currentStage: { order: 1, status: "LIVE" } });

    let st = await stage(mgr, t.id, s1);
    const [A, B] = st.groups as [Group, Group];
    const bySlot = (g: Group) => [...g.teams].sort((a, b) => a.slotNumber - b.slotNumber).map((x) => x.team);
    const teamAgent = (id: string) => teams.find((x) => x.id === id)!;

    // ---- screenshot pipeline on a group match (stub extractor): roster = group teams
    const spy = vi.spyOn(extractor, "extract").mockImplementation(async (_img, _mime, kind) => {
      const ex: ExtractionResult = {
        imageId: "x",
        kind,
        modelVersion: "test-v1",
        teams: bySlot(A).map((tm, i) => ({
          slot: i + 1,
          slotConfidence: 0.99,
          players: playerNames(tm).map((name) => ({ name, confidence: 0.99, source: "paddle", rosterMatch: null, matchedSlot: null, kills: null, killsConfidence: null })),
        })),
        rows: [],
        needsReview: false,
        warnings: [],
        timingsMs: {},
      };
      return ex;
    });
    // phase 5: rosters are the teams' members (no roster PUT any more)
    expect(teamAgent(bySlot(A)[0]!.id)).toBeTruthy();
    const png = fakePng("t1");
    const up = await mgr.post(`/api/manager/matches/${A.matches[0]!.id}/screenshots`).field("kind", "SLOT_LIST").attach("files", png, { filename: "a.png", contentType: "image/png" });
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    expect(await runWorkerOnce()).toBe(1);
    const roster = spy.mock.calls[0]![3] as { slot: number; teamName: string | null }[];
    expect(roster.map((r) => r.teamName).sort()).toEqual(bySlot(A).map((x) => x.name).sort());
    const md = await mgr.get(`/api/manager/matches/${A.matches[0]!.id}`);
    expect(md.status).toBe(200);
    expect(md.body.tournament).toMatchObject({ id: t.id, stageId: s1, groupId: A.id, groupName: "A", stageName: "Qualifier" });
    expect(md.body.scrim).toMatchObject({ id: t.id, title: "Monsoon Cup · Qualifier · Group A", slotCount: 4, firstSlot: 1, pointsSystem: { placement: [10, 6, 5, 4], killPoints: 1 } });
    expect(md.body.sessionSlots).toHaveLength(4);
    expect(md.body.match.status).toBe("LINEUP_REVIEW");
    for (const row of md.body.teams) expect(row.team).not.toBeNull();
    expect(md.body.teams.map((r: { team: { id: string } }) => r.team.id).sort()).toEqual(A.teams.map((x) => x.team.id).sort());

    // admin can read and act on any match; another manager can't
    expect((await admin.get(`/api/admin/matches/${A.matches[0]!.id}`)).status).toBe(200);
    const other = await createManager(admin, "rival");
    expect((await other.agent.get(`/api/manager/matches/${A.matches[0]!.id}`)).status).toBe(404);
    expect((await other.agent.get(`/api/manager/tournaments/${t.id}`)).status).toBe(404);
    expect((await other.agent.get(`/api/manager/tournaments/${t.id}/stages/${s1}`)).status).toBe(404);
    expect((await other.agent.post(`/api/manager/tournaments/${t.id}/cancel`)).status).toBe(404);

    // ---- play all qualifier matches: by slot order, places 1..4 in both matches
    const PLACES = [1, 2, 3, 4];
    for (const g of [A, B]) for (const m of g.matches) await playMatch(mgr, g, m.id, PLACES, [3, 0, 0, 0]);

    // points with the tournament's points system: 1st twice = 20 + 6 kills
    st = await stage(mgr, t.id, s1);
    const ga = st.groups.find((g) => g.id === A.id)! as unknown as { teams: { rank: number; totalPoints: number; team: { id: string } }[] };
    expect(ga.teams.map((r) => r.totalPoints)).toEqual([26, 12, 10, 8]);
    expect(ga.teams[0]!.team.id).toBe(bySlot(A)[0]!.id);
    expect(st.topTeams[0]).toMatchObject({ totalPoints: 26, matchesPlayed: 2, pointsPerMatch: 13 });
    expect(st.topFraggers[0]).toMatchObject({ kills: 6 });

    // published group matches are visible to every team (even ones in the other group)
    const outsider = teamAgent(bySlot(B)[3]!.id);
    const card = await outsider.agent.get(`/api/team/matches/${A.matches[1]!.id}`);
    expect(card.status).toBe(200);
    expect(card.body.tournament).toMatchObject({ id: t.id, groupName: "A" });
    expect(card.body.teams).toHaveLength(4);
    expect(card.body.teams[0].totalPoints).toBe(13);
    // team stage view (public)
    expect((await outsider.agent.get(`/api/team/tournaments/${t.id}/stages/${s1}`)).status).toBe(200);

    const playing = await me(teamAgent(bySlot(A)[1]!.id), t.id);
    expect(playing.state).toBe("PLAYING");
    expect(playing.nextGoal).toBe("Finish in the top 1 of Group A to reach the Final or be one of the 2 best wildcards");
    expect(playing.nextMatch).toBeNull();
    expect((await mgr.get(`/api/manager/tournaments/${t.id}`)).body.nextAction.key).toBe("PROMOTE");

    // ---- disqualify Group B's winner; wildcards then tie between A3 and B3 (both 5 ppm)
    const bWinner = bySlot(B)[0]!;
    const dq = await mgr.post(`/api/manager/tournaments/${t.id}/stages/${s1}/teams/${bWinner.id}/disqualify`).send({ reason: "Emulator use" });
    expect(dq.status).toBe(200);
    const preview = await mgr.get(`/api/manager/tournaments/${t.id}/stages/${s1}/promotion`);
    expect(preview.status).toBe(200);
    expect(preview.body.ready).toBe(true);
    expect(preview.body.blockers).toEqual([]);
    const qIds = preview.body.qualified.map((q: { team: { id: string } }) => q.team.id);
    expect(qIds).toHaveLength(4);
    expect(qIds).not.toContain(bWinner.id);
    expect(qIds).toContain(bySlot(A)[0]!.id); // A top
    expect(qIds).toContain(bySlot(B)[1]!.id); // B top after DQ
    expect(qIds).toContain(bySlot(A)[1]!.id); // best wildcard (6 ppm)
    expect(preview.body.tiesAtCutoff).toHaveLength(1);
    const tieMsg: string = preview.body.tiesAtCutoff[0];
    expect(tieMsg).toContain(bySlot(A)[2]!.name);
    expect(tieMsg).toContain(bySlot(B)[2]!.name);
    expect(tieMsg).not.toContain(bySlot(A)[2]!.id);
    expect(preview.body.nextStage).toMatchObject({ order: 2, name: "Final", teamsIn: 5, invited: [{ id: invited.id }] });

    // resolve the tie for B's 3rd-placed team
    const pick = bySlot(B)[2]!;
    const promoted = await mgr.post(`/api/manager/tournaments/${t.id}/stages/${s1}/promote`).send({ include: [pick.id] });
    expect(promoted.status, JSON.stringify(promoted.body)).toBe(200);
    expect(promoted.body.stages[0].status).toBe("COMPLETED");
    expect(promoted.body.nextAction).toMatchObject({ key: "DRAW", stageId: s2 });
    expect((await mgr.post(`/api/manager/tournaments/${t.id}/stages/${s1}/promote`).send({})).status).toBe(409);

    st = await stage(mgr, t.id, s1);
    const all = st.groups.flatMap((g) => g.teams);
    expect(all.find((x) => x.team.id === bWinner.id)!.status).toBe("DISQUALIFIED");
    expect(all.find((x) => x.team.id === pick.id)!.status).toBe("ADVANCED");
    expect(all.find((x) => x.team.id === bySlot(A)[2]!.id)!.status).toBe("ELIMINATED");

    expect((await me(teamAgent(bySlot(A)[0]!.id), t.id)).state).toBe("QUALIFIED");
    expect((await me(teamAgent(bySlot(A)[2]!.id), t.id)).state).toBe("ELIMINATED");
    const dqMe = await me(teamAgent(bWinner.id), t.id);
    expect(dqMe.state).toBe("DISQUALIFIED");
    expect(dqMe.nextGoal).toMatch(/Emulator use/);

    // ---- final: snake seeding, invited team is seed 1
    const fd = await mgr.post(`/api/manager/tournaments/${t.id}/stages/${s2}/draw`).send({ seed: "f" });
    expect(fd.status, JSON.stringify(fd.body)).toBe(200);
    const F = fd.body.groups[0] as Group;
    expect(F.teams).toHaveLength(5);
    const seeds = [...F.teams].sort((a, b) => a.seed! - b.seed!);
    expect(seeds[0]!.team.id).toBe(invited.id);
    expect(seeds[1]!.team.id).toBe(bySlot(A)[0]!.id); // best qualifier: group rank 1 with the most points per match
    expect(F.matches).toHaveLength(1);
    expect((await me(invited, t.id)).state).toBe("PLAYING");
    expect((await me(invited, t.id)).nextGoal).toBe("Finish first in the Final to become the champion");

    expect((await mgr.post(`/api/manager/tournaments/${t.id}/complete`)).status).toBe(409);
    expect((await mgr.post(`/api/manager/tournaments/${t.id}/stages/${s2}/start`)).status).toBe(200);
    const order = [...F.teams].sort((a, b) => a.slotNumber - b.slotNumber);
    const places: number[] = order.map((x) => (x.team.id === invited.id ? 1 : 0));
    let next = 2;
    for (let i = 0; i < places.length; i++) if (places[i] === 0) places[i] = next++;
    await playMatch(mgr, F, F.matches[0]!.id, places);
    const fp = await mgr.get(`/api/manager/tournaments/${t.id}/stages/${s2}/promotion`);
    expect(fp.body).toMatchObject({ ready: true, nextStage: null, qualified: [] });
    const done = await mgr.post(`/api/manager/tournaments/${t.id}/stages/${s2}/promote`).send({});
    expect(done.status).toBe(200);
    expect(done.body.champion).toMatchObject({ id: invited.id });
    expect(done.body.nextAction.key).toBe("COMPLETE");
    const complete = await mgr.post(`/api/manager/tournaments/${t.id}/complete`);
    expect(complete.status).toBe(200);
    expect(complete.body).toMatchObject({ status: "COMPLETED", champion: { id: invited.id }, nextAction: { key: "DONE" } });
    expect((await me(invited, t.id)).state).toBe("CHAMPION");
    expect((await me(teamAgent(bySlot(A)[0]!.id), t.id)).state).toBe("ELIMINATED");
    const completed = await invited.agent.get("/api/team/tournaments?scope=completed");
    expect(completed.body.items[0]).toMatchObject({ id: t.id, champion: { id: invited.id } });
  });
});

describe("demo generator", () => {
  it("creates a valid, published tournament with FCFS entries that can be drawn", async () => {
    const { mgr, teams } = await world(10);
    const mgrId = (await prisma.user.findUniqueOrThrow({ where: { username: "boss" } })).id;
    const { id, created } = await createDemoTournament(prisma, { managerId: mgrId, teamIds: teams.map((x) => x.id), maxTeams: 8, lobbySize: 4, title: "Demo A" });
    expect(created).toBe(true);
    expect((await createDemoTournament(prisma, { managerId: mgrId, teamIds: [], title: "Demo A" })).created).toBe(false);
    const d = await mgr.get(`/api/manager/tournaments/${id}`);
    expect(d.body).toMatchObject({ status: "REGISTRATION_OPEN", confirmedCount: 8, waitlistCount: 2 });
    expect(d.body.issues.filter((i: { level: string }) => i.level === "error")).toEqual([]);
    const sched = await mgr.put(`/api/manager/tournaments/${id}/stages/${d.body.stages[0].id}/schedule`).send(schedule(1, 1));
    expect(sched.status).toBe(200);
    expect(sched.body.stage.schedule.startDate).toBe(day(1));
    const drawn = await mgr.post(`/api/manager/tournaments/${id}/stages/${d.body.stages[0].id}/draw`).send({});
    expect(drawn.status, JSON.stringify(drawn.body)).toBe(200);
    expect(drawn.body.groups.flatMap((g: Group) => g.teams)).toHaveLength(8);
    expect(drawn.body.stage.drawSeed).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("admin", () => {
  it("lists every tournament and can manage any of them", async () => {
    const { admin, mgr } = await world(0);
    const draft = await mgr.post("/api/manager/tournaments").send(tournamentBody());
    const other = await createManager(admin, "second");
    await other.agent.post("/api/manager/tournaments").send(tournamentBody({ title: "Other Cup" }));
    const list = await admin.get("/api/admin/tournaments");
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(2);
    expect((await mgr.get("/api/manager/tournaments")).body.items).toHaveLength(1);
    const got = await admin.get(`/api/admin/tournaments/${draft.body.id}`);
    expect(got.status).toBe(200);
    expect(got.body.manager.displayName).toMatch(/boss/);
    const pub = await admin.post(`/api/admin/tournaments/${draft.body.id}/publish`);
    expect(pub.status).toBe(200);
    expect(pub.body.status).toBe("REGISTRATION_OPEN");
    // admin-created tournaments belong to the admin
    const own = await admin.post("/api/admin/tournaments").send(tournamentBody({ title: "Admin Cup" }));
    expect(own.status).toBe(201);
    // managers / teams can't reach admin routes
    expect((await mgr.get("/api/admin/tournaments")).status).toBe(401);
    const cancel = await admin.post(`/api/admin/tournaments/${draft.body.id}/cancel`);
    expect(cancel.body.status).toBe("CANCELLED");
    expect(cancel.body.nextAction).toBeNull();
  });
});

describe("manager team search", () => {
  it("finds active teams by name or tag for invites", async () => {
    const { adminAgent, createAdminUser, createManager, createTeam, resetDb } = await import("./helpers.js");
    await resetDb();
    await createAdminUser();
    const admin = await adminAgent();
    const { agent: mgr } = await createManager(admin);
    await createTeam(admin, "Hydra Esports", "hydra");
    await createTeam(admin, "Soul", "soul");
    const res = await mgr.get("/api/manager/teams").query({ q: "hyd" });
    expect(res.status).toBe(200);
    expect(res.body.items.map((t: { name: string }) => t.name)).toEqual(["Hydra Esports"]);
  });
});
