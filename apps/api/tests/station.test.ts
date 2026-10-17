/**
 * Phase 4b: 7XEN Station integration, against a fake station HTTP server.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MatchLive, StationStatus } from "@7xen/shared";
import { storageRoot } from "../src/lib/storage.js";
import { resolveVideoKey } from "../src/lib/video.js";
import { resetLiveCaches } from "../src/routes/station.js";
import { adminAgent, createAdminUser, createManager, createScrim, createTeam, http, prisma, resetDb, server, today, type TestAgent } from "./helpers.js";

const TOKEN = "test-station-token-0123456789abcdef";

// ---------------------------------------------------------------- fake station

interface Seen {
  method: string;
  url: string;
  token: string | undefined;
  body: Record<string, unknown>;
}
const fake = {
  server: null as Server | null,
  url: "",
  seen: [] as Seen[],
  status: null as unknown as StationStatus,
  /** override a route's answer: [status, body] */
  reply: {} as Record<string, [number, unknown]>,
};

const idle = (): StationStatus => ({
  online: true,
  emulator: "READY",
  bgmiInstalled: true,
  phase: "IDLE",
  matchId: null,
  recordingId: null,
  startedAt: null,
  screen: { width: 1080, height: 2280 },
  rotation: 1,
  error: null,
  version: "0.1.0",
});

const PNG = (() => {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "ascii");
  ihdr.writeUInt32BE(2280, 8);
  ihdr.writeUInt32BE(1080, 12);
  return (salt: string) => Buffer.concat([sig, ihdr, Buffer.from(salt)]);
})();

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString();
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function startFake(): Promise<void> {
  fake.server = createServer(async (req, res) => {
    const b = await body(req);
    const route = `${req.method} ${req.url}`;
    fake.seen.push({ method: req.method!, url: req.url!, token: req.headers["x-station-token"] as string | undefined, body: b });
    const json = (status: number, data?: unknown) => {
      if (data === undefined) return void res.writeHead(status).end();
      res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(data));
    };
    if (req.headers["x-station-token"] !== TOKEN) return json(401, { error: { code: "UNAUTHENTICATED", message: "bad token" } });
    const override = fake.reply[route];
    if (override) return json(override[0], override[1]);
    switch (route) {
      case "GET /health":
        return json(200, fake.status);
      case "POST /sessions":
        fake.status = { ...fake.status, phase: "LIVE", matchId: b.matchId as string, recordingId: b.recordingId as string, startedAt: new Date().toISOString() };
        return json(200, fake.status);
      case "POST /sessions/stop":
        fake.status = { ...fake.status, phase: "STOPPING" };
        return json(200, fake.status);
      case "POST /sessions/capture": {
        const file = `station/captures/${b.matchId}/${Date.now()}-${String(b.kind).toLowerCase()}.png`;
        const abs = path.join(storageRoot(), file);
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, PNG(`shot-${fake.seen.length}`));
        return json(200, { file });
      }
      case "POST /sessions/input":
        return json(204);
      default:
        return json(404, { error: { code: "NOT_FOUND", message: "nope" } });
    }
  });
  return new Promise((resolve) =>
    fake.server!.listen(0, "127.0.0.1", () => {
      fake.url = `http://127.0.0.1:${(fake.server!.address() as AddressInfo).port}`;
      resolve();
    }),
  );
}

beforeAll(async () => {
  await startFake();
  process.env.STATION_TOKEN = TOKEN;
});
beforeEach(async () => {
  await resetDb();
  await createAdminUser();
  fake.seen = [];
  fake.reply = {};
  fake.status = idle();
  process.env.STATION_URL = fake.url;
  resetLiveCaches();
});
afterAll(async () => {
  fake.server?.close();
  await prisma.$disconnect();
  server.close();
});

// ---------------------------------------------------------------- world

async function world() {
  const admin = await adminAgent();
  const boss = await createManager(admin, "boss");
  const other = await createManager(admin, "other");
  const scrim = await createScrim(boss.agent);
  const date = today();
  const r = await boss.agent.get(`/api/manager/scrims/${scrim.id}/sessions/${date}/matches`);
  expect(r.status).toBe(200);
  const match = (r.body.items as { id: string; sessionId?: string }[])[0]!;
  const row = await prisma.match.findUniqueOrThrow({ where: { id: match.id } });
  const playing = await createTeam(admin, "Playing Team", "playing");
  const outsider = await createTeam(admin, "Outsider Team", "outsider");
  const teamRow = await prisma.team.findFirstOrThrow({ where: { name: "Playing Team" } });
  await prisma.registration.create({ data: { sessionId: row.sessionId!, teamId: teamRow.id, status: "APPROVED", slotNumber: 3 } });
  return { admin, mgr: boss.agent, other: other.agent, matchId: match.id, playing: playing.agent, outsider: outsider.agent };
}

