import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_SCREENSHOT_BYTES, type ExtractionResult, type ExtractedPlayer } from "@7xen/shared";
import { extractor } from "../src/lib/extractor.js";
import { resolveKey, splitForSha } from "../src/lib/storage.js";
import { runWorkerOnce } from "../src/services/screenshotWorker.js";
import {
  adminAgent,
  createAdminUser,
  createManager,
  createScrim,
  createTeam,
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
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await prisma.$disconnect();
  server.close();
});

// ---------------------------------------------------------------- helpers

/** A tiny buffer with a valid PNG header (enough for type + size sniffing). `salt` makes the sha unique. */
function fakePng(salt: string, w = 1600, h = 720): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "ascii");
  ihdr.writeUInt32BE(w, 8);
  ihdr.writeUInt32BE(h, 12);
  return Buffer.concat([sig, ihdr, Buffer.from(salt)]);
}

const pl = (name: string, kills: number | null = null, confidence = 0.95): ExtractedPlayer => ({
  name,
  confidence,
  source: "paddle",
  rosterMatch: null,
  matchedSlot: null,
  kills,
  killsConfidence: kills == null ? null : 0.9,
});
const extraction = (kind: ExtractionResult["kind"], part: Partial<ExtractionResult>): ExtractionResult => ({
  imageId: "x",
  kind,
  modelVersion: "test-v1",
  teams: [],
  rows: [],
  needsReview: false,
  warnings: [],
  timingsMs: {},
  ...part,
});

const NAMES: Record<string, string[]> = {
  A: ["AlphaOne", "AlphaTwo", "AlphaThree", "AlphaFour"],
  B: ["BravoOne", "BravoTwo", "BravoThree", "BravoFour"],
  C: ["CharlieOne", "CharlieTwo", "CharlieThree", "CharlieFour"],
};

/** Manager + scrim (slots 3..6, 2 maps) + teams A,B,C approved on slots 3,4,5 in yesterday's session. */
async function setup() {
  const admin = await adminAgent();
  const mgr = await createManager(admin, "boss");
  const scrim = await createScrim(mgr.agent);
  const teams: Record<string, { id: string; agent: TestAgent }> = {};
  for (const [i, k] of ["A", "B", "C", "D"].entries()) {
    const t = await createTeam(admin, `Team ${k}`, `team${k.toLowerCase()}`);
    teams[k] = { id: t.row.id, agent: t.agent };
    void i;
  }
  const session = await prisma.scrimSession.create({ data: { scrimId: scrim.id, date: new Date(`${yesterday()}T00:00:00.000Z`) } });
  for (const [i, k] of ["A", "B", "C"].entries()) {
    await prisma.registration.create({ data: { sessionId: session.id, teamId: teams[k]!.id, status: "APPROVED", slotNumber: 3 + i } });
  }
  const list = await mgr.agent.get(`/api/manager/scrims/${scrim.id}/sessions/${yesterday()}/matches`);
  expect(list.status).toBe(200);
  return { admin, mgr: mgr.agent, scrim, teams, session, matches: list.body.items as { id: string; number: number }[] };
}

async function upload(agent: TestAgent, matchId: string, kind: string, files: { buf: Buffer; name: string; type?: string }[]) {
  let req = agent.post(`/api/manager/matches/${matchId}/screenshots`).field("kind", kind);
  for (const f of files) req = req.attach("files", f.buf, { filename: f.name, contentType: f.type ?? "image/png" });
  return req;
}

const lineupBody = (confirm: boolean) => ({
  confirm,
  teams: (["A", "B", "C"] as const).map((k, i) => ({ slotNumber: 3 + i, players: NAMES[k]!.map((name, j) => ({ position: j + 1, name })) })),
});

/** Confirm lineup, save results, publish. placements: team letter → [placement, kills]. */
async function playMatch(mgr: TestAgent, matchId: string, res: Record<"A" | "B" | "C", [number, number]>) {
  expect((await mgr.put(`/api/manager/matches/${matchId}/lineup`).send(lineupBody(true))).status).toBe(200);
  const r = await mgr.put(`/api/manager/matches/${matchId}/results`).send({
    teams: (["A", "B", "C"] as const).map((k, i) => ({ slotNumber: 3 + i, placement: res[k][0], kills: res[k][1] })),
  });
  expect(r.status).toBe(200);
  const p = await mgr.post(`/api/manager/matches/${matchId}/publish`);
  expect(p.status).toBe(200);
  return p.body;
}

