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
  };
});

const { showRunsOnBox } = await import("../src/services/studio.js");
const { adminAgent, createAdminUser, createManager, createScrim, http, prisma, resetDb, server } = await import("./helpers.js");
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
});