const prepare = (a: TestAgent, matchId: string, b?: unknown) => a.post(`/api/manager/matches/${matchId}/station/prepare`).send(b as object);

// ---------------------------------------------------------------- manager endpoints

describe("station: manager endpoints", () => {
  it("status is online=false (never an error) when the station is unreachable", async () => {
    const w = await world();
    process.env.STATION_URL = "http://127.0.0.1:9";
    const s = await w.mgr.get("/api/manager/station");
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ online: false, phase: "IDLE" });
    const r = await prepare(w.mgr, w.matchId, {});
    expect(r.status).toBe(503);
    expect(r.body.error).toEqual({ code: "STATION_OFFLINE", message: expect.stringContaining("The 7XEN Station PC isn't running") });
    expect(await prisma.matchRecording.count()).toBe(0);
  });

  it("prepare (empty body) creates a 7XEN Station recording and starts the station", async () => {
    const w = await world();
    const r = await w.mgr.post(`/api/manager/matches/${w.matchId}/station/prepare`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const live = r.body as MatchLive;
    expect(live).toMatchObject({ matchId: w.matchId, streaming: true, hlsUrl: `/api/live/${w.matchId}/index.m3u8` });
    expect(live.station.matchTitle).toContain("Test Scrim");
    const rec = await prisma.matchRecording.findFirstOrThrow({ where: { matchId: w.matchId } });
    expect(rec).toMatchObject({ status: "LIVE", deviceName: "7XEN Station" });
    expect(live.recordingId).toBe(rec.id);
    const call = fake.seen.find((s) => s.url === "/sessions")!;
    expect(call.token).toBe(TOKEN);
    expect(call.body).toMatchObject({ matchId: w.matchId, recordingId: rec.id, launchBgmi: true });
    expect(call.body.videoKey).toMatch(new RegExp(`^\\d{4}/\\d{2}/${rec.id}\\.mp4$`));

    // idempotent for the same match: no second recording
    const again = await prepare(w.mgr, w.matchId, {});
    expect(again.status).toBe(200);
    expect(await prisma.matchRecording.count()).toBe(1);
    // GET live + LiveMatchCard info
    const g = await w.mgr.get(`/api/manager/matches/${w.matchId}/live`);
    expect(g.body).toMatchObject({ streaming: true, recordingId: rec.id });
    const today = await w.mgr.get("/api/manager/live/today?days=0");
    const card = (today.body.items as { matchId: string; live: unknown }[]).find((c) => c.matchId === w.matchId)!;
    expect(card.live).toMatchObject({ streaming: true, hlsUrl: `/api/live/${w.matchId}/index.m3u8` });
  });

  it("ownership: other managers get 404, teams get 403; validation", async () => {
    const w = await world();
    expect((await prepare(w.other, w.matchId, {})).status).toBe(404);
    expect((await w.other.post(`/api/manager/matches/${w.matchId}/station/stop`)).status).toBe(404);
    expect((await w.other.post(`/api/manager/matches/${w.matchId}/station/capture`).send({ kind: "RESULTS" })).status).toBe(404);
    expect((await w.other.post(`/api/manager/matches/${w.matchId}/station/input`).send({ type: "tap", x: 0.5, y: 0.5 })).status).toBe(404);
    expect((await prepare(w.playing, w.matchId, {})).status).toBe(403);
    expect((await http().post(`/api/manager/matches/${w.matchId}/station/prepare`)).status).toBe(401);
    expect((await prepare(w.mgr, w.matchId, { launchBgmi: "yes" })).status).toBe(400);
    expect((await w.mgr.post(`/api/manager/matches/${w.matchId}/station/input`).send({ type: "tap", x: 3, y: 0 })).status).toBe(400);
    expect(fake.seen.filter((s) => s.url !== "/health")).toHaveLength(0);
  });

  it("busy with another match → 409 naming it; station errors are mapped", async () => {
    const w = await world();
    const other = await prisma.match.create({ data: { sessionId: (await prisma.match.findUniqueOrThrow({ where: { id: w.matchId } })).sessionId, number: 9, map: "SANHOK" } });
    fake.status = { ...idle(), phase: "LIVE", matchId: other.id, recordingId: "x" };
    const r = await prepare(w.mgr, w.matchId, {});
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/busy with Test Scrim/);
    expect(await prisma.matchRecording.count()).toBe(0);

    // the station refuses (raced with another prepare): the recording is marked FAILED
    fake.status = idle();
    fake.reply["POST /sessions"] = [409, { error: { code: "CONFLICT", message: "The station is busy with another match. Stop it first." } }];
    const r2 = await prepare(w.mgr, w.matchId, {});
    expect(r2.status).toBe(409);
    expect(await prisma.matchRecording.findFirstOrThrow({ where: { matchId: w.matchId } })).toMatchObject({ status: "FAILED" });
  });

  it("stop marks the recording STOPPED and tells the station", async () => {
    const w = await world();
    await prepare(w.mgr, w.matchId, {});
    const r = await w.mgr.post(`/api/manager/matches/${w.matchId}/station/stop`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ streaming: false, station: { phase: "STOPPING" } });
    expect(fake.seen.find((s) => s.url === "/sessions/stop")!.body).toEqual({ matchId: w.matchId });
    expect(await prisma.matchRecording.findFirstOrThrow({ where: { matchId: w.matchId } })).toMatchObject({ status: "STOPPED" });
  });

  it("stop when the station lost the session fails the LIVE recording", async () => {
    const w = await world();
    await prepare(w.mgr, w.matchId, {});
    fake.status = idle(); // station restarted
    const r = await w.mgr.post(`/api/manager/matches/${w.matchId}/station/stop`);
    expect(r.status).toBe(200);
    expect(await prisma.matchRecording.findFirstOrThrow({ where: { matchId: w.matchId } })).toMatchObject({ status: "FAILED" });
  });

  it("capture: station PNG → STATION screenshot (deduped), input is forwarded", async () => {
    const w = await world();
    await prepare(w.mgr, w.matchId, {});
    const c = await w.mgr.post(`/api/manager/matches/${w.matchId}/station/capture`).send({ kind: "RESULTS" });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect(c.body).toMatchObject({ kind: "RESULTS", source: "STATION", status: "QUEUED", width: 2280, height: 1080 });
    const shot = await prisma.screenshot.findFirstOrThrow({ where: { matchId: w.matchId } });
    expect(shot.source).toBe("STATION");
    expect(await prisma.screenshot.count()).toBe(1);
    // the station's temp file is gone, the screenshot lives in the normal place
    const file = (fake.seen.find((s) => s.url === "/sessions/capture")!.body as { matchId: string }).matchId;
    expect(file).toBe(w.matchId);

    const i = await w.mgr.post(`/api/manager/matches/${w.matchId}/station/input`).send({ type: "swipe", x: 0.1, y: 0.2, x2: 0.3, y2: 0.4 });
    expect(i.status).toBe(204);
    expect(fake.seen.find((s) => s.url === "/sessions/input")!.body).toEqual({ matchId: w.matchId, type: "swipe", x: 0.1, y: 0.2, x2: 0.3, y2: 0.4, durationMs: 300 });
    fake.reply["POST /sessions/input"] = [409, { error: { code: "CONFLICT", message: "The match isn't live on the station yet" } }];
    const i2 = await w.mgr.post(`/api/manager/matches/${w.matchId}/station/input`).send({ type: "key", key: "BACK" });
    expect(i2.status).toBe(409);
    expect(i2.body.error.message).toBe("The match isn't live on the station yet");
  });

  it("admin mirror: status, prepare, live for any match", async () => {
    const w = await world();
    const s = await w.admin.get("/api/admin/station");
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ online: true, phase: "IDLE", version: "0.1.0" });
    const r = await w.admin.post(`/api/admin/matches/${w.matchId}/station/prepare`).send({});
    expect(r.status).toBe(200);
    const rec = await prisma.matchRecording.findFirstOrThrow({ where: { matchId: w.matchId } });
    const boss = await prisma.user.findUniqueOrThrow({ where: { username: "boss" } });
    expect(rec.managerId).toBe(boss.id); // owned by the match's manager, not the admin
    expect((await w.admin.get(`/api/admin/matches/${w.matchId}/live`)).body).toMatchObject({ streaming: true });
    expect((await w.admin.post(`/api/admin/matches/${w.matchId}/station/stop`)).status).toBe(200);
  });
});