// ---------------------------------------------------------------- tests

describe("matches", () => {
  it("creates one match per map lazily and keeps other managers out", async () => {
    const { admin, mgr, scrim, matches } = await setup();
    expect(matches.map((m) => m.number)).toEqual([1, 2]);
    const again = await mgr.get(`/api/manager/scrims/${scrim.id}/sessions/${yesterday()}/matches`);
    expect(again.body.items.map((m: { id: string }) => m.id)).toEqual(matches.map((m) => m.id));
    expect(again.body.items[0]).toMatchObject({ map: "ERANGEL", status: "SCHEDULED", teamsInLineup: 0 });

    const other = await createManager(admin, "other");
    expect((await other.agent.get(`/api/manager/matches/${matches[0]!.id}`)).status).toBe(404);
    expect((await other.agent.get(`/api/manager/scrims/${scrim.id}/sessions/${yesterday()}/matches`)).status).toBe(404);

    const detail = await mgr.get(`/api/manager/matches/${matches[0]!.id}`);
    expect(detail.body.sessionSlots.map((s: { slotNumber: number }) => s.slotNumber)).toEqual([3, 4, 5]);
    expect(detail.body.scrim.pointsSystem).toEqual({ placement: [10, 6, 5, 4, 3, 2, 1, 1], killPoints: 1 });
  });

  it("scrim DTO carries pointsSystem and PATCH updates it", async () => {
    const { mgr, scrim } = await setup();
    const res = await mgr.patch(`/api/manager/scrims/${scrim.id}`).send({ pointsSystem: { placement: [15, 12, 10], killPoints: 2 } });
    expect(res.status).toBe(200);
    expect(res.body.pointsSystem).toEqual({ placement: [15, 12, 10], killPoints: 2 });
  });
});

describe("screenshot uploads", () => {
  it("validates type and size, skips duplicates, serves the image", async () => {
    const { mgr, matches } = await setup();
    const id = matches[0]!.id;

    const bad = await upload(mgr, id, "SLOT_LIST", [{ buf: Buffer.from("GIF89a not an image we take"), name: "x.png" }]);
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");

    const big = Buffer.concat([fakePng("big"), Buffer.alloc(MAX_SCREENSHOT_BYTES)]);
    expect((await upload(mgr, id, "SLOT_LIST", [{ buf: big, name: "big.png" }])).status).toBe(413);

    expect((await upload(mgr, id, "NOPE", [{ buf: fakePng("a"), name: "a.png" }])).status).toBe(400);

    const ok = await upload(mgr, id, "SLOT_LIST", [
      { buf: fakePng("a"), name: "a.png" },
      { buf: fakePng("a"), name: "a-again.png" },
    ]);
    expect(ok.status).toBe(201);
    expect(ok.body.items).toHaveLength(1);
    expect(ok.body.skipped).toBe(1);
    expect(ok.body.items[0]).toMatchObject({ kind: "SLOT_LIST", status: "QUEUED", width: 1600, height: 720, extraction: null });

    const dup = await upload(mgr, id, "SLOT_LIST", [{ buf: fakePng("a"), name: "a.png" }]);
    expect(dup.status).toBe(201);
    expect(dup.body).toMatchObject({ items: [], skipped: 1 });

    const img = await mgr.get(`/api/manager/screenshots/${ok.body.items[0].id}/image`);
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");
    expect(Buffer.from(img.body).subarray(0, 4).toString("hex")).toBe("89504e47");

    expect((await mgr.delete(`/api/manager/screenshots/${ok.body.items[0].id}`)).status).toBe(204);
    expect((await mgr.get(`/api/manager/screenshots/${ok.body.items[0].id}/image`)).status).toBe(404);
  });

  it("blocks path traversal", async () => {
    const { mgr } = await setup();
    expect(() => resolveKey("../../etc/passwd")).toThrow();
    expect(() => resolveKey("/etc/passwd")).toThrow();
    expect(() => resolveKey("screenshots/../../x")).toThrow();
    expect(() => resolveKey("screenshots/.hidden")).toThrow();
    expect(resolveKey("screenshots/2026/10/abc.png")).toMatch(/screenshots\/2026\/10\/abc\.png$/);
    const res = await mgr.get("/api/manager/screenshots/..%2F..%2F..%2Fetc%2Fpasswd/image");
    expect(res.status).toBe(404);
  });
});

