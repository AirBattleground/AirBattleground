/**
 * Phase 8b: Studio worker — key auth, poll → job, start-worker, worker publish token, stop, control long-poll.
 * (MediaMTX isn't running in tests: the worker-mode runner just never sees its path ready.)
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { WorkerPollInput } from "@7xen/shared";
import { authorize } from "../src/services/media.js";
import { adminAgent, createAdminUser, createManager, http, prisma, resetDb, server, type TestAgent } from "./helpers.js";

const IDLE: WorkerPollInput = { version: "0.1.0", encoder: "libx264", state: "idle", showId: null, fps: null, bitrateKbps: null, error: null };
const poll = (key: string | null, body: WorkerPollInput = IDLE) => {
  const req = http().post("/api/studio-worker/poll");
  return (key ? req.set("X-Worker-Key", key) : req).send(body);
};

let mgr: TestAgent;
let showId: string;
let workerId: string;
let key: string;

beforeEach(async () => {
  await resetDb();
  await createAdminUser();
  mgr = (await createManager(await adminAgent())).agent;
  const show = await mgr.post("/api/manager/studio/shows").send({ title: "Evening show" });
  expect(show.status).toBe(201);
  showId = show.body.id;
  const w = await mgr.post("/api/manager/studio/workers").send({ name: "Studio PC" });
  expect(w.status).toBe(201);
  workerId = w.body.worker.id;
  key = w.body.key;
});
afterAll(async () => {
  await prisma.$disconnect();
  server.close();
});

describe("studio worker", () => {
  it("rejects a missing or unknown worker key", async () => {
    expect((await poll(null)).status).toBe(401);
    const bad = await poll("sw_nope");
    expect(bad.status).toBe(401);
    expect(bad.body.error.message).toBe("Unknown worker key");
  });

  it("polls with no job, and lists the worker as online afterwards", async () => {
    expect(key.startsWith("sw_")).toBe(true);
    const list0 = await mgr.get("/api/manager/studio/workers");
    expect(list0.body.items[0].online).toBe(false);
    const res = await poll(key);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ worker: { id: workerId, name: "Studio PC" }, job: null });
    const list = await mgr.get("/api/manager/studio/workers");
    expect(list.body.items[0]).toMatchObject({ id: workerId, online: true, encoder: "libx264", version: "0.1.0" });
  });

  it("runs a show on the worker: start → job with publish token → media auth → stop", async () => {
    const offline = await mgr.post(`/api/manager/studio/shows/${showId}/start-worker`).send({ workerId });
    expect(offline.status).toBe(409);
    expect(offline.body.error.message).toBe("Your studio worker is offline. Start it and try again.");

    await poll(key);
    const start = await mgr.post(`/api/manager/studio/shows/${showId}/start-worker`).send({ workerId });
    expect(start.status).toBe(200);
    expect(start.body).toMatchObject({ state: "LIVE", runOn: "worker", worker: { id: workerId, online: true } });

    const show = await mgr.get(`/api/manager/studio/shows/${showId}`);
    expect(show.body).toMatchObject({ runOn: "worker", workerId, state: "LIVE" });

    // a browser can't push chunks into a worker-run show
    const ingest = await mgr.post(`/api/manager/studio/shows/${showId}/ingest?session=abcdefgh&seq=0&codec=vp8`).set("Content-Type", "application/octet-stream").send(Buffer.from("x"));
    expect(ingest.status).toBe(409);
    expect(ingest.body.error.message).not.toBe("RESTART");

    const res = await poll(key, { ...IDLE, state: "starting" });
    const job = res.body.job;
    expect(job).toMatchObject({ showId, title: "Evening show", videoKbps: 6000, fps: 60 });
    expect(job.renderUrl).toBe(`http://localhost:5173/studio-render/${showId}`);
    expect(job.publishUrl).toMatch(new RegExp(`/live/show_${showId}\\?wtoken=\\d+\\.[\\w-]+$`));
    expect(job.session.cookieName).toBe("sx_app");
    // the session token signs the render page in as the show's manager
    const asManager = await http().get(`/api/manager/studio/shows/${showId}`).set("Authorization", `Bearer ${job.session.token}`);
    expect(asManager.status).toBe(200);
    // the same token is handed out on the next poll
    expect((await poll(key)).body.job.publishUrl).toBe(job.publishUrl);

    const query = new URL(job.publishUrl.replace(/^rtmp:/, "http:")).search.slice(1);
    const path = `live/show_${showId}`;
    expect(await authorize({ action: "publish", path, query })).toBe(true);
    const wtoken = new URLSearchParams(query).get("wtoken")!;
    const tampered = `wtoken=${wtoken.slice(0, -2)}${wtoken.endsWith("AA") ? "BB" : "AA"}`;
    expect(await authorize({ action: "publish", path, query: tampered })).toBe(false);
    const [exp, sig] = wtoken.split(".");
    expect(await authorize({ action: "publish", path, query: `wtoken=${Number(exp) + 1000}.${sig}` })).toBe(false);
    expect(await authorize({ action: "publish", path: "live/show_someotherid1234", query })).toBe(false);
    expect(await authorize({ action: "publish", path: `live/out_${showId}`, query })).toBe(false);

    const stop = await mgr.post(`/api/manager/studio/shows/${showId}/stop`);
    expect(stop.status).toBe(200);
    expect(stop.body.state).toBe("ENDED");
    expect((await poll(key)).body.job).toBeNull();
    expect(await authorize({ action: "publish", path, query })).toBe(false);
  });

  it("refuses a second show on a busy worker, and deleting the worker ends its show", async () => {
    await poll(key);
    expect((await mgr.post(`/api/manager/studio/shows/${showId}/start-worker`).send({ workerId })).status).toBe(200);
    const other = await mgr.post("/api/manager/studio/shows").send({ title: "Second" });
    const busy = await mgr.post(`/api/manager/studio/shows/${other.body.id}/start-worker`).send({ workerId });
    expect(busy.status).toBe(409);
    expect((await mgr.delete(`/api/manager/studio/workers/${workerId}`)).status).toBe(204);
    expect((await mgr.get(`/api/manager/studio/shows/${showId}`)).body.state).toBe("ENDED");
    expect((await poll(key)).status).toBe(401);
  });

  it("control: PATCH bumps the version; GET answers at once when newer, and wakes a waiting long-poll", async () => {
    const c0 = await mgr.get(`/api/manager/studio/shows/${showId}/control?since=-1`);
    expect(c0.status).toBe(200);
    expect(c0.body).toMatchObject({ version: 0, programId: null, takeSeq: 0, title: "Evening show", state: "IDLE" });

    const set = await mgr.patch(`/api/manager/studio/shows/${showId}/control`).send({ programId: "scene-1", takeSeq: 1 });
    expect(set.body).toEqual({ version: 1 });
    const c1 = await mgr.get(`/api/manager/studio/shows/${showId}/control?since=0`);
    expect(c1.body).toMatchObject({ version: 1, programId: "scene-1", takeSeq: 1 });

    // waiting at the current version: a title change wakes it well before the 25 s timeout
    const t0 = Date.now();
    const waiting = mgr.get(`/api/manager/studio/shows/${showId}/control?since=1`).then((r) => r);
    await new Promise((r) => setTimeout(r, 200));
    await mgr.patch(`/api/manager/studio/shows/${showId}`).send({ title: "Renamed" });
    const c2 = await waiting;
    expect(c2.body).toMatchObject({ version: 2, title: "Renamed" });
    expect(Date.now() - t0).toBeLessThan(5_000);
  });
});
