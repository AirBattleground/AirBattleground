/**
 * Studio link: a standalone 7XEN Studio app connected with a Studio worker key. Key auth, account, matches, outputs,
 * broadcasts in box mode (targets = stream keys + Live page copy), heartbeat → stop, screenshots to own matches.
 * YouTube is mocked (not connected in tests).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const yt = vi.hoisted(() => ({ on: false, ended: [] as string[] }));
vi.mock("../src/services/youtube.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/services/youtube.js")>();
  return {
    ...orig,
    startShowBroadcast: vi.fn(async (show: { title: string; matchId: string | null }) =>
      yt.on ? { broadcastId: "yt_link1", title: show.title, watchUrl: "https://youtu.be/yt_link1", target: "rtmp://a.rtmp.youtube.com/live2/yt-ingest-key" } : orig.startShowBroadcast(show),
    ),
    endMatchBroadcast: vi.fn(async (id: string) => void yt.ended.push(id)),
    getYoutubeStatus: vi.fn(async () => {
      const real = await orig.getYoutubeStatus();
      return yt.on ? { ...real, connected: true, autoStream: true, channel: { ...(real.channel ?? {}), title: "Test channel", url: "https://youtube.com/@test" } } : real;
    }),
  };
});

const { showRunsOnBox } = await import("../src/services/studio.js");
const { extractor } = await import("../src/lib/extractor.js");
const { runLiveCaptureOnce, sweepLiveCaptures } = await import("../src/services/liveCapture.js");
const { adminAgent, createAdminUser, createManager, createScrim, createTeam, http, joinTeam, playerAgent, prisma, resetDb, server, tomorrow, yesterday } = await import(
  "./helpers.js"
);
type TestAgent = Awaited<ReturnType<typeof createManager>>["agent"];

function fakePng(salt: string, w = 1600, h = 720): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "ascii");
  ihdr.writeUInt32BE(w, 8);
  ihdr.writeUInt32BE(h, 12);
  return Buffer.concat([sig, ihdr, Buffer.from(salt)]);
}

let mgr: TestAgent;
let key: string;
let destId: string;
const get = (path: string, k = key) => http().get(`/api/studio-link${path}`).set("X-Studio-Key", k);
const post = (path: string, body: object = {}, k = key) => http().post(`/api/studio-link${path}`).set("X-Studio-Key", k).send(body);

async function firstMatchId(agent: TestAgent): Promise<string> {
  const today = await agent.get("/api/manager/live/today?days=0");
  expect(today.body.items.length).toBeGreaterThan(0);
  return today.body.items[0].matchId as string;
}

beforeEach(async () => {
  yt.on = false;
  yt.ended = [];
  vi.clearAllMocks();
  await resetDb();
  await createAdminUser();
  mgr = (await createManager(await adminAgent())).agent;
  const w = await mgr.post("/api/manager/studio/workers").send({ name: "Venue PC" });
  key = w.body.key;
  const d = await mgr.post("/api/manager/stream/destinations").send({ kind: "CUSTOM", name: "My Twitch", url: "rtmp://live.example.com/app/", streamKey: "secret-key-123" });
  expect(d.status).toBe(201);
  destId = d.body.id;
});
afterAll(async () => {
  await prisma.$disconnect();
  server.close();
});

describe("studio link", () => {
  it("rejects a missing or unknown key; accepts X-Worker-Key too; a call marks the studio online", async () => {
    expect((await http().get("/api/studio-link/me")).status).toBe(401);
    const bad = await get("/me", "sw_nope");
    expect(bad.status).toBe(401);
    expect(bad.body.error).toMatchObject({ code: "UNAUTHENTICATED", message: "Unknown studio key" });
    expect((await mgr.get("/api/manager/studio/workers")).body.items[0].online).toBe(false);
    expect((await http().get("/api/studio-link/me").set("X-Worker-Key", key)).status).toBe(200);
    expect((await mgr.get("/api/manager/studio/workers")).body.items[0].online).toBe(true);
  });

  it("/me: manager name, org null when none", async () => {
    const me = await get("/me");
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ manager: { name: expect.stringMatching(/^Manager /) }, org: null });
  });

  it("/matches lists the manager's scrim matches", async () => {
    await createScrim(mgr, { title: "Night Scrim" });
    const res = await get("/matches");
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.length).toBeLessThanOrEqual(100);
    const m = res.body.items.find((x: { title: string }) => x.title === "Night Scrim");
    expect(m).toMatchObject({ id: expect.any(String), title: "Night Scrim", subtitle: expect.any(String), status: "upcoming" });
    expect(m.startsAt === null || typeof m.startsAt === "string").toBe(true);
    // another manager's studio doesn't see them
    const other = (await createManager(await adminAgent())).agent;
    const k2 = (await other.post("/api/manager/studio/workers").send({ name: "Other" })).body.key;
    expect((await get("/matches", k2)).body.items).toEqual([]);
  });

  it("/matches: each match has its own start, unlocksAt = registration close, drafts aren't listed", async () => {
    await createScrim(mgr, { title: "Plan Scrim", maps: ["ERANGEL", "MIRAMAR"], startTime: "21:00", matchTimes: ["21:00", "21:45"], registrationCloseMinutes: 30 });
    await createScrim(mgr, { title: "Draft Scrim", published: false });
    const items = (await get("/matches")).body.items as { title: string; subtitle: string; startsAt: string; control: { unlocksAt: string | null; reason: string | null } }[];
    expect(items.some((m) => m.title === "Draft Scrim")).toBe(false);
    const day = items.filter((m) => m.title === "Plan Scrim" && m.subtitle.includes("Match")).filter((m) => new Date(m.startsAt) > new Date());
    const m1 = day.find((m) => m.subtitle.endsWith("Match 1") && m.control.unlocksAt !== null)!;
    const m2 = day.find((m) => m.subtitle.endsWith("Match 2") && m.subtitle.split(" · ")[0] === m1.subtitle.split(" · ")[0])!;
    expect(new Date(m2.startsAt).getTime() - new Date(m1.startsAt).getTime()).toBe(45 * 60_000);
    expect(new Date(m1.startsAt).getTime() - new Date(m1.control.unlocksAt!).getTime()).toBe(30 * 60_000);
    expect(m1.control.reason).toMatch(/^Registration is open until 8:30 PM/);
  });

  it("/outputs: live page, no site YouTube, the manager's stream keys", async () => {
    const res = await get("/outputs");
    expect(res.body).toEqual({ livePage: true, siteYoutube: null, destinations: [{ id: destId, name: "My Twitch", kind: "CUSTOM" }] });
  });

  it("broadcast: box mode, stream-key + live-page targets, listed live, heartbeat, website stop → stop, /stop", async () => {
    await createScrim(mgr);
    const matchId = await firstMatchId(mgr);
    const res = await post("/broadcasts", { matchId, title: "Finals live", livePage: true, siteYoutube: true, destinationIds: [destId] });
    expect(res.status).toBe(201);
    const id = res.body.id as string;
    expect(showRunsOnBox(id)).toBe(true);
    expect(res.body.targets[0]).toEqual({ id: destId, name: "My Twitch", url: "rtmp://live.example.com/app/secret-key-123" });
    expect(res.body.targets[1]).toMatchObject({ id: "live-page", name: "AirBattleground Live page" });
    expect(res.body.targets[1].url).toMatch(new RegExp(`/show_${id}\\?wtoken=`));
    expect(res.body.targets).toHaveLength(2);
    expect(res.body.watchUrl).toBe(`http://localhost:5173/watch/s_${id}`);

    const live = await http().get("/api/live/");
    const card = live.body.items.find((c: { matchId: string }) => c.matchId === `s_${id}`);
    expect(card).toMatchObject({ title: "Finals live", studio: true });
    expect(card.youtubeVideoId).toBeUndefined();

    // busy: a second broadcast on the same studio is refused
    expect((await post("/broadcasts", { matchId: null, title: "Another" })).status).toBe(409);

    const hb = await post(`/broadcasts/${id}/heartbeat`, { state: "live", fps: 30, bitrateKbps: 6000 });
    expect(hb.body).toEqual({ stop: false });
    const status = await mgr.get(`/api/manager/studio/shows/${id}/status`);
    expect(status.body).toMatchObject({ runOn: "worker", state: "LIVE", receiving: true, destinations: [{ id: destId, ok: true }] });
    const workers = await mgr.get("/api/manager/studio/workers");
    expect(workers.body.items[0]).toMatchObject({ online: true, showId: id, state: "live" });

    expect((await mgr.post(`/api/manager/studio/shows/${id}/stop`)).status).toBe(200);
    expect((await post(`/broadcasts/${id}/heartbeat`, { state: "live", fps: 30, bitrateKbps: 6000 })).body).toEqual({ stop: true });

    // a new broadcast, ended by the app
    const b2 = await post("/broadcasts", { matchId: null, title: "Practice", livePage: false, siteYoutube: false, destinationIds: [] });
    expect(b2.status).toBe(201);
    expect(b2.body.targets).toEqual([]);
    expect(b2.body.watchUrl).toBeNull();
    expect((await post(`/broadcasts/${b2.body.id}/stop`)).status).toBe(204);
    const show = await prisma.studioShow.findUniqueOrThrow({ where: { id: b2.body.id } });
    expect(show.state).toBe("ENDED");
    expect((await post(`/broadcasts/${b2.body.id}/heartbeat`, { state: "live" })).body).toEqual({ stop: true });
  });

  it("broadcast on the site YouTube channel: YouTube ingest target, no live-page target, Live embeds the video", async () => {
    yt.on = true;
    const res = await post("/broadcasts", { matchId: null, title: "YT show", livePage: true, siteYoutube: true, destinationIds: [] });
    expect(res.status).toBe(201);
    expect(res.body.targets).toEqual([{ id: "site-youtube", name: "AirBattleground YouTube", url: "rtmp://a.rtmp.youtube.com/live2/yt-ingest-key" }]);
    expect(res.body.watchUrl).toBe("https://youtu.be/yt_link1");
    const live = await http().get("/api/live/");
    expect(live.body.items[0]).toMatchObject({ matchId: `s_${res.body.id}`, youtubeVideoId: "yt_link1" });
    expect((await post(`/broadcasts/${res.body.id}/stop`)).status).toBe(204);
    expect(yt.ended).toEqual(["yt_link1"]);
  });

  it("public streams are visible to all: on the site YouTube channel it's listed on Live even with the Live page off", async () => {
    yt.on = true;
    const res = await post("/broadcasts", { matchId: null, title: "Public YT show", livePage: false, siteYoutube: true, destinationIds: [] });
    expect(res.status).toBe(201);
    expect(res.body.targets.map((t: { id: string }) => t.id)).toEqual(["site-youtube"]);
    // signed out: anyone can see it, playing the YouTube video
    const live = await http().get("/api/live/");
    expect(live.body.items).toEqual([expect.objectContaining({ matchId: `s_${res.body.id}`, youtubeVideoId: "yt_link1" })]);
    expect((await post(`/broadcasts/${res.body.id}/stop`)).status).toBe(204);
  });

  it("without YouTube and with the Live page off, the broadcast stays off the public Live page", async () => {
    yt.on = false;
    const res = await post("/broadcasts", { matchId: null, title: "Private show", livePage: false, siteYoutube: false, destinationIds: [] });
    expect(res.status).toBe(201);
    expect((await http().get("/api/live/")).body.items).toEqual([]);
    expect((await post(`/broadcasts/${res.body.id}/stop`)).status).toBe(204);
  });

  it("broadcast of another manager's match is refused; their broadcasts are 404", async () => {
    const other = (await createManager(await adminAgent())).agent;
    await createScrim(other);
    const theirMatch = await firstMatchId(other);
    expect((await post("/broadcasts", { matchId: theirMatch, title: "Nope" })).status).toBe(400);
    expect((await post("/broadcasts/nope/heartbeat", { state: "live" })).status).toBe(404);
  });

  it("screenshots: own match ok, another manager's match 404", async () => {
    await createScrim(mgr);
    const mine = await firstMatchId(mgr);
    const up = await http()
      .post(`/api/studio-link/matches/${mine}/screenshots`)
      .set("X-Studio-Key", key)
      .field("kind", "RESULTS")
      .attach("files", fakePng("link-a"), { filename: "results.png", contentType: "image/png" });
    expect(up.status).toBe(201);
    expect(up.body).toEqual({ count: 1 });
    expect(await prisma.screenshot.count({ where: { matchId: mine, kind: "RESULTS" } })).toBe(1);

    const other = (await createManager(await adminAgent())).agent;
    await createScrim(other);
    const theirs = await firstMatchId(other);
    const no = await http()
      .post(`/api/studio-link/matches/${theirs}/screenshots`)
      .set("X-Studio-Key", key)
      .field("kind", "SLOT_LIST")
      .attach("files", fakePng("link-b"), { filename: "slots.png", contentType: "image/png" });
    expect(no.status).toBe(404);
  });

  describe("live team status", () => {
    const NAMES = ["SoulMortal", "SoulRegal", "SoulViper", "SoulOwais"];

    /** Scrim match with team SOUL (4 members) on slot 3 and team SOLO (leader only) on slot 4. */
    async function liveSetup() {
      const scrim = await createScrim(mgr);
      const soul = await createTeam(null, "SOUL", NAMES[0]);
      for (const ign of NAMES.slice(1)) await joinTeam(soul, await playerAgent(ign));
      const solo = await createTeam(null, "SOLO", "SoloOne");
      const session = await prisma.scrimSession.create({ data: { scrimId: scrim.id, date: new Date(`${yesterday()}T00:00:00.000Z`) } });
      await prisma.registration.create({ data: { sessionId: session.id, teamId: solo.row.id, status: "APPROVED", slotNumber: 4 } });
      await prisma.registration.create({ data: { sessionId: session.id, teamId: soul.row.id, status: "APPROVED", slotNumber: 3 } });
      const list = await mgr.get(`/api/manager/scrims/${scrim.id}/sessions/${yesterday()}/matches`);
      return { matchId: list.body.items[0].id as string, soul: soul.row.id, solo: solo.row.id, sessionId: session.id };
    }
    const confirmLineup = (matchId: string) =>
      mgr.put(`/api/manager/matches/${matchId}/lineup`).send({
        confirm: true,
        teams: [
          { slotNumber: 3, players: NAMES.map((name, i) => ({ position: i + 1, name })) },
          { slotNumber: 4, players: [{ position: 1, name: "SoloOne" }] },
        ],
      });

    it("before the match: every team alive, sorted by slot; ETag + 304; 404 unknown, 403 another manager's match", async () => {
      const { matchId, soul, solo } = await liveSetup();
      const res = await get(`/matches/${matchId}/live`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        version: 1,
        updatedAt: expect.stringMatching(/Z$/),
        match: {
          id: matchId,
          title: "Test Scrim - Match 1",
          state: "scheduled",
          startsAt: `${yesterday()}T15:30:00.000Z`, // 9:00 PM IST
          liveAt: null,
          round: null,
          matchNumber: 1,
          map: "Erangel",
        },
      });
      expect(res.body.summary).toBeUndefined();
      expect(res.body.winner).toBeUndefined();
      // before the match every team shows a full squad, all alive, no score
      expect(res.body.teams).toEqual([
        { id: soul, slot: 3, name: "SOUL", status: 4, kills: 0, totalPoints: 0, players: NAMES.map((name) => ({ name, state: "alive" })) },
        { id: solo, slot: 4, name: "SOLO", status: 4, kills: 0, totalPoints: 0, players: [{ name: "SoloOne", state: "alive" }, { state: "alive" }, { state: "alive" }, { state: "alive" }] },
      ]);
      expect(res.headers.etag).toBe('"1"');
      expect((await get(`/matches/${matchId}/live`).set("If-None-Match", '"1"')).status).toBe(304);
      expect((await get(`/matches/${matchId}/live`).set("If-None-Match", "1")).status).toBe(304);
      expect((await get(`/matches/${matchId}/live`).set("If-None-Match", "0")).status).toBe(200);

      expect((await get("/matches/nope/live")).status).toBe(404);
      const other = (await createManager(await adminAgent())).agent;
      const k2 = (await other.post("/api/manager/studio/workers").send({ name: "Other" })).body.key;
      const no = await get(`/matches/${matchId}/live`, k2);
      expect(no.status).toBe(403);
      expect(no.body.error.message).toEqual(expect.any(String));
      expect((await get(`/matches/${matchId}/live`, "sw_nope")).status).toBe(401);

      // marking players needs a confirmed team list
      expect((await mgr.patch(`/api/manager/matches/${matchId}/team-status`).send({ teamId: soul, players: ["knocked"] })).status).toBe(409);
    });

    it("during the match: the manager marks players, the board follows; eliminated teams stay; new teams appear", async () => {
      const { matchId, soul, solo, sessionId } = await liveSetup();
      const v1 = (await get(`/matches/${matchId}/live`)).body.version as number;
      expect((await confirmLineup(matchId)).status).toBe(200);

      const saved = await mgr.patch(`/api/manager/matches/${matchId}/team-status`).send({ teamId: soul, players: ["alive", "alive", "knocked", "eliminated"] });
      expect(saved.status).toBe(200);
      expect(saved.body.match.state).toBe("live");
      expect(saved.body.match.liveAt).toEqual(expect.stringMatching(/Z$/));
      expect(saved.body.version).toBeGreaterThan(v1);

      const res = await get(`/matches/${matchId}/live`).set("If-None-Match", `"${v1}"`);
      expect(res.status).toBe(200);
      expect(res.body.version).toBe(saved.body.version);
      expect(res.body.teams[0]).toMatchObject({
        id: soul,
        status: 2,
        players: [
          { name: "SoulMortal", state: "alive" },
          { name: "SoulRegal", state: "alive" },
          { name: "SoulViper", state: "knocked" },
          { name: "SoulOwais", state: "eliminated" },
        ],
      });

      // whole team out: row stays, status 0
      await mgr.patch(`/api/manager/matches/${matchId}/team-status`).send({ teamId: solo, players: ["eliminated"] });
      const out = await get(`/matches/${matchId}/live`);
      expect(out.body.teams).toHaveLength(2);
      expect(out.body.teams[1]).toMatchObject({ id: solo, status: 0, players: [{ name: "SoloOne", state: "eliminated" }] });

      // a team registered mid-match shows up on the next poll, with a new version
      const late = await createTeam(null, "LATE", "LateOne");
      await prisma.registration.create({ data: { sessionId, teamId: late.row.id, status: "APPROVED", slotNumber: 5 } });
      const grown = await get(`/matches/${matchId}/live`).set("If-None-Match", `"${out.body.version}"`);
      expect(grown.status).toBe(200);
      expect(grown.body.version).toBe(out.body.version + 1);
      expect(grown.body.teams.map((t: { slot: number }) => t.slot)).toEqual([3, 4, 5]);
      // it didn't join the lobby the lineup was read from, so it has no players on the board
      expect(grown.body.teams[2]).toMatchObject({ name: "LATE", status: 0, players: [] });

      // kills (FIN.) and total points: points follow the kills until the manager sets them, null goes back
      const fin = await mgr.patch(`/api/manager/matches/${matchId}/team-status`).send({ teamId: soul, kills: 5 });
      expect(fin.status).toBe(200);
      expect(fin.body.teams[0]).toMatchObject({ kills: 5, totalPoints: 5, status: 2 });
      expect((await mgr.patch(`/api/manager/matches/${matchId}/team-status`).send({ teamId: soul, totalPoints: 12 })).body.teams[0]).toMatchObject({ kills: 5, totalPoints: 12 });
      const lateFin = await mgr.patch(`/api/manager/matches/${matchId}/team-status`).send({ teamId: late.row.id, kills: 2 }); // no lineup row yet
      expect(lateFin.body.teams[2]).toMatchObject({ kills: 2, totalPoints: 2 });
      const back = await get(`/matches/${matchId}/live`);
      expect(back.body.version).toBeGreaterThan(grown.body.version);
      expect((await mgr.patch(`/api/manager/matches/${matchId}/team-status`).send({ teamId: soul, totalPoints: null })).body.teams[0]).toMatchObject({ totalPoints: 5 });

      // bad input
      expect((await mgr.patch(`/api/manager/matches/${matchId}/team-status`).send({ teamId: soul })).status).toBe(400);
      expect((await mgr.patch(`/api/manager/matches/${matchId}/team-status`).send({ teamId: soul, kills: -1 })).status).toBe(400);
      expect((await mgr.patch(`/api/manager/matches/${matchId}/team-status`).send({ teamId: "nope", players: ["alive"] })).status).toBe(404);
      expect((await mgr.patch(`/api/manager/matches/${matchId}/team-status`).send({ teamId: soul, players: ["dead"] })).status).toBe(400);
      expect((await mgr.patch(`/api/manager/matches/${matchId}/team-status`).send({ teamId: soul, players: [] })).status).toBe(400);
    });

    it("after the match: summary (+ MVP) while results are reviewed, winner once published; final state stays", async () => {
      const { matchId, soul } = await liveSetup();
      await confirmLineup(matchId);
      await mgr.patch(`/api/manager/matches/${matchId}/team-status`).send({ teamId: soul, players: ["alive", "eliminated", "eliminated", "eliminated"] });
      const r = await mgr.put(`/api/manager/matches/${matchId}/results`).send({
        teams: [
          { slotNumber: 3, placement: 2, kills: null, players: [{ position: 1, kills: 6 }, { position: 2, kills: 3 }] },
          { slotNumber: 4, placement: 1, kills: 4, players: [{ position: 1, kills: 4 }] },
        ],
      });
      expect(r.status).toBe(200);
      const res = await get(`/matches/${matchId}/live`);
      expect(res.body.match.state).toBe("summary");
      expect(res.body.control.state).toBe("ended");
      expect(res.body.teams[0]).toMatchObject({ status: 1, kills: 9, totalPoints: 15 }); // #2 = 6 + 9 kills
      expect(res.body.summary).toEqual({
        teams: [
          { slot: 3, name: "SOUL", kills: 9, placement: 2, placementPoints: 6, killPoints: 9, totalPoints: 15 },
          { slot: 4, name: "SOLO", kills: 4, placement: 1, placementPoints: 10, killPoints: 4, totalPoints: 14 },
        ],
        mvp: { name: "SoulMortal", team: "SOUL", kills: 6 },
      });
      expect(res.body.winner).toBeUndefined();
      expect((await mgr.patch(`/api/manager/matches/${matchId}/team-status`).send({ teamId: soul, players: ["alive"] })).status).toBe(409);

      expect((await mgr.post(`/api/manager/matches/${matchId}/publish`)).status).toBe(200);
      const done = await get(`/matches/${matchId}/live`);
      expect(done.body.match.state).toBe("finished");
      expect(done.body.control.state).toBe("published");
      expect(done.body.winner).toEqual({ slot: 4, name: "SOLO", kills: 4, totalPoints: 14, players: [{ name: "SoloOne", kills: 4 }] });
      expect(done.body.summary.teams).toHaveLength(2);
      expect((await get(`/matches/${matchId}/live`).set("If-None-Match", `"${done.body.version}"`)).status).toBe(304);
    });

    it("polling faster than allowed gets 429 with Retry-After", async () => {
      const { matchId } = await liveSetup();
      const all = await Promise.all(Array.from({ length: 15 }, () => get(`/matches/${matchId}/live`)));
      const limited = all.find((x) => x.status === 429);
      expect(limited).toBeDefined();
      expect(Number(limited!.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    });

    describe("auto capture", () => {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      let seq = 0;
      const uuid = () => crypto.randomUUID();
      const SESSION = "0f4c2a8e-1d2b-4c3a-8e9f-7a6b5c4d3e2f";
      type Read = Awaited<ReturnType<typeof extractor.readLive>>;
      const read = (teams: Read["teams"], screen: Read["screen"] = "spectator_hud"): Read => ({ screen, teams, warnings: [], modelVersion: "test", ms: 5 });
      const team = (slot: number | null, name: string | null, players: Read["teams"][number]["players"], confidence = 0.97) => ({ slot, name, players, confidence });
      type Extraction = Awaited<ReturnType<typeof extractor.extract>>;
      const player = (name: string, kills: number | null = null) => ({ name, confidence: 0.97, source: "claude", rosterMatch: name, matchedSlot: null, kills, killsConfidence: kills == null ? null : 0.97 });
      /** what the team-list / results reader returns */
      const extraction = (screen: string, part: Partial<Extraction> = {}): Extraction => ({
        imageId: "",
        kind: "SLOT_LIST",
        modelVersion: "test",
        teams: [],
        rows: [],
        needsReview: false,
        warnings: [],
        timingsMs: {},
        screen,
        ...part,
      });
      const lobby = (teams: Record<number, string[]>): Extraction =>
        extraction("custom_lobby", { teams: Object.entries(teams).map(([slot, names]) => ({ slot: Number(slot), slotConfidence: 0.97, players: names.map((n) => player(n)) })) });
      const results = (rows: [rank: number, slot: number, names: string[]][]): Extraction =>
        extraction("custom_results", {
          kind: "RESULTS",
          rows: rows.map(([rank, slot, names]) => ({ rank, rankConfidence: 0.97, inferredSlot: slot, players: names.map((n) => player(n, 1)) })),
        });

      async function capture(matchId: string, over: Record<string, string> = {}, file = fakePng(`cap-${++seq}`), k = key) {
        let req = http().post(`/api/studio-link/matches/${matchId}/screenshots`).set("X-Studio-Key", k);
        const fields = { kind: "LIVE_STATUS", captureId: uuid(), capturedAt: new Date().toISOString(), sequence: String(seq), sessionId: SESSION, sceneName: "Game Play", ...over };
        for (const [f, v] of Object.entries(fields)) if (v !== "") req = req.field(f, v);
        return req.attach("files", file, { filename: "capture.png", contentType: "image/png" });
      }
      /** upload one capture the live reader sees as `r` (and the team-list/results reader as `ex`), run the worker */
      async function applied(matchId: string, r: Read, over: Record<string, string> = {}, ex: Extraction = extraction("other")) {
        await sleep(200); // stay under the per-match upload rate
        const live = vi.spyOn(extractor, "readLive").mockResolvedValue(r);
        const other = vi.spyOn(extractor, "readFrame").mockResolvedValue(ex);
        const up = await capture(matchId, over);
        expect(up.status).toBe(202);
        expect(await runLiveCaptureOnce()).toBe(1);
        live.mockRestore();
        other.mockRestore();
        return up.body;
      }
      const status = async (matchId: string, captureId: string) => (await get(`/matches/${matchId}/captures/${captureId}`)).body;
      const board = async (matchId: string) => (await get(`/matches/${matchId}/live`)).body;

      it("rejects bad uploads: fields, kind, size, other manager, unknown match", async () => {
        const { matchId } = await liveSetup();
        await confirmLineup(matchId);
        const missing = await capture(matchId, { captureId: "" });
        expect(missing.status).toBe(400);
        expect(missing.body.error.message).toEqual(expect.any(String));
        expect((await capture(matchId, { kind: "SELFIE" })).status).toBe(400);
        expect((await capture(matchId, { capturedAt: "yesterday" })).status).toBe(400);
        expect((await capture(matchId, {}, Buffer.concat([fakePng("big"), Buffer.alloc(2 * 1024 * 1024)]))).status).toBe(413);
        expect((await capture("nope")).status).toBe(404);
        const other = (await createManager(await adminAgent())).agent;
        const k2 = (await other.post("/api/manager/studio/workers").send({ name: "Other" })).body.key;
        expect((await capture(matchId, {}, fakePng("x"), k2)).status).toBe(403);
        expect((await capture(matchId, {}, fakePng("y"), "sw_nope")).status).toBe(401);
        expect(await prisma.liveCapture.count()).toBe(0);
      });

      it("a capture is queued (202), read and applied; repeats are ignored; too fast → 429", async () => {
        const { matchId, soul, solo } = await liveSetup();
        await confirmLineup(matchId);
        const before = await board(matchId);
        expect(before.autoCapture).toMatchObject({ active: false, paused: false, lastCaptureAt: null, lastError: null });

        const spy = vi.spyOn(extractor, "readLive").mockResolvedValue(
          read([team(3, "SOUL", ["alive", "alive", "knocked", "eliminated"]), team(null, "solo", ["eliminated"])]),
        );
        const frame = vi.spyOn(extractor, "readFrame").mockResolvedValue(extraction("other"));
        const captureId = uuid();
        const up = await capture(matchId, { captureId });
        expect(up.status).toBe(202);
        expect(up.body).toEqual({ captureId, accepted: true, queuePosition: 0, nextIntervalSeconds: 2 });
        const again = await capture(matchId, { captureId });
        expect(again.status).toBe(200);
        expect(again.body).toEqual({ captureId, accepted: false, duplicate: true });
        const fast = await capture(matchId);
        expect(fast.status).toBe(429);
        expect(Number(fast.headers["retry-after"])).toBeGreaterThanOrEqual(1);

        expect(await runLiveCaptureOnce()).toBe(1);
        expect(spy).toHaveBeenCalledWith(expect.any(Buffer), "image/png", [
          { slot: 3, name: "SOUL", tag: expect.any(String) },
          { slot: 4, name: "SOLO", tag: expect.any(String) },
        ]);
        spy.mockRestore();
        frame.mockRestore();
        const row = await prisma.liveCapture.findFirstOrThrow({ where: { captureId } });
        expect(row).toMatchObject({ status: "APPLIED", changes: 3, storageKey: `matches/${matchId}/captures/${SESSION}/${row.sequence}.png` });

        const after = await board(matchId);
        expect(after.version).toBeGreaterThan(before.version);
        expect(after.teams[0]).toMatchObject({ id: soul, status: 2 });
        expect(after.teams[0].players.map((p: { state: string }) => p.state)).toEqual(["alive", "alive", "knocked", "eliminated"]);
        expect(after.teams[0].players[3]).toMatchObject({ source: "auto", updatedAt: expect.any(String) });
        expect(after.teams[0].players[0].source).toBeUndefined();
        expect(after.teams[1]).toMatchObject({ id: solo, status: 0 });
        expect(after.autoCapture).toMatchObject({ active: true, lastCaptureAt: expect.any(String), lastAppliedAt: expect.any(String), lastError: null });
        expect(after.autoCapture.latestImageUrl).toBeUndefined(); // studio view

        // the Match Center gets a link to the image the reader saw
        const mc = await mgr.get(`/api/manager/matches/${matchId}/team-status`);
        expect(mc.body.autoCapture.latestImageUrl).toBe(`/api/manager/matches/${matchId}/captures/${row.id}/image`);
        const img = await mgr.get(mc.body.autoCapture.latestImageUrl);
        expect(img.status).toBe(200);
        expect(img.headers["content-type"]).toBe("image/png");

        expect(after.autoCapture.lastDetected).toBe("in_game");

        // the same reading again changes nothing → no new version
        await applied(matchId, read([team(3, "SOUL", ["alive", "alive", "knocked", "eliminated"])]));
        expect((await board(matchId)).version).toBe(after.version);
      });

      it("precedence: manager edits lock for 60 s, eliminated is sticky, low confidence is ignored", async () => {
        const { matchId, soul } = await liveSetup();
        await confirmLineup(matchId);
        await applied(matchId, read([team(3, null, ["alive", "alive", "alive", "eliminated"])]));
        const states = async () => (await board(matchId)).teams[0].players.map((p: { state: string; source?: string }) => `${p.state}:${p.source ?? "-"}`);
        expect(await states()).toEqual(["alive:-", "alive:-", "alive:-", "eliminated:auto"]);

        // auto never revives an eliminated player
        await applied(matchId, read([team(3, null, ["alive", "alive", "alive", "alive"])]));
        expect(await states()).toEqual(["alive:-", "alive:-", "alive:-", "eliminated:auto"]);

        // the manager revives them (a mistake) and knocks player 1: both locked against the next capture
        await mgr.patch(`/api/manager/matches/${matchId}/team-status`).send({ teamId: soul, players: ["knocked", "alive", "alive", "alive"] });
        expect(await states()).toEqual(["knocked:manager", "alive:-", "alive:-", "alive:manager"]);
        await applied(matchId, read([team(3, null, ["alive", "alive", "eliminated", "eliminated"])]));
        // two eliminations read: the unlocked alive players take them (last first), locked ones keep the manager's state
        expect(await states()).toEqual(["knocked:manager", "eliminated:auto", "eliminated:auto", "alive:manager"]);

        // the lock expires after 60 s
        const row = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
        const aged = Object.fromEntries(
          Object.entries(row.liveTeams as Record<string, { source?: string; at?: string }[]>).map(([id, ps]) => [
            id,
            ps.map((p) => (p.source === "manager" ? { ...p, at: "2020-01-01T00:00:00.000Z" } : p)),
          ]),
        );
        await prisma.match.update({ where: { id: matchId }, data: { liveTeams: aged } });
        await applied(matchId, read([team(3, null, ["eliminated", "eliminated", "eliminated", "knocked"])]));
        expect(await states()).toEqual(["eliminated:auto", "eliminated:auto", "eliminated:auto", "knocked:auto"]);

        // low confidence: logged, not applied
        await applied(matchId, read([team(3, null, ["eliminated", "eliminated", "eliminated", "eliminated"], 0.6)]));
        expect((await states())[3]).toBe("knocked:auto");
      });

      it("busy: an auto frame while 12 of the match's frames wait to be read is dropped; manual frames still queue", async () => {
        const { matchId } = await liveSetup();
        await confirmLineup(matchId);
        const first = await capture(matchId);
        expect(first.status).toBe(202);
        const row = await prisma.liveCapture.findFirstOrThrow({ where: { captureId: first.body.captureId } });
        const { id: _id, ...rest } = row;
        await prisma.liveCapture.createMany({
          data: Array.from({ length: 11 }, (_, i) => ({ ...rest, captureId: uuid(), sequence: 100 + i, result: undefined, status: "PROCESSING" as const })),
        });
        await sleep(200);
        // 12 pending: below that, auto frames are taken (frames are read in parallel)
        const id = uuid();
        const busy = await capture(matchId, { captureId: id });
        expect(busy.status).toBe(200);
        expect(busy.body).toEqual({ captureId: id, accepted: false, reason: "busy" });
        expect(await prisma.liveCapture.count({ where: { captureId: id } })).toBe(0);
        await sleep(200);
        expect((await capture(matchId, { trigger: "manual" })).status).toBe(202);
      });

      it("ordering: queued frames are all read (in parallel); an older frame never overwrites a newer one", async () => {
        const { matchId } = await liveSetup();
        await confirmLineup(matchId);
        const t0 = Date.now();
        await applied(matchId, read([team(3, null, ["alive", "alive", "alive", "knocked"])]), { capturedAt: new Date(t0).toISOString() });

        // a late frame from before the applied one
        const late = await applied(matchId, read([team(3, null, ["eliminated", "eliminated", "eliminated", "eliminated"])]), {
          capturedAt: new Date(t0 - 10_000).toISOString(),
        });
        expect(await prisma.liveCapture.findFirstOrThrow({ where: { captureId: late.captureId } })).toMatchObject({ status: "SKIPPED" });
        expect((await board(matchId)).teams[0].status).toBe(3);

        // two frames queued before the worker runs: both are read (each may show different teams of a scrolled list)
        await sleep(200);
        const a = await capture(matchId, { capturedAt: new Date(t0 + 1_000).toISOString() });
        await sleep(200);
        const b = await capture(matchId, { capturedAt: new Date(t0 + 2_000).toISOString() });
        const spy = vi.spyOn(extractor, "readLive").mockResolvedValue(read([team(3, null, ["alive", "alive", "knocked", "knocked"])]));
        const frame = vi.spyOn(extractor, "readFrame").mockResolvedValue(extraction("other"));
        expect(await runLiveCaptureOnce()).toBe(2);
        expect(spy).toHaveBeenCalledTimes(2);
        spy.mockRestore();
        frame.mockRestore();
        expect(await prisma.liveCapture.findFirstOrThrow({ where: { captureId: b.body.captureId } })).toMatchObject({ status: "APPLIED" });
        expect((await prisma.liveCapture.findFirstOrThrow({ where: { captureId: a.body.captureId } })).status).not.toBe("QUEUED");
        expect((await board(matchId)).teams[0].status).toBe(2);
        expect(await runLiveCaptureOnce()).toBe(0);

        // an auto frame that waited too long is skipped unread
        await sleep(200);
        const old = await capture(matchId);
        await prisma.liveCapture.updateMany({ where: { captureId: old.body.captureId }, data: { createdAt: new Date(Date.now() - 60_000) } });
        expect(await runLiveCaptureOnce()).toBe(0);
        expect(await prisma.liveCapture.findFirstOrThrow({ where: { captureId: old.body.captureId } })).toMatchObject({ status: "SKIPPED" });
      });

      it("pause: captures accepted, nothing applied; no panel on the frame → lastError; 24 h sweep", async () => {
        const { matchId } = await liveSetup();
        await confirmLineup(matchId);
        const paused = await mgr.patch(`/api/manager/matches/${matchId}/team-status/auto`).send({ paused: true });
        expect(paused.status).toBe(200);
        expect(paused.body.autoCapture.paused).toBe(true);
        const body = await applied(matchId, read([team(3, null, ["eliminated", "eliminated", "eliminated", "eliminated"])]));
        expect(body.nextIntervalSeconds).toBe(15);
        expect(await status(matchId, body.captureId)).toMatchObject({ status: "ignored", detected: "in_game", message: expect.stringMatching(/auto updates paused/) });
        expect((await board(matchId)).teams[0].status).toBe(4);
        await mgr.patch(`/api/manager/matches/${matchId}/team-status/auto`).send({ paused: false });

        await applied(matchId, read([], "other"));
        expect((await board(matchId)).autoCapture.lastError).toMatch(/spectator view/);
        await applied(matchId, read([team(3, null, ["alive", "alive", "alive", "knocked"])]));
        expect((await board(matchId)).autoCapture.lastError).toBeNull();

        expect(await sweepLiveCaptures(Date.now() + 25 * 3600_000)).toBe(3);
        expect(await prisma.liveCapture.count()).toBe(0);
        expect((await mgr.get(`/api/manager/matches/${matchId}/team-status`)).body.autoCapture.latestImageUrl).toBeNull();
      });

      describe("the studio runs the match: one screenshot type, Start / Stop", () => {
        /** the match status in the database */
        const dbStatus = async (matchId: string) => (await prisma.match.findUniqueOrThrow({ where: { id: matchId } })).status;
        /** upload a frame (no kind: the server detects it), run the worker, return what the studio is told */
        async function send(matchId: string, ex: Extraction, over: Record<string, string> = {}, r: Read = read([], "other")) {
          const up = await applied(matchId, r, { kind: "", ...over }, ex);
          return status(matchId, up.captureId);
        }

        it("a match is locked until registration closes or every slot is filled; Start needs it unlocked", async () => {
          const scrim = await createScrim(mgr); // 4 slots (3..6), 9:00 PM, runs daily
          const list = await mgr.get(`/api/manager/scrims/${scrim.id}/sessions/${tomorrow()}/matches`);
          const matchId = list.body.items[0].id as string;
          const leaders = [];
          for (let i = 0; i < 4; i++) leaders.push(await createTeam(null, `Lock ${i}`, `lock${i}`));
          expect((await leaders[0]!.agent.post("/api/team/registrations").send({ scrimId: scrim.id, date: tomorrow() })).status).toBe(201);

          const control = async () => ((await get("/matches")).body.items as { id: string; control: unknown }[]).find((m) => m.id === matchId)!.control;
          expect(await control()).toEqual({
            state: "locked",
            unlocksAt: expect.any(String),
            reason: "Registration is open until 9:00 PM (1/4 slots filled)",
            teams: 1,
            slots: 4,
          });
          const early = await post(`/matches/${matchId}/start`);
          expect(early.status).toBe(409);
          expect(early.body.error.message).toMatch(/Registration is open until 9:00 PM/);
          // while locked only lobby frames are taken
          const notLobby = await capture(matchId, { kind: "", hint: "results", trigger: "manual" });
          expect(notLobby.status).toBe(409);
          expect(notLobby.body.error.message).toMatch(/locked/);
          await sleep(200);
          expect((await capture(matchId, { kind: "", hint: "lobby", trigger: "manual" })).status).toBe(202);

          for (const l of leaders.slice(1)) await l.agent.post("/api/team/registrations").send({ scrimId: scrim.id, date: tomorrow() });
          expect(await control()).toEqual({ state: "ready", unlocksAt: null, reason: null, teams: 4, slots: 4 });
          // no lobby read yet: Start refuses instead of listing whole rosters
          const drain = vi.spyOn(extractor, "readFrame").mockResolvedValue(extraction("other"));
          expect(await runLiveCaptureOnce()).toBe(1); // the frame queued above shows no team list
          drain.mockRestore();
          const noLobby = await post(`/matches/${matchId}/start`);
          expect(noLobby.status).toBe(409);
          expect(noLobby.body.error.message).toMatch(/No lobby read yet/);
          await send(matchId, lobby({ 3: NAMES }));
          const started = await post(`/matches/${matchId}/start`);
          expect(started.status).toBe(200);
          expect(started.body.control).toMatchObject({ state: "live" });
          expect(started.body.match.state).toBe("live");
          expect((await post(`/matches/${matchId}/start`)).status).toBe(409);
        });

        it("before Start a lobby frame fills the team list; Start confirms it (a team nobody joined from has no players)", async () => {
          const { matchId } = await liveSetup(); // yesterday's session: unlocked
          expect((await get(`/matches/${matchId}/live`)).body.control).toMatchObject({ state: "ready", teams: 2, slots: 4 });

          const st = await send(matchId, lobby({ 3: ["MortalX", "RegalX", "ViperX", "OwaisX"] }));
          expect(st).toEqual({ captureId: expect.any(String), status: "applied", detected: "lobby", confidence: 0.97, message: "Lobby ✓ 1 team" });
          expect(await dbStatus(matchId)).toBe("LINEUP_REVIEW"); // filled, not started
          const shots = (await mgr.get(`/api/manager/matches/${matchId}`)).body.screenshots;
          expect(shots).toEqual([expect.objectContaining({ kind: "SLOT_LIST", source: "STUDIO_AUTO", status: "DONE" })]);

          // the same lobby again adds nothing and isn't kept
          expect((await send(matchId, lobby({ 3: ["MortalX", "RegalX", "ViperX", "OwaisX"] }))).message).toBe("Lobby ✓ 1 team (nothing new)");
          expect((await mgr.get(`/api/manager/matches/${matchId}`)).body.screenshots).toHaveLength(1);
          // a results screen before Start is ignored, with a hint for the operator
          expect(await send(matchId, results([[1, 3, ["MortalX"]]]))).toMatchObject({ status: "ignored", detected: "results", message: expect.stringMatching(/Press Start first/) });
          expect(await send(matchId, extraction("other"))).toMatchObject({ status: "ignored", detected: "other" });

          const started = await post(`/matches/${matchId}/start`);
          expect(started.status).toBe(200);
          expect(await dbStatus(matchId)).toBe("LIVE");
          const lineup = (await mgr.get(`/api/manager/matches/${matchId}`)).body.teams.map((t: { slotNumber: number; players: { name: string }[] }) => [
            t.slotNumber,
            t.players.map((p) => p.name),
          ]);
          expect(lineup).toEqual([
            [3, ["MortalX", "RegalX", "ViperX", "OwaisX"]],
          ]);
        });

        it("while live: the HUD updates the board, a results screen ends the match; Stop; published → 409", async () => {
          const { matchId } = await liveSetup();
          await send(matchId, lobby({ 3: NAMES }));
          await post(`/matches/${matchId}/start`);
          expect(await send(matchId, extraction("other"), {}, read([team(3, null, ["alive", "alive", "alive", "knocked"])]))).toMatchObject({
            status: "applied",
            detected: "in_game",
            message: "In-game ✓ 1 player change",
          });
          // a manual results screenshot while live: read, and the match ends
          const st = await send(matchId, results([[1, 3, NAMES], [2, 4, ["SoloOne"]]]), { trigger: "manual", hint: "results" });
          expect(st).toMatchObject({ status: "applied", detected: "results", message: "Results ✓ 2 ranks — the match has ended" });
          expect(await dbStatus(matchId)).toBe("RESULTS_REVIEW");
          expect((await get(`/matches/${matchId}/live`)).body.control.state).toBe("ended");
          const detail = (await mgr.get(`/api/manager/matches/${matchId}`)).body;
          expect(detail.teams.map((t: { slotNumber: number; placement: number | null }) => [t.slotNumber, t.placement])).toEqual([
            [3, 1],
            [4, 2],
          ]);
          expect((await post(`/matches/${matchId}/stop`)).status).toBe(409); // already ended

          // the manager publishes; the studio can't send any more
          expect((await mgr.post(`/api/manager/matches/${matchId}/publish`)).status).toBe(200);
          expect((await get(`/matches/${matchId}/live`)).body.control.state).toBe("published");
          await sleep(200);
          expect((await capture(matchId, { kind: "" })).status).toBe(409);
        });

        it("an interval frame doesn't end a live match unless it is the final results (rank 1) seen twice in a row", async () => {
          const { matchId } = await liveSetup();
          await send(matchId, lobby({ 3: NAMES }));
          await post(`/matches/${matchId}/start`);
          // the in-game standings overlay read as "results" (ranks 3 and 4, no winner): ignored, match keeps going
          const overlay = await send(matchId, results([[3, 3, ["SoloOne"]], [4, 4, ["SoloTwo"]]]), { trigger: "auto" });
          expect(overlay).toMatchObject({ status: "ignored", detected: "results", message: expect.stringMatching(/no winner/) });
          expect(await dbStatus(matchId)).toBe("LIVE");
          await sleep(200);
          // a real results screen: the first sighting waits for a second one
          const first = await send(matchId, results([[1, 3, NAMES], [2, 4, ["SoloOne"]]]), { trigger: "auto" });
          expect(first).toMatchObject({ status: "ignored", detected: "results", message: expect.stringMatching(/one more frame/) });
          expect(await dbStatus(matchId)).toBe("LIVE");
          await sleep(200);
          const second = await send(matchId, results([[1, 3, NAMES], [2, 4, ["SoloOne"]]]), { trigger: "auto" });
          expect(second).toMatchObject({ status: "applied", message: "Results ✓ 2 ranks — the match has ended" });
          expect(await dbStatus(matchId)).toBe("RESULTS_REVIEW");
        });

        /** the in-match team list: per slot, each player's [name, state, eliminations] */
        const teamList = (teams: Record<number, [string, "alive" | "knocked" | "eliminated", number][]>): Extraction =>
          extraction("custom_lobby", {
            teams: Object.entries(teams).map(([slot, ps]) => ({
              slot: Number(slot),
              slotConfidence: 0.97,
              players: ps.map(([n, state, kills]) => ({ ...player(n, kills), state })),
            })),
          });
        const at = (ms: number) => ({ capturedAt: new Date(ms).toISOString() });
        const states = async (matchId: string) =>
          (await board(matchId)).teams.map((t: { slot: number; kills: number; players: { state: string }[] }) => [t.slot, t.kills, t.players.map((p) => p.state).join(",")]);

        it("the scrolled team list: frames merge into the lineup, then update each player's state and kills; an older frame never overwrites a newer one", async () => {
          const { matchId } = await liveSetup();
          // before Start: two scroll positions (slot 3 on both) fill the lineup together
          expect(await send(matchId, lobby({ 3: NAMES }))).toMatchObject({ status: "applied", message: "Lobby ✓ 1 team" });
          expect(await send(matchId, lobby({ 3: NAMES, 4: ["SoloOne"] }))).toMatchObject({ status: "applied", message: "Lobby ✓ 2 teams" });
          expect((await post(`/matches/${matchId}/start`)).status).toBe(200);
          expect(await states(matchId)).toEqual([
            [3, 0, "alive,alive,alive,alive"],
            [4, 0, "alive"],
          ]);

          const t0 = Date.now();
          const [a, b, c, d] = NAMES as [string, string, string, string];
          const first = await send(matchId, teamList({ 3: [[a, "alive", 2], [b, "eliminated", 0], [c, "alive", 1], [d, "alive", 0]] }), at(t0 + 1_000));
          expect(first).toMatchObject({ status: "applied", detected: "lobby", message: "Team list ✓ 1 team, 3 updates" });
          expect(await states(matchId)).toEqual([
            [3, 3, "alive,eliminated,alive,alive"],
            [4, 0, "alive"],
          ]);
          // the next scroll position: slot 3 again (newer) and slot 4
          await send(matchId, teamList({ 3: [[a, "alive", 3], [b, "eliminated", 0], [c, "eliminated", 1], [d, "alive", 0]], 4: [["SoloOne", "eliminated", 1]] }), at(t0 + 3_000));
          expect(await states(matchId)).toEqual([
            [3, 4, "alive,eliminated,eliminated,alive"],
            [4, 1, "eliminated"],
          ]);
          // a frame captured before that one, read late (frames are read in parallel): changes nothing
          await send(matchId, teamList({ 3: [[a, "alive", 2], [b, "alive", 0], [c, "alive", 1], [d, "alive", 0]] }), at(t0 + 2_000));
          // a newer frame can't revive an eliminated player, and kills never go down
          await send(matchId, teamList({ 3: [[a, "alive", 1], [b, "alive", 0], [c, "alive", 1], [d, "knocked", 0]] }), at(t0 + 5_000));
          expect(await states(matchId)).toEqual([
            [3, 4, "alive,eliminated,eliminated,knocked"],
            [4, 1, "eliminated"],
          ]);
          // MVP material: the players' kills are on the lineup
          const detail = (await mgr.get(`/api/manager/matches/${matchId}`)).body;
          expect(detail.teams[0].players.map((p: { kills: number | null }) => p.kills)).toEqual([3, 0, 1, 0]);
        });

        it("a slot nobody was read from before Start is filled from the team list during the match", async () => {
          const { matchId } = await liveSetup();
          await send(matchId, lobby({ 3: NAMES }));
          await post(`/matches/${matchId}/start`);
          expect((await mgr.get(`/api/manager/matches/${matchId}`)).body.teams.map((t: { slotNumber: number }) => t.slotNumber)).toEqual([3]);
          const st = await send(matchId, teamList({ 4: [["SoloOne", "alive", 0]] }));
          expect(st).toMatchObject({ status: "applied", message: "Team list ✓ 1 team, no changes, 1 team added to the lineup" });
          const lineup = (await mgr.get(`/api/manager/matches/${matchId}`)).body.teams.map((t: { slotNumber: number; players: { name: string }[] }) => [
            t.slotNumber,
            t.players.map((p) => p.name),
          ]);
          expect(lineup).toEqual([
            [3, NAMES],
            [4, ["SoloOne"]],
          ]);
        });

        it("after the end: results pages fill ranks until every team that played has one; then interval frames get CAPTURE_DONE", async () => {
          const { matchId } = await liveSetup();
          await send(matchId, lobby({ 3: NAMES, 4: ["SoloOne"] }));
          await post(`/matches/${matchId}/start`);
          expect((await board(matchId)).results).toBeUndefined();
          await post(`/matches/${matchId}/stop`);
          expect((await board(matchId)).results).toEqual({ complete: false, placed: 0, teams: 2 });

          // the results list scrolls: the first page shows rank 1 only, the next one rank 2
          expect(await send(matchId, results([[1, 3, NAMES]]), { trigger: "auto" })).toMatchObject({ status: "applied", message: "Results ✓ 1 rank" });
          expect((await board(matchId)).results).toEqual({ complete: false, placed: 1, teams: 2 });
          expect(await send(matchId, results([[1, 3, NAMES], [2, 4, ["SoloOne"]]]), { trigger: "auto" })).toMatchObject({ status: "applied" });
          expect((await board(matchId)).results).toEqual({ complete: true, placed: 2, teams: 2 });

          await sleep(200);
          const done = await capture(matchId, { kind: "" });
          expect(done.status).toBe(409);
          expect(done.body.error).toMatchObject({ code: "CAPTURE_DONE", message: expect.stringMatching(/All results are in/) });
          await sleep(200);
          expect((await capture(matchId, { kind: "", trigger: "manual" })).status).toBe(202); // the operator can still send one
        });

        it("Stop ends a live match; results pages sent back to back are all read; a later auto frame doesn't skip them", async () => {
          const { matchId } = await liveSetup();
          expect((await post(`/matches/${matchId}/stop`)).status).toBe(409); // not live yet
          await send(matchId, lobby({ 3: NAMES }));
          await post(`/matches/${matchId}/start`);
          const stopped = await post(`/matches/${matchId}/stop`);
          expect(stopped.status).toBe(200);
          expect(stopped.body.control.state).toBe("ended");

          const ids: string[] = [];
          for (const over of [{ trigger: "manual" }, { trigger: "manual" }, { trigger: "auto" }]) {
            await sleep(200);
            const up = await capture(matchId, { kind: "", ...over });
            expect(up.status).toBe(202);
            ids.push(up.body.captureId);
          }
          // read in parallel: two results pages and a frame that shows neither
          const pages = [results([[1, 3, NAMES]]), results([[2, 4, ["SoloOne"]]]), extraction("other")];
          const spy = vi.spyOn(extractor, "readFrame").mockImplementation(async () => pages.shift()!);
          expect(await runLiveCaptureOnce()).toBe(3);
          spy.mockRestore();
          const states = await Promise.all(ids.map(async (id) => (await status(matchId, id)).status));
          expect(states.sort()).toEqual(["applied", "applied", "ignored"]);
          const placed = (await mgr.get(`/api/manager/matches/${matchId}`)).body.teams.map((t: { placement: number | null }) => t.placement);
          expect(placed).toEqual([1, 2]);
          expect((await get(`/matches/${matchId}/captures/nope`)).status).toBe(404);
        });

        it("an operator hint that disagrees with what was detected is kept past 24 h (training material)", async () => {
          const { matchId } = await liveSetup();
          const kept = await applied(matchId, read([], "other"), { kind: "", hint: "results", trigger: "manual" }, lobby({ 3: NAMES }));
          await applied(matchId, read([], "other"), { kind: "", hint: "lobby" }, lobby({ 4: ["SoloOne"] }));
          expect(await sweepLiveCaptures(Date.now() + 25 * 3600_000)).toBe(1);
          expect(await prisma.liveCapture.findMany({ select: { captureId: true, hint: true, detected: true } })).toEqual([
            { captureId: kept.captureId, hint: "results", detected: "lobby" },
          ]);
        });
      });
    });
  });
});