describe("worker", () => {
  it("marks screenshots FAILED when the extractor is offline, and retry re-queues", async () => {
    const { mgr, matches } = await setup();
    const up = await upload(mgr, matches[0]!.id, "SLOT_LIST", [{ buf: fakePng("w"), name: "w.png" }]);
    expect(await runWorkerOnce()).toBe(1);
    const detail = await mgr.get(`/api/manager/matches/${matches[0]!.id}`);
    expect(detail.body.screenshots[0]).toMatchObject({
      status: "FAILED",
      error: "Screenshot reader is offline — enter results by hand or retry",
    });
    expect(detail.body.match.screenshotCounts).toMatchObject({ slotList: 1, failed: 1 });
    const retry = await mgr.post(`/api/manager/screenshots/${up.body.items[0].id}/retry`);
    expect(retry.status).toBe(200);
    expect(retry.body.status).toBe("QUEUED");
  });

  it("reads a team list, then lineup confirm saves rosters + a training sample", async () => {
    const { mgr, matches, teams } = await setup();
    const matchId = matches[0]!.id;
    const spy = vi.spyOn(extractor, "extract").mockResolvedValue(
      extraction("SLOT_LIST", {
        teams: [
          { slot: 3, slotConfidence: 0.99, players: NAMES.A!.map((n) => pl(n)) },
          { slot: 4, slotConfidence: 0.99, players: [pl("BravoOne"), pl("BravoTwo"), pl("BravoThree", null, 0.5)] },
          { slot: 6, slotConfidence: 0.9, players: [pl("Ghost1"), pl("Ghost2"), pl("Ghost3"), pl("Ghost4")] },
          { slot: null, slotConfidence: 0, players: [pl("Lonely")] },
        ],
      }),
    );
    await upload(mgr, matchId, "SLOT_LIST", [{ buf: fakePng("lobby"), name: "lobby.png" }]);
    await runWorkerOnce();
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![2]).toBe("SLOT_LIST");

    let d = (await mgr.get(`/api/manager/matches/${matchId}`)).body;
    expect(d.match.status).toBe("LINEUP_REVIEW");
    expect(d.screenshots[0].status).toBe("DONE");
    expect(d.screenshots[0].extraction.modelVersion).toBe("test-v1");
    expect(d.teams.map((t: { slotNumber: number }) => t.slotNumber)).toEqual([3, 4, 6]);
    const s4 = d.teams.find((t: { slotNumber: number }) => t.slotNumber === 4);
    expect(s4.team.id).toBe(teams.B!.id);
    expect(s4.flags.join(" ")).toMatch(/Check the spelling of "BravoThree"/);
    expect(s4.flags.join(" ")).toMatch(/3 players/);
    const s6 = d.teams.find((t: { slotNumber: number }) => t.slotNumber === 6);
    expect(s6.team).toBeNull();
    expect(s6.flags[0]).toBe("Slot 6 has no registered team");
    expect(d.warnings.join(" ")).toMatch(/Team C \(slot 5\) isn't in the lineup/);
    expect(d.warnings.join(" ")).toMatch(/Couldn't read the slot number.*Lonely/);

    // manager fixes + confirms
    const conf = await mgr.put(`/api/manager/matches/${matchId}/lineup`).send(lineupBody(true));
    expect(conf.status).toBe(200);
    d = conf.body;
    expect(d.match.status).toBe("LIVE");
    expect(d.teams).toHaveLength(3);
    const fixed = d.teams.find((t: { slotNumber: number }) => t.slotNumber === 4);
    expect(fixed.players[2]).toMatchObject({ name: "BravoThree", ocrName: "BravoThree" });

    const roster = await prisma.teamPlayer.findMany({ where: { teamId: teams.B!.id }, orderBy: { position: "asc" } });
    expect(roster.map((r) => r.ign)).toEqual(NAMES.B);

    const samples = await prisma.trainingSample.findMany();
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({ kind: "SLOT_LIST", source: "MANAGER_CORRECTION", verified: true, split: splitForSha(samples[0]!.sha256) });
    expect((samples[0]!.labels as { teams: { slot: number }[] }).teams.map((t) => t.slot)).toEqual([3, 4]);

    // later team list screenshots don't touch the confirmed lineup
    spy.mockResolvedValue(extraction("SLOT_LIST", { teams: [{ slot: 3, slotConfidence: 1, players: [pl("Intruder")] }] }));
    await upload(mgr, matchId, "SLOT_LIST", [{ buf: fakePng("lobby2"), name: "lobby2.png" }]);
    await runWorkerOnce();
    d = (await mgr.get(`/api/manager/matches/${matchId}`)).body;
    expect(d.teams.find((t: { slotNumber: number }) => t.slotNumber === 3).players[0].name).toBe("AlphaOne");

    // team sees the roster
    const r = await teams.B!.agent.get("/api/team/roster");
    expect(r.body.players.map((p: { ign: string }) => p.ign)).toEqual(NAMES.B);
  });

  it("merges results screenshots (deduping repeated ranks) and publishes with training samples", async () => {
    const { mgr, matches } = await setup();
    const matchId = matches[0]!.id;
    await mgr.put(`/api/manager/matches/${matchId}/lineup`).send(lineupBody(true));
    const rowsFor = (k: "A" | "B" | "C", kills: number[]) => NAMES[k]!.map((n, i) => pl(n, kills[i]!));
    const spy = vi.spyOn(extractor, "extract");
    spy.mockResolvedValueOnce(
      extraction("RESULTS", {
        rows: [
          { rank: 1, rankConfidence: 0.99, inferredSlot: 4, players: rowsFor("B", [3, 2, 1, 0]) },
          { rank: 2, rankConfidence: 0.99, inferredSlot: null, players: rowsFor("C", [1, 1, 0, 0]) },
        ],
      }),
    );
    spy.mockResolvedValueOnce(
      extraction("RESULTS", {
        rows: [
          { rank: 1, rankConfidence: 0.99, inferredSlot: 4, players: rowsFor("B", [3, 2, 1, 0]) },
          { rank: 2, rankConfidence: 0.99, inferredSlot: 5, players: rowsFor("C", [1, 1, 0, 0]) },
          { rank: 3, rankConfidence: 0.9, inferredSlot: null, players: rowsFor("A", [0, 0, 1, 0]) },
          { rank: 4, rankConfidence: 0.9, inferredSlot: null, players: [pl("Unknown Guy", 2)] },
        ],
      }),
    );
    await upload(mgr, matchId, "RESULTS", [{ buf: fakePng("r1"), name: "r1.png" }]);
    await runWorkerOnce();
    await upload(mgr, matchId, "RESULTS", [{ buf: fakePng("r2"), name: "r2.png" }]);
    await runWorkerOnce();
    // roster for results = the lineup
    const roster = spy.mock.calls[0]![3]!;
    expect(roster.map((r) => r.slot)).toEqual([3, 4, 5]);
    expect(roster[0]!.players).toEqual(NAMES.A);

    const d = (await mgr.get(`/api/manager/matches/${matchId}`)).body;
    expect(d.match.status).toBe("RESULTS_REVIEW");
    const bySlot = (s: number) => d.teams.find((t: { slotNumber: number }) => t.slotNumber === s);
    expect(bySlot(4)).toMatchObject({ placement: 1, kills: 6 });
    expect(bySlot(5)).toMatchObject({ placement: 2, kills: 2 });
    expect(bySlot(3)).toMatchObject({ placement: 3, kills: 1 });
    expect(bySlot(3).players.map((p: { kills: number }) => p.kills)).toEqual([0, 0, 1, 0]);
    expect(d.warnings.join(" ")).toMatch(/Couldn't match rank 4 .*Unknown Guy/);

    const pub = await mgr.post(`/api/manager/matches/${matchId}/publish`);
    expect(pub.status).toBe(200);
    expect(pub.body.match.status).toBe("PUBLISHED");
    expect(bySlotOf(pub.body, 4)).toMatchObject({ placementPoints: 10, killPoints: 6, totalPoints: 16 });

    const samples = await prisma.trainingSample.findMany({ where: { kind: "RESULTS" }, orderBy: { createdAt: "asc" } });
    expect(samples).toHaveLength(2);
    const labels = samples.map((s) => (s.labels as { rows: { rank: number }[] }).rows.map((r) => r.rank));
    expect(labels).toEqual(expect.arrayContaining([[1, 2], [1, 2, 3]]));
  });
});

const bySlotOf = (d: { teams: { slotNumber: number }[] }, s: number) => d.teams.find((t) => t.slotNumber === s);

describe("publish, standings, team access", () => {
  it("validates placements before publishing", async () => {
    const { mgr, matches } = await setup();
    const id = matches[0]!.id;
    await mgr.put(`/api/manager/matches/${id}/lineup`).send(lineupBody(true));
    await mgr.put(`/api/manager/matches/${id}/results`).send({ teams: [{ slotNumber: 3, placement: 1, kills: 2 }, { slotNumber: 4, placement: 1, kills: 0 }] });
    const res = await mgr.post(`/api/manager/matches/${id}/publish`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.fields).toMatchObject({
      "teams.3.placement": expect.stringMatching(/more than once/),
      "teams.5.placement": expect.stringMatching(/Enter a placement/),
    });
    const tooHigh = await mgr.put(`/api/manager/matches/${id}/results`).send({
      teams: [{ slotNumber: 3, placement: 1, kills: 2 }, { slotNumber: 4, placement: 2, kills: 0 }, { slotNumber: 5, placement: 9, kills: 0 }],
    });
    expect(tooHigh.status).toBe(200);
    expect((await mgr.post(`/api/manager/matches/${id}/publish`)).body.error.fields["teams.5.placement"]).toMatch(/more than the number of teams/);
    // unknown slot in results
    const unknown = await mgr.put(`/api/manager/matches/${id}/results`).send({ teams: [{ slotNumber: 9, placement: 1, kills: 0 }] });
    expect(unknown.status).toBe(400);
  });

  it("computes standings with tie-breakers; unpublish/republish and points changes recompute", async () => {
    const { mgr, scrim, matches, teams } = await setup();
    // A: 1st 0 kills = 10 ; B: 2nd 4 kills = 10 ; C: 3rd 0 kills = 5 → A wins the tie on chicken dinners
    const m1 = await playMatch(mgr, matches[0]!.id, { A: [1, 0], B: [2, 4], C: [3, 0] });
    expect(bySlotOf(m1, 3)).toMatchObject({ totalPoints: 10 });
    expect(bySlotOf(m1, 4)).toMatchObject({ placementPoints: 6, killPoints: 4, totalPoints: 10 });

    const url = `/api/manager/scrims/${scrim.id}/sessions/${yesterday()}/standings`;
    let st = (await mgr.get(url)).body;
    expect(st.rows.map((r: { team: { name: string }; rank: number }) => [r.team.name, r.rank])).toEqual([
      ["Team A", 1],
      ["Team B", 2],
      ["Team C", 3],
    ]);
    expect(st.rows[0]).toMatchObject({ wins: 1, slotNumber: 3, perMatch: { 1: { placement: 1, kills: 0, totalPoints: 10 }, 2: null } });
    expect(st.matches.map((m: { status: string }) => m.status)).toEqual(["PUBLISHED", "SCHEDULED"]);
    expect(st.updatedAt).not.toBeNull();

    // unpublish → no longer counts; fix → republish recomputes
    const un = await mgr.post(`/api/manager/matches/${matches[0]!.id}/unpublish`);
    expect(un.body.match.status).toBe("RESULTS_REVIEW");
    expect((await mgr.get(url)).body.rows).toEqual([]);
    await mgr.put(`/api/manager/matches/${matches[0]!.id}/results`).send({ teams: [{ slotNumber: 4, placement: 2, kills: 6 }] });
    await mgr.post(`/api/manager/matches/${matches[0]!.id}/publish`);
    st = (await mgr.get(url)).body;
    expect(st.rows[0]).toMatchObject({ team: { name: "Team B" }, totalPoints: 12 });

    // points system change recomputes stored points + standings
    await mgr.patch(`/api/manager/scrims/${scrim.id}`).send({ pointsSystem: { placement: [20, 10, 5], killPoints: 1 } });
    st = (await mgr.get(url)).body;
    expect(st.rows[0]).toMatchObject({ team: { name: "Team A" }, totalPoints: 20 });
    const stored = await prisma.matchTeam.findFirst({ where: { matchId: matches[0]!.id, slotNumber: 3 } });
    expect(stored!.totalPoints).toBe(20);

    // team views
    const A = teams.A!.agent;
    const res = await A.get("/api/team/results");
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      expect.objectContaining({ date: yesterday(), rank: 1, teamsCount: 3, totalPoints: 20, wins: 1, matchesPublished: 1, matchesTotal: 2, slotNumber: 3 }),
    ]);
    const tst = await A.get(`/api/team/sessions/${scrim.id}/${yesterday()}/standings`);
    expect(tst.status).toBe(200);
    expect(tst.body.rows).toHaveLength(3);
    const card = await A.get(`/api/team/matches/${matches[0]!.id}`);
    expect(card.status).toBe(200);
    expect(card.body.teams.map((t: { rank: number }) => t.rank)).toEqual([1, 2, 3]);
    expect(card.body.teams[0].players).toHaveLength(4);
    // unpublished match isn't visible
    expect((await A.get(`/api/team/matches/${matches[1]!.id}`)).status).toBe(404);

    const dash = await A.get("/api/team/dashboard");
    expect(dash.body.results).toMatchObject({ sessionsPlayed: 1, matchesPlayed: 1, wins: 1, bestRank: 1, totalKills: 0 });

    // team D never played: 403
    const D = teams.D!.agent;
    expect((await D.get(`/api/team/sessions/${scrim.id}/${yesterday()}/standings`)).status).toBe(403);
    expect((await D.get(`/api/team/matches/${matches[0]!.id}`)).status).toBe(403);
    expect((await D.get(`/api/team/results`)).body.items).toEqual([]);
    expect((await D.get("/api/team/dashboard")).body.results).toBeNull();

    // published matches are locked
    expect((await mgr.put(`/api/manager/matches/${matches[0]!.id}/lineup`).send(lineupBody(false))).status).toBe(409);
  });
});