// ---------------------------------------------------------------- HLS viewers

describe("station: HLS access", () => {
  async function streaming() {
    const w = await world();
    await prepare(w.mgr, w.matchId, {});
    const dir = path.join(storageRoot(), "live", w.matchId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "index.m3u8"), "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2.0,\np0-00000.ts\n");
    writeFileSync(path.join(dir, "p0-00000.ts"), Buffer.alloc(188 * 4, 0x47));
    return w;
  }

  it("owner, admin and teams in the match may watch; others may not", async () => {
    const w = await streaming();
    const url = `/api/live/${w.matchId}/index.m3u8`;
    const own = await w.mgr.get(url);
    expect(own.status).toBe(200);
    expect(own.headers["content-type"]).toContain("application/vnd.apple.mpegurl");
    expect(own.headers["cache-control"]).toBe("no-store");
    expect(own.text ?? own.body.toString()).toContain("p0-00000.ts");
    const seg = await w.mgr.get(`/api/live/${w.matchId}/p0-00000.ts`);
    expect(seg.status).toBe(200);
    expect(seg.headers["content-type"]).toBe("video/mp2t");
    expect(seg.headers["cache-control"]).toContain("max-age=60");

    expect((await w.admin.get(url)).status).toBe(200);
    expect((await w.playing.get(url)).status).toBe(200);
    expect((await w.playing.get(`/api/live/${w.matchId}/p0-00000.ts`)).status).toBe(200);
    expect((await w.outsider.get(url)).status).toBe(403);
    expect((await w.other.get(url)).status).toBe(403);
    expect((await http().get(url)).status).toBe(401);
    expect((await http().get(url).set("Authorization", "Bearer not-a-token")).status).toBe(401);

    // team list
    const tl = await w.playing.get("/api/team/live");
    expect(tl.status).toBe(200);
    expect(tl.body.items).toEqual([expect.objectContaining({ matchId: w.matchId, hlsUrl: url, tournamentId: null, title: "Test Scrim" })]);
    expect((await w.outsider.get("/api/team/live")).body.items).toEqual([]);
  });

  it("path traversal, unknown files and stopped streams are 404", async () => {
    const w = await streaming();
    expect((await w.mgr.get(`/api/live/${w.matchId}/..%2F..%2Fsecret.ts`)).status).toBe(404);
    expect((await w.mgr.get(`/api/live/${w.matchId}/missing.ts`)).status).toBe(404);
    expect((await w.mgr.get(`/api/live/${w.matchId}/index.mp4`)).status).toBe(404);
    expect((await w.mgr.get(`/api/live/..%2F/index.m3u8`)).status).toBe(404);
    expect((await w.admin.get(`/api/live/nosuchmatch/index.m3u8`)).status).toBe(404);
    // a long-finished recording: no stream any more
    await prisma.matchRecording.updateMany({ where: { matchId: w.matchId }, data: { status: "READY", endedAt: new Date(Date.now() - 60 * 60_000) } });
    resetLiveCaches();
    expect((await w.mgr.get(`/api/live/${w.matchId}/index.m3u8`)).status).toBe(404);
    expect((await w.playing.get("/api/team/live")).body.items).toEqual([]);
  });

  it("not streaming yet → 404", async () => {
    const w = await world();
    expect((await w.mgr.get(`/api/live/${w.matchId}/index.m3u8`)).status).toBe(404);
  });
});

