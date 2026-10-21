/**
 * Phase 8c: Studio Box — a worker that reports `box` in its poll. Box info is stored; a box show's job renders from
 * the box's LAN URL and carries the outputs (stream keys + site-YouTube ingest) + sendToAws; the server runs no
 * relays for it. YouTube is mocked (not connected in tests).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerPollInput } from "@7xen/shared";

const yt = vi.hoisted(() => ({ on: false, ended: [] as string[] }));
vi.mock("../src/services/youtube.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/services/youtube.js")>();
  return {
    ...orig,
    startShowBroadcast: vi.fn(async (show: { title: string; matchId: string | null }) =>
      yt.on ? { broadcastId: "yt_abc123", title: show.title, watchUrl: "https://youtu.be/yt_abc123", target: "rtmp://a.rtmp.youtube.com/live2/yt-ingest-key" } : orig.startShowBroadcast(show),
    ),
    endMatchBroadcast: vi.fn(async (id: string) => void yt.ended.push(id)),
  };
});

const { showRunsOnBox } = await import("../src/services/studio.js");
const { adminAgent, createAdminUser, createManager, http, prisma, resetDb, server } = await import("./helpers.js");
type TestAgent = Awaited<ReturnType<typeof createManager>>["agent"];

const LAN = "http://192.168.1.20:4300";
const IDLE: WorkerPollInput = { version: "0.2.0", encoder: "h264_nvenc", state: "idle", showId: null, fps: null, bitrateKbps: null, error: null };
const BOX: WorkerPollInput = { ...IDLE, box: { lanUrl: LAN, devices: 3, streaming: 2 } };
const poll = (key: string, body: WorkerPollInput) => http().post("/api/studio-worker/poll").set("X-Worker-Key", key).send(body);

let mgr: TestAgent;
let showId: string;
let workerId: string;
let key: string;
let destId: string;

beforeEach(async () => {
  yt.on = false;
  yt.ended = [];
  vi.clearAllMocks();
  await resetDb();
  await createAdminUser();
  mgr = (await createManager(await adminAgent())).agent;
  const show = await mgr.post("/api/manager/studio/shows").send({ title: "Box show" });
  showId = show.body.id;
  const w = await mgr.post("/api/manager/studio/workers").send({ name: "Venue box" });
  workerId = w.body.worker.id;
  key = w.body.key;
  const d = await mgr.post("/api/manager/stream/destinations").send({ kind: "CUSTOM", name: "My Twitch", url: "rtmp://live.example.com/app/", streamKey: "secret-key-123" });
  expect(d.status).toBe(201);
  destId = d.body.id;
  expect((await mgr.patch(`/api/manager/studio/shows/${showId}`).send({ destinationIds: [destId], publicListing: true })).status).toBe(200);
});
afterAll(async () => {
  await prisma.$disconnect();
  server.close();
});

describe("studio box", () => {
  it("stores the box info from the poll and lists it on the worker row; a plain poll clears it", async () => {
    expect((await mgr.get("/api/manager/studio/workers")).body.items[0].box).toBeNull();
    expect((await poll(key, BOX)).status).toBe(200);
    const list = await mgr.get("/api/manager/studio/workers");
    expect(list.body.items[0]).toMatchObject({ online: true, box: { name: "Venue box", lanUrl: LAN, devices: 3, streaming: 2 } });
    await poll(key, IDLE);
    expect((await mgr.get("/api/manager/studio/workers")).body.items[0].box).toBeNull();
  });

  it("box show: job renders on the box, carries the stream-key output, sendToAws follows publicListing; no relays", async () => {
    await poll(key, BOX);
    const start = await mgr.post(`/api/manager/studio/shows/${showId}/start-worker`).send({ workerId });
    expect(start.status).toBe(200);
    expect(showRunsOnBox(showId)).toBe(true);
    // configured outputs, not ok until the box reports live
    expect(start.body.destinations).toEqual([{ id: destId, name: "My Twitch", ok: false }]);

    const job = (await poll(key, { ...BOX, state: "starting", showId })).body.job;
    expect(job.renderUrl).toBe(`${LAN}/studio-render/${showId}`);
    expect(job.outputs).toEqual([{ id: destId, name: "My Twitch", url: "rtmp://live.example.com/app/secret-key-123" }]);
    expect(job.sendToAws).toBe(true);
    expect(job.publishUrl).toMatch(new RegExp(`/live/show_${showId}\\?wtoken=`));

    await poll(key, { ...BOX, state: "live", showId });
    const status = await mgr.get(`/api/manager/studio/shows/${showId}/status`);
    expect(status.body).toMatchObject({ receiving: true, destinations: [{ id: destId, ok: true }], youtube: null });

    // listed on the Live page (HLS from the box's AWS copy), no YouTube embed
    const live = await http().get("/api/live");
    expect(live.body.items).toHaveLength(1);
    expect(live.body.items[0].youtubeVideoId).toBeUndefined();

    await mgr.patch(`/api/manager/studio/shows/${showId}`).send({ publicListing: false });
    expect((await poll(key, { ...BOX, state: "live", showId })).body.job.sendToAws).toBe(false);

    await mgr.post(`/api/manager/studio/shows/${showId}/stop`);
    expect((await poll(key, BOX)).body.job).toBeNull();
  });

  it("box show on the site YouTube channel: YouTube ingest output, created once, sendToAws false, Live embeds the video", async () => {
    yt.on = true;
    await mgr.patch(`/api/manager/studio/shows/${showId}`).send({ siteYoutube: true });
    await poll(key, BOX);
    expect((await mgr.post(`/api/manager/studio/shows/${showId}/start-worker`).send({ workerId })).status).toBe(200);
    const job = (await poll(key, { ...BOX, state: "live", showId })).body.job;
    expect(job.outputs).toEqual([
      { id: destId, name: "My Twitch", url: "rtmp://live.example.com/app/secret-key-123" },
      { id: "site-youtube", name: "AirBattleground YouTube", url: "rtmp://a.rtmp.youtube.com/live2/yt-ingest-key" },
    ]);
    expect(job.sendToAws).toBe(false);
    await poll(key, { ...BOX, state: "live", showId });
    const { startShowBroadcast } = await import("../src/services/youtube.js");
    expect(startShowBroadcast).toHaveBeenCalledTimes(1);

    const status = await mgr.get(`/api/manager/studio/shows/${showId}/status`);
    expect(status.body.youtube).toEqual({ title: "Box show", watchUrl: "https://youtu.be/yt_abc123", ok: true, error: null });
    const live = await http().get("/api/live");
    expect(live.body.items[0]).toMatchObject({ matchId: `s_${showId}`, youtubeVideoId: "yt_abc123" });

    await mgr.post(`/api/manager/studio/shows/${showId}/stop`);
    expect(yt.ended).toEqual(["yt_abc123"]);
  });

  it("a plain worker (no box) gets the phase 8b job: no outputs, no sendToAws, site render URL", async () => {
    await poll(key, IDLE);
    expect((await mgr.post(`/api/manager/studio/shows/${showId}/start-worker`).send({ workerId })).status).toBe(200);
    expect(showRunsOnBox(showId)).toBe(false);
    const job = (await poll(key, { ...IDLE, state: "starting", showId })).body.job;
    expect(job.renderUrl).toBe(`http://localhost:5173/studio-render/${showId}`);
    expect(job.outputs).toBeUndefined();
    expect(job.sendToAws).toBeUndefined();
    await mgr.post(`/api/manager/studio/shows/${showId}/stop`);
  });
});