describe("team roster", () => {
  it("saves up to 6 players and suggests names from confirmed lineups", async () => {
    const { mgr, matches, teams } = await setup();
    const A = teams.A!.agent;
    expect((await A.get("/api/team/roster")).body).toEqual({ players: [], suggestions: [] });
    const saved = await A.put("/api/team/roster").send({ players: [{ ign: "AlphaOne", bgmiId: "5123456789" }, { ign: "NewGuy" }] });
    expect(saved.status).toBe(200);
    expect(saved.body.players).toEqual([
      { id: expect.any(String), ign: "AlphaOne", bgmiId: "5123456789" },
      { id: expect.any(String), ign: "NewGuy", bgmiId: null },
    ]);
    const tooMany = await A.put("/api/team/roster").send({ players: Array.from({ length: 7 }, (_, i) => ({ ign: `P${i}` })) });
    expect(tooMany.status).toBe(400);
    expect((await A.put("/api/team/roster").send({ players: [{ ign: "X" }, { ign: "x" }] })).status).toBe(400);

    await mgr.put(`/api/manager/matches/${matches[0]!.id}/lineup`).send(lineupBody(true));
    // confirm added the lineup names that weren't on the roster (up to 6)
    const r = (await A.get("/api/team/roster")).body;
    expect(r.players.map((p: { ign: string }) => p.ign)).toEqual(["AlphaOne", "NewGuy", "AlphaTwo", "AlphaThree", "AlphaFour"]);
    await A.put("/api/team/roster").send({ players: [{ ign: "AlphaOne" }] });
    expect((await A.get("/api/team/roster")).body.suggestions).toEqual(["AlphaFour", "AlphaThree", "AlphaTwo"]);
  });
});