// ---------------------------------------------------------------- internal hooks

function sampleVideo(): Buffer | null {
  const out = path.join(tmpdir(), `7xen-station-test-${process.pid}.mp4`);
  const r = spawnSync(
    process.env.FFMPEG_PATH || "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=15", "-c:v", "mpeg4", "-pix_fmt", "yuv420p", "-y", out],
    { stdio: "ignore" },
  );
  if (r.status !== 0) return null;
  const buf = readFileSync(out);
  rmSync(out, { force: true });
  return buf;
}

describe("station: internal hooks", () => {
  const hook = (url: string, token: string | null = TOKEN) => {
    const req = http().post(url);
    return token == null ? req : req.set("X-Station-Token", token);
  };

  it("require the station token", async () => {
    const w = await world();
    await prepare(w.mgr, w.matchId, {});
    const rec = await prisma.matchRecording.findFirstOrThrow({ where: { matchId: w.matchId } });
    expect((await hook(`/api/internal/station/recordings/${rec.id}/complete`, null).send({ videoKey: "a.mp4", sizeBytes: 1 })).status).toBe(401);
    expect((await hook(`/api/internal/station/recordings/${rec.id}/fail`, "wrong").send({ error: "x" })).status).toBe(401);
    expect((await hook(`/api/internal/station/matches/${w.matchId}/screenshots`, "").field("kind", "RESULTS")).status).toBe(401);
    // a manager session is not a station token
    expect((await w.mgr.post(`/api/internal/station/recordings/${rec.id}/fail`).send({ error: "x" })).status).toBe(401);
  });

  it("complete: the station's MP4 goes through the poster/duration step → READY", async () => {
    const video = sampleVideo();
    const w = await world();
    const r = await prepare(w.mgr, w.matchId, {});
    const recId = (r.body as MatchLive).recordingId!;
    const videoKey = fake.seen.find((s) => s.url === "/sessions")!.body.videoKey as string;
    await w.mgr.post(`/api/manager/matches/${w.matchId}/station/stop`);

    expect((await hook(`/api/internal/station/recordings/${recId}/complete`).send({ videoKey, sizeBytes: 10 })).status).toBe(400); // file missing
    const abs = resolveVideoKey(videoKey);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, video ?? Buffer.alloc(4096, 1));
    const c = await hook(`/api/internal/station/recordings/${recId}/complete`).send({ videoKey, sizeBytes: video?.length ?? 4096, durationSec: 2 });
    expect(c.status, JSON.stringify(c.body)).toBe(204);
    const rec = await prisma.matchRecording.findUniqueOrThrow({ where: { id: recId } });
    expect(rec).toMatchObject({ status: "READY", videoKey, durationSec: 2 });
    expect(Number(rec.sizeBytes)).toBe(video?.length ?? 4096);
    if (video) {
      expect(rec.posterKey).toBeTruthy();
      expect(rec.width).toBe(320);
      const poster = await w.mgr.get(`/api/manager/recordings/${recId}/poster`);
      expect(poster.status).toBe(200);
      const v = await w.mgr.get(`/api/manager/recordings/${recId}/video`).set("Range", "bytes=0-99");
      expect(v.status).toBe(206);
    }
    // a station retry is harmless
    expect((await hook(`/api/internal/station/recordings/${recId}/complete`).send({ videoKey, sizeBytes: 1 })).status).toBe(204);
    // and fail after READY changes nothing
    expect((await hook(`/api/internal/station/recordings/${recId}/fail`).send({ error: "late" })).status).toBe(204);
    expect((await prisma.matchRecording.findUniqueOrThrow({ where: { id: recId } })).status).toBe("READY");
    // invalid key
    expect((await hook(`/api/internal/station/recordings/${recId}/complete`).send({ videoKey: "../../x.mp4", sizeBytes: 1 })).status).toBe(204); // already READY: ignored
  });

  it("fail: the recording becomes FAILED with the station's message", async () => {
    const w = await world();
    const r = await prepare(w.mgr, w.matchId, {});
    const recId = (r.body as MatchLive).recordingId!;
    const f = await hook(`/api/internal/station/recordings/${recId}/fail`).send({ error: "scrcpy could not start" });
    expect(f.status).toBe(204);
    expect(await prisma.matchRecording.findUniqueOrThrow({ where: { id: recId } })).toMatchObject({ status: "FAILED", error: "scrcpy could not start" });
    expect((await hook(`/api/internal/station/recordings/nope/fail`).send({ error: "x" })).status).toBe(404);
    // only station recordings
    const app = await prisma.matchRecording.create({ data: { matchId: w.matchId, managerId: (await prisma.user.findUniqueOrThrow({ where: { username: "boss" } })).id, deviceName: "Pixel 8" } });
    expect((await hook(`/api/internal/station/recordings/${app.id}/fail`).send({ error: "x" })).status).toBe(404);
  });

  it("screenshots: multipart → STATION screenshots in the normal pipeline", async () => {
    const w = await world();
    const r = await hook(`/api/internal/station/matches/${w.matchId}/screenshots`).field("kind", "SLOT_LIST").attach("files", PNG("hook-1"), "a.png");
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.items).toEqual([expect.objectContaining({ kind: "SLOT_LIST", source: "STATION", status: "QUEUED" })]);
    const boss = await prisma.user.findUniqueOrThrow({ where: { username: "boss" } });
    expect((await prisma.screenshot.findFirstOrThrow({ where: { matchId: w.matchId } })).uploadedById).toBe(boss.id);
    // the manager sees it in the match center
    const detail = await w.mgr.get(`/api/manager/matches/${w.matchId}`);
    expect(detail.body.screenshots[0].source).toBe("STATION");
    expect((await hook(`/api/internal/station/matches/nope/screenshots`).field("kind", "SLOT_LIST").attach("files", PNG("x"), "a.png")).status).toBe(404);
  });
});