describe("admin training center", () => {
  it("uploads, lists, edits and deletes samples; proxies fail gracefully offline", async () => {
    const admin = await adminAgent();
    const labels = { teams: [{ slot: 5, players: ["A9xTARUN", "A9xRolf"] }] };
    const bad = await admin
      .post("/api/admin/training/samples")
      .field("kind", "SLOT_LIST")
      .field("labels", JSON.stringify({ teams: [{ slot: 0, players: [] }] }))
      .attach("file", fakePng("s1"), { filename: "s.png", contentType: "image/png" });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields)[0]).toMatch(/^labels\./);

    const created = await admin
      .post("/api/admin/training/samples")
      .field("kind", "SLOT_LIST")
      .field("labels", JSON.stringify(labels))
      .attach("file", fakePng("s1"), { filename: "s.png", contentType: "image/png" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ kind: "SLOT_LIST", source: "ADMIN_UPLOAD", verified: false, nameCount: 2 });
    expect(["TRAIN", "TEST"]).toContain(created.body.split);

    const dup = await admin
      .post("/api/admin/training/samples")
      .field("kind", "SLOT_LIST")
      .field("labels", JSON.stringify(labels))
      .attach("file", fakePng("s1"), { filename: "s.png", contentType: "image/png" });
    expect(dup.status).toBe(409);

    const id = created.body.id;
    expect((await admin.get("/api/admin/training/samples?kind=SLOT_LIST&q=rolf")).body.items).toHaveLength(1);
    expect((await admin.get("/api/admin/training/samples?kind=RESULTS")).body.items).toHaveLength(0);
    const detail = await admin.get(`/api/admin/training/samples/${id}`);
    expect(detail.body).toMatchObject({ labels, width: 1600, height: 720 });
    const img = await admin.get(`/api/admin/training/samples/${id}/image`);
    expect(img.headers["content-type"]).toBe("image/png");

    const patched = await admin.patch(`/api/admin/training/samples/${id}`).send({ split: "TEST", excluded: true, notes: "blurry" });
    expect(patched.body).toMatchObject({ split: "TEST", excluded: true, notes: "blurry" });
    const badLabels = await admin.patch(`/api/admin/training/samples/${id}`).send({ labels: { rows: [{ rank: 1, players: [{ name: "x", kills: 1 }] }] } });
    expect(badLabels.status).toBe(400);

    // reader offline (tests point CLAUDE_BIN at a missing binary)
    const status = await admin.get("/api/admin/extractor/status");
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ online: false, activeModel: null, queue: { queued: 0, processing: 0, failedLast24h: 0 } });
    const prev = await admin.post("/api/admin/training/preview").field("kind", "RESULTS").attach("file", fakePng("p"), { filename: "p.png", contentType: "image/png" });
    expect(prev.status).toBe(503);

    expect((await admin.delete(`/api/admin/training/samples/${id}`)).status).toBe(204);
    expect((await admin.get(`/api/admin/training/samples/${id}`)).status).toBe(404);
  });

  it("prefills sample labels from the reader", async () => {
    const admin = await adminAgent();
    const mk = (salt: string) =>
      admin
        .post("/api/admin/training/samples")
        .field("kind", "RESULTS")
        .field("labels", JSON.stringify({ rows: [{ rank: 1, players: [{ name: "Ace", kills: 3 }] }] }))
        .field("split", "TRAIN")
        .attach("file", fakePng(salt), { filename: `${salt}.png`, contentType: "image/png" });
    const a = (await mk("a")).body;
    vi.spyOn(extractor, "extract").mockResolvedValue(
      extraction("RESULTS", { rows: [{ rank: 2, rankConfidence: 0.9, inferredSlot: null, players: [pl("Bob", 4)] }] }),
    );
    const pre = await admin.post(`/api/admin/training/samples/${a.id}/prefill`);
    expect(pre.status).toBe(200);
    expect(pre.body).toMatchObject({ verified: false, labels: { rows: [{ rank: 2, players: [{ name: "Bob", kills: 4 }] }] } });
  });
});
