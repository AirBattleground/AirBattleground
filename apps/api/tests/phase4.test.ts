import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addDays, sessionStartsAt, type LiveMatchCard, type RecordingRow, type TeamRoomCard } from "@7xen/shared";
import { storageRoot } from "../src/lib/storage.js";
import { resolveVideoKey } from "../src/lib/video.js";
import { teamRooms } from "../src/services/live.js";
import { DEFAULT_RECIPES, ensureDefaultRecipes } from "../src/services/recipes.js";
import { runRetentionSweep } from "../src/services/recordings.js";
import { adminAgent, createAdminUser, createManager, createScrim, createTeam, http, prisma, resetDb, server, today, tomorrow, type TestAgent } from "./helpers.js";

beforeEach(async () => {
  await resetDb();
  await createAdminUser();
});
afterAll(async () => {
  await prisma.$disconnect();
  server.close();
});

// ---------------------------------------------------------------- helpers

const MGR_PASSWORD = "Manager@123";

async function tokenFor(username: string, password = MGR_PASSWORD) {
  return http().post("/api/auth/token").send({ username, password, deviceName: "Pixel 8" });
}

/** Bearer-authenticated request helper. */
function bearer(token: string) {
  const auth = (r: ReturnType<ReturnType<typeof http>["get"]>) => r.set("Authorization", `Bearer ${token}`);
  return {
    get: (url: string) => auth(http().get(url)),
    post: (url: string) => auth(http().post(url)),
    put: (url: string) => auth(http().put(url)),
    patch: (url: string) => auth(http().patch(url)),
    del: (url: string) => auth(http().delete(url)),
    head: (url: string) => auth(http().head(url)),
  };
}
type Bearer = ReturnType<typeof bearer>;

function fakePng(salt: string, w = 1600, h = 720): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "ascii");
  ihdr.writeUInt32BE(w, 8);
  ihdr.writeUInt32BE(h, 12);
  return Buffer.concat([sig, ihdr, Buffer.from(salt)]);
}

/** Manager (cookie + bearer) with a daily scrim (21:00 IST, slots 3..6, 2 maps). */
async function world() {
  const admin = await adminAgent();
  const mgr = await createManager(admin, "boss");
  const tok = await tokenFor("boss");
  expect(tok.status, JSON.stringify(tok.body)).toBe(200);
  const scrim = await createScrim(mgr.agent);
  return { admin, mgr: mgr.agent, app: bearer(tok.body.token as string), scrim };
}

/** Session matches for a scrim/date (creates them). */
async function sessionMatches(mgr: TestAgent, scrimId: string, date: string) {
  const r = await mgr.get(`/api/manager/scrims/${scrimId}/sessions/${date}/matches`);
  expect(r.status).toBe(200);
  return r.body.items as { id: string; number: number }[];
}

async function approve(sessionScrimId: string, date: string, teamId: string, slotNumber: number) {
  const session = await prisma.scrimSession.upsert({
    where: { scrimId_date: { scrimId: sessionScrimId, date: new Date(`${date}T00:00:00.000Z`) } },
    create: { scrimId: sessionScrimId, date: new Date(`${date}T00:00:00.000Z`) },
    update: {},
  });
  await prisma.registration.create({ data: { sessionId: session.id, teamId, status: "APPROVED", slotNumber } });
}

/** A live tournament with one group (teams on slots) and matches at the given instants. */
async function tournamentWithMatches(managerId: string, teamIds: string[], times: Date[]) {
  const t = await prisma.tournament.create({ data: { managerId, title: "Monsoon Cup", status: "LIVE", maxTeams: 16, firstSlot: 1 } });
  const stage = await prisma.tournamentStage.create({
    data: { tournamentId: t.id, order: 1, name: "Qualifier", status: "LIVE", teamsIn: 16, lobbySize: 16, groupCount: 1, matchesPerGroup: times.length, maps: times.map(() => "ERANGEL"), advancePerGroup: 4 },
  });
  const group = await prisma.tournamentGroup.create({ data: { stageId: stage.id, index: 0, name: "A", startsAt: times[0] } });
  for (const [i, teamId] of teamIds.entries()) await prisma.groupTeam.create({ data: { groupId: group.id, teamId, slotNumber: i + 1 } });
  const matches = [];
  for (const [i, at] of times.entries()) {
    matches.push(await prisma.match.create({ data: { groupId: group.id, number: i + 1, map: "MIRAMAR", scheduledAt: at } }));
  }
  return { tournament: t, group, matches };
}

const ffmpegAvailable = (() => {
  try {
    return spawnSync(process.env.FFMPEG_PATH || "ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
})();

/** A tiny real mp4 (2 s, 320x240) when ffmpeg exists; otherwise just bytes. */
function sampleVideo(): Buffer {
  if (ffmpegAvailable) {
    const out = path.join(tmpdir(), `7xen-test-${process.pid}.mp4`);
    const r = spawnSync(
      process.env.FFMPEG_PATH || "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=15", "-c:v", "mpeg4", "-pix_fmt", "yuv420p", "-y", out],
      { stdio: "ignore" },
    );
    if (r.status === 0) {
      const buf = readFileSync(out);
      rmSync(out, { force: true });
      return buf;
    }
  }
  return Buffer.concat([Buffer.from("not really a video "), Buffer.alloc(5000, 7)]);
}

// ---------------------------------------------------------------- auth

describe("mobile bearer auth", () => {
  it("issues 30-day tokens to managers only and accepts them on manager routes", async () => {
    const admin = await adminAgent();
    await createManager(admin, "boss");
    const team = await createTeam(admin, "Team Bearer", "bearerteam");

    const ok = await tokenFor("boss");
    expect(ok.status).toBe(200);
    expect(ok.headers["set-cookie"]).toBeUndefined();
    expect(ok.body.user).toMatchObject({ username: "boss", role: "MANAGER" });
    const days = (new Date(ok.body.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);

    const app = bearer(ok.body.token);
    expect((await app.get("/api/auth/me")).body.user.username).toBe("boss");
    expect((await app.get("/api/manager/live/today")).status).toBe(200);
    expect((await app.get("/api/manager/scrims")).status).toBe(200);
    // a manager token can't reach team or admin areas
    expect((await app.get("/api/team/rooms")).status).toBe(403);
    expect((await app.get("/api/admin/stats")).status).toBe(403);

    expect((await tokenFor("boss", "nope")).status).toBe(401);
    // phase 5: players have no username/password at all
    expect((await tokenFor("bearerteam", "Team@1234")).status).toBe(401);
    expect(team.row.id).toBeTruthy();
    expect((await tokenFor("admin", "Admin@12345")).status).toBe(401);
    expect((await http().post("/api/auth/token").send({ username: "" })).status).toBe(400);

    // invalid bearer: 401, and it never clears a cookie
    const bad = await bearer("garbage").get("/api/manager/scrims");
    expect(bad.status).toBe(401);
    expect(bad.headers["set-cookie"]).toBeUndefined();

    // bearer wins over the cookie: a team cookie + manager bearer → manager
    const mixed = await team.agent.get("/api/manager/scrims").set("Authorization", `Bearer ${ok.body.token}`);
    expect(mixed.status).toBe(200);
    // cookies alone keep working exactly as before
    expect((await team.agent.get("/api/manager/scrims")).status).toBe(403);
    expect((await team.agent.get("/api/team/rooms")).status).toBe(200);

    // disabled managers are kicked out immediately
    const mgrRow = await prisma.user.findUniqueOrThrow({ where: { username: "boss" } });
    await prisma.user.update({ where: { id: mgrRow.id }, data: { isActive: false } });
    expect((await app.get("/api/manager/scrims")).status).toBe(401);
  });
});

// ---------------------------------------------------------------- today + room

describe("match day", () => {
  it("lists today's scrim and tournament matches soonest first", async () => {
    const { admin, app, scrim } = await world();
    const t1 = await createTeam(admin, "Alpha", "alpha");
    const t2 = await createTeam(admin, "Bravo", "bravo");
    await approve(scrim.id, today(), t1.row.id, 3);
    await approve(scrim.id, today(), t2.row.id, 4);
    const mgrId = (await prisma.user.findUniqueOrThrow({ where: { username: "boss" } })).id;
    const tomorrow1800 = sessionStartsAt(tomorrow(), "18:00");
    const later = sessionStartsAt(addDays(today(), 10), "18:00");
    await tournamentWithMatches(mgrId, [t1.row.id, t2.row.id], [tomorrow1800, later]);

    const r = await app.get("/api/manager/live/today?days=1");
    expect(r.status).toBe(200);
    const items = r.body.items as LiveMatchCard[];
    expect(items.map((m) => `${m.kind}:${m.number}`)).toEqual(["SCRIM:1", "SCRIM:2", "TOURNAMENT:1", "SCRIM:1", "SCRIM:2"]);
    const first = items[0]!;
    expect(first).toMatchObject({
      title: "Test Scrim",
      map: "ERANGEL",
      status: "SCHEDULED",
      teamsCount: 2,
      slotRange: { first: 3, last: 6 },
      room: null,
      recording: null,
      screenshotCounts: { slotList: 0, results: 0 },
      startsAt: sessionStartsAt(today(), "21:00").toISOString(),
    });
    expect(first.subtitle).toMatch(/· Match 1$/);
    expect(items[2]).toMatchObject({ kind: "TOURNAMENT", title: "Monsoon Cup", subtitle: "Qualifier · Group A · Match 1", teamsCount: 2, startsAt: tomorrow1800.toISOString(), slotRange: { first: 1, last: 16 } });
    expect(items[3]!.teamsCount).toBe(0);

    // days=0 → today only; other managers see nothing of this
    expect(((await app.get("/api/manager/live/today?days=0")).body.items as unknown[]).length).toBe(2);
    expect((await app.get("/api/manager/live/today?days=99")).status).toBe(400);
    const other = await createManager(admin, "other");
    expect((await other.agent.get("/api/manager/live/today")).body.items).toEqual([]);
  });

  it("saves room details, reveals them to the lineup at the right time, hides them from everyone else", async () => {
    const { admin, mgr, app, scrim } = await world();
    const inLineup = await createTeam(admin, "Alpha", "alpha");
    const pending = await createTeam(admin, "Bravo", "bravo");
    const outsider = await createTeam(admin, "Charlie", "charlie");
    const date = tomorrow();
    await approve(scrim.id, date, inLineup.row.id, 5);
    const session = await prisma.scrimSession.findFirstOrThrow({ where: { scrimId: scrim.id } });
    await prisma.registration.create({ data: { sessionId: session.id, teamId: pending.row.id, status: "PENDING" } });
    const [m1] = await sessionMatches(mgr, scrim.id, date);

    expect((await app.get(`/api/manager/matches/${m1!.id}/room`)).body).toBeNull();
    expect((await app.put(`/api/manager/matches/${m1!.id}/room`).send({ roomId: "abc", password: "x" })).status).toBe(400);

    const saved = await app.put(`/api/manager/matches/${m1!.id}/room`).send({ roomId: "1234567", password: "7xen", revealMinutesBefore: 15 });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const startsAt = sessionStartsAt(date, "21:00");
    expect(saved.body).toMatchObject({ roomId: "1234567", password: "7xen", revealAt: new Date(startsAt.getTime() - 15 * 60_000).toISOString() });
    expect((await mgr.get(`/api/manager/matches/${m1!.id}/room`)).body.roomId).toBe("1234567");

    // other managers can't touch it
    const other = await createManager(admin, "other");
    expect((await other.agent.put(`/api/manager/matches/${m1!.id}/room`).send({ roomId: "1111", password: "x" })).status).toBe(404);

    // before reveal: the lineup team sees the match (slot + reveal time) without the room
    const before = await inLineup.agent.get("/api/team/rooms");
    expect(before.status).toBe(200);
    const cards = before.body.items as TeamRoomCard[];
    expect(cards.map((c) => c.number)).toEqual([1, 2]);
    expect(cards[0]).toMatchObject({ matchId: m1!.id, slotNumber: 5, room: null, revealAt: saved.body.revealAt, title: "Test Scrim" });
    expect(cards[1]!.revealAt).toBeNull();
    // after reveal time
    const after = await teamRooms(inLineup.row.id, new Date(startsAt.getTime() - 14 * 60_000));
    expect(after[0]!.room).toEqual({ roomId: "1234567", password: "7xen" });
    expect((await teamRooms(inLineup.row.id, new Date(startsAt.getTime() - 16 * 60_000)))[0]!.room).toBeNull();

    // pending / unrelated teams see nothing
    expect((await pending.agent.get("/api/team/rooms")).body.items).toEqual([]);
    expect((await outsider.agent.get("/api/team/rooms")).body.items).toEqual([]);

    // reveal now (null), then delete
    await app.put(`/api/manager/matches/${m1!.id}/room`).send({ roomId: "7654321", password: "go", revealMinutesBefore: null });
    expect(((await inLineup.agent.get("/api/team/rooms")).body.items as TeamRoomCard[])[0]!.room).toEqual({ roomId: "7654321", password: "go" });
    const todayList = await app.get("/api/manager/live/today?days=1");
    expect((todayList.body.items as LiveMatchCard[]).find((c) => c.matchId === m1!.id)!.room).toMatchObject({ roomId: "7654321", revealAt: null });
    expect((await app.del(`/api/manager/matches/${m1!.id}/room`)).status).toBe(204);
    expect(((await inLineup.agent.get("/api/team/rooms")).body.items as TeamRoomCard[])[0]!.room).toBeNull();

    // published matches drop off the team's list
    await prisma.match.update({ where: { id: m1!.id }, data: { status: "PUBLISHED" } });
    expect(((await inLineup.agent.get("/api/team/rooms")).body.items as TeamRoomCard[]).map((c) => c.number)).toEqual([2]);
  });

  it("shows tournament group rooms to the group's teams", async () => {
    const { admin } = await world();
    const a = await createTeam(admin, "Alpha", "alpha");
    const b = await createTeam(admin, "Bravo", "bravo");
    const mgrId = (await prisma.user.findUniqueOrThrow({ where: { username: "boss" } })).id;
    const at = sessionStartsAt(tomorrow(), "18:00");
    const { matches } = await tournamentWithMatches(mgrId, [a.row.id], [at]);
    const tok = await tokenFor("boss");
    const app = bearer(tok.body.token);
    const r = await app.put(`/api/manager/matches/${matches[0]!.id}/room`).send({ roomId: "998877", password: "cup", revealMinutesBefore: 30 });
    expect(r.body.revealAt).toBe(new Date(at.getTime() - 30 * 60_000).toISOString());
    const cards = (await a.agent.get("/api/team/rooms")).body.items as TeamRoomCard[];
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ title: "Monsoon Cup", subtitle: "Qualifier · Group A · Match 1", slotNumber: 1, room: null });
    expect((await teamRooms(a.row.id, new Date(at.getTime() - 60_000)))[0]!.room).toEqual({ roomId: "998877", password: "cup" });
    expect((await b.agent.get("/api/team/rooms")).body.items).toEqual([]);
  });
});

// ---------------------------------------------------------------- screenshots

describe("screenshot source", () => {
  it("tags uploads from the app (bearer) and defaults to WEB", async () => {
    const { mgr, app, scrim } = await world();
    const [m1] = await sessionMatches(mgr, scrim.id, today());
    const viaApp = await app.post(`/api/manager/matches/${m1!.id}/screenshots`).field("kind", "SLOT_LIST").field("source", "APP_AUTO").attach("files", fakePng("a"), { filename: "a.png", contentType: "image/png" });
    expect(viaApp.status, JSON.stringify(viaApp.body)).toBe(201);
    expect(viaApp.body.items[0].source).toBe("APP_AUTO");
    const viaWeb = await mgr.post(`/api/manager/matches/${m1!.id}/screenshots`).field("kind", "RESULTS").attach("files", fakePng("b"), { filename: "b.png", contentType: "image/png" });
    expect(viaWeb.body.items[0].source).toBe("WEB");
    const bad = await app.post(`/api/manager/matches/${m1!.id}/screenshots`).field("kind", "RESULTS").field("source", "PHONE").attach("files", fakePng("c"), { filename: "c.png", contentType: "image/png" });
    expect(bad.status).toBe(400);
    const detail = await mgr.get(`/api/manager/matches/${m1!.id}`);
    expect(detail.body.screenshots.map((s: { source: string }) => s.source)).toEqual(["APP_AUTO", "WEB"]);
    const card = ((await app.get("/api/manager/live/today?days=0")).body.items as LiveMatchCard[]).find((c) => c.matchId === m1!.id)!;
    expect(card.screenshotCounts).toEqual({ slotList: 1, results: 1 });
  });
});

// ---------------------------------------------------------------- recordings

async function uploadAll(app: Bearer, id: string, video: Buffer) {
  const created = await app.post(`/api/manager/recordings/${id}/upload`).send({ sizeBytes: video.length, width: 320, height: 240 });
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  const r = await app.patch(`/api/manager/recordings/${id}/upload`).set("Content-Type", "application/octet-stream").set("Upload-Offset", "0").send(video);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const done = await app.post(`/api/manager/recordings/${id}/upload/complete`);
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  return done.body as RecordingRow;
}

describe("recordings", () => {
  it("live session → events → chunked upload with an offset mismatch + resume → ready → range playback", async () => {
    const { admin, mgr, app, scrim } = await world();
    const [m1] = await sessionMatches(mgr, scrim.id, today());
    const base = `/api/manager/matches/${m1!.id}/recordings`;

    const started = await app.post(base).send({ deviceName: "Pixel 8", appVersion: "0.1.0" });
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    const rec = started.body as RecordingRow;
    expect(rec).toMatchObject({ status: "LIVE", deviceName: "Pixel 8", uploadedBytes: 0, sizeBytes: null, hasPoster: false, captures: { slotList: 0, results: 0 } });
    expect(rec.events[0]).toMatchObject({ type: "start", detail: "Pixel 8" });
    const dup = await app.post(base).send({});
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toMatch(/Pixel 8/);

    // a capture from the app counts toward the recording
    await app.post(`/api/manager/matches/${m1!.id}/screenshots`).field("kind", "SLOT_LIST").field("source", "APP_AUTO").attach("files", fakePng("cap"), { filename: "a.png", contentType: "image/png" });

    const at = new Date().toISOString();
    const ev = await app.patch(`/api/manager/recordings/${rec.id}`).send({ events: [{ at, type: "room_created", detail: "1234567" }, { at, type: "capture", detail: "SLOT_LIST" }] });
    expect(ev.status, JSON.stringify(ev.body)).toBe(200);
    expect(ev.body.events.map((e: { type: string }) => e.type)).toEqual(["start", "room_created", "capture"]);
    expect(ev.body.captures).toEqual({ slotList: 1, results: 0 });

    // events are capped at 500 (oldest dropped)
    for (let i = 0; i < 3; i++) {
      const events = Array.from({ length: 200 }, (_, j) => ({ at, type: "screen", detail: `b${i}-${j}` }));
      expect((await app.patch(`/api/manager/recordings/${rec.id}`).send({ events })).status).toBe(200);
    }
    const capped = await app.patch(`/api/manager/recordings/${rec.id}`).send({ status: "STOPPED", durationSec: 2, events: [{ at, type: "stop", detail: null }] });
    expect(capped.body.events).toHaveLength(500);
    expect(capped.body.events.at(-1).type).toBe("stop");
    expect(capped.body).toMatchObject({ status: "STOPPED", durationSec: 2 });
    expect(capped.body.endedAt).not.toBeNull();
    expect((await app.patch(`/api/manager/recordings/${rec.id}`).send({ events: [{ at: "yesterday", type: "note" }] })).status).toBe(400);

    // a new recording can start once the first is stopped
    const second = await app.post(base).send({ deviceName: "Backup phone" });
    expect(second.status).toBe(201);
    const list = await mgr.get(base);
    expect(list.body.items.map((r: RecordingRow) => r.id)).toEqual([second.body.id, rec.id]);

    // other managers and teams are kept out
    const other = await createManager(admin, "other");
    expect((await other.agent.patch(`/api/manager/recordings/${rec.id}`).send({ status: "FAILED" })).status).toBe(404);
    expect((await other.agent.get(base)).status).toBe(404);

    // ---- resumable upload ----
    const video = sampleVideo();
    const size = video.length;
    const up = `/api/manager/recordings/${rec.id}/upload`;
    expect((await app.head(up)).status).toBe(404); // not started
    expect((await app.patch(up).set("Content-Type", "application/octet-stream").set("Upload-Offset", "0").send(video)).status).toBe(409);

    const created = await app.post(up).send({ sizeBytes: size });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    expect(created.body).toMatchObject({ recordingId: rec.id, offset: 0, sizeBytes: size, complete: false });
    expect(created.body.chunkSize).toBeGreaterThan(0);
    expect((await app.post(up).send({ sizeBytes: size })).body.offset).toBe(0); // idempotent

    const half = Math.floor(size / 2);
    const c1 = await app.patch(up).set("Content-Type", "application/octet-stream").set("Upload-Offset", "0").send(video.subarray(0, half));
    expect(c1.status, JSON.stringify(c1.body)).toBe(200);
    expect(c1.body.offset).toBe(half);
    expect(c1.headers["upload-offset"]).toBe(String(half));

    // the app lost track and resends from 0 → 409 with the real offset
    const mismatch = await app.patch(up).set("Content-Type", "application/octet-stream").set("Upload-Offset", "0").send(video.subarray(0, half));
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error.code).toBe("OFFSET_MISMATCH");
    expect(mismatch.body.offset).toBe(half);
    expect(mismatch.headers["upload-offset"]).toBe(String(half));

    // finishing too early is refused, with the offset to resume from
    const early = await app.post(`${up}/complete`);
    expect(early.status).toBe(409);
    expect(early.body).toMatchObject({ error: { code: "OFFSET_MISMATCH" }, offset: half });

    // wrong content type / missing header
    expect((await app.patch(up).set("Content-Type", "application/json").set("Upload-Offset", String(half)).send("{}")).status).toBe(415);
    expect((await app.patch(up).set("Content-Type", "application/octet-stream").send(Buffer.from("x"))).status).toBe(400);
    // more than the declared size is refused and nothing is written
    const tooMuch = await app.patch(up).set("Content-Type", "application/octet-stream").set("Upload-Offset", String(half)).send(Buffer.concat([video.subarray(half), Buffer.from("extra")]));
    expect(tooMuch.status).toBe(400);

    // resume: HEAD → offset, then send the rest
    const head = await app.head(up);
    expect(head.status).toBe(204);
    expect(head.headers["upload-offset"]).toBe(String(half));
    expect(head.headers["upload-length"]).toBe(String(size));
    const c2 = await app.patch(up).set("Content-Type", "application/offset+octet-stream").set("Upload-Offset", String(half)).send(video.subarray(half));
    expect(c2.status).toBe(200);
    expect(c2.body).toMatchObject({ offset: size, complete: true });

    const done = await app.post(`${up}/complete`);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const ready = done.body as RecordingRow;
    expect(ready).toMatchObject({ status: "READY", sizeBytes: size, uploadedBytes: size });
    if (ffmpegAvailable) {
      expect(ready).toMatchObject({ width: 320, height: 240, durationSec: 2, hasPoster: true });
      const poster = await app.get(`/api/manager/recordings/${rec.id}/poster`);
      expect(poster.status).toBe(200);
      expect(poster.headers["content-type"]).toBe("image/jpeg");
    }
    expect((await app.post(`${up}/complete`)).body.status).toBe("READY"); // idempotent
    expect((await app.post(up).send({ sizeBytes: size })).status).toBe(409);

    // playback: full + range (cookie auth from the web works too)
    const full = await mgr.get(`/api/manager/recordings/${rec.id}/video`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(full.status).toBe(200);
    expect(full.headers["accept-ranges"]).toBe("bytes");
    expect(full.headers["content-type"]).toBe("video/mp4");
    expect(Buffer.compare(full.body as Buffer, video)).toBe(0);
    const part = await app.get(`/api/manager/recordings/${rec.id}/video`).set("Range", "bytes=10-109").buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(part.status).toBe(206);
    expect(part.headers["content-range"]).toBe(`bytes 10-109/${size}`);
    expect(part.headers["content-length"]).toBe("100");
    expect(Buffer.compare(part.body as Buffer, video.subarray(10, 110))).toBe(0);
    const tail = await app.get(`/api/manager/recordings/${rec.id}/video`).set("Range", "bytes=-10");
    expect(tail.headers["content-range"]).toBe(`bytes ${size - 10}-${size - 1}/${size}`);
    expect((await app.get(`/api/manager/recordings/${rec.id}/video`).set("Range", `bytes=${size}-`)).status).toBe(416);
    expect((await other.agent.get(`/api/manager/recordings/${rec.id}/video`)).status).toBe(404);

    // the today card shows the latest recording
    const card = ((await app.get("/api/manager/live/today?days=0")).body.items as LiveMatchCard[]).find((c) => c.matchId === m1!.id)!;
    expect(card.recording?.id).toBe(second.body.id);

    // admin: list, stream, delete
    const adminList = await admin.get("/api/admin/recordings?status=READY");
    expect(adminList.status).toBe(200);
    expect(adminList.body.items).toHaveLength(1);
    expect(adminList.body.items[0]).toMatchObject({ id: rec.id, manager: { displayName: "Manager boss" } });
    expect(adminList.body.items[0].matchTitle).toMatch(/^Test Scrim · .* · Match 1$/);
    expect((await admin.get("/api/admin/recordings?q=backup")).body.items.map((r: RecordingRow) => r.id)).toEqual([second.body.id]);
    expect((await admin.get(`/api/admin/recordings/${rec.id}/video`).set("Range", "bytes=0-0")).status).toBe(206);
    const key = (await prisma.matchRecording.findUniqueOrThrow({ where: { id: rec.id } })).videoKey!;
    expect(existsSync(resolveVideoKey(key))).toBe(true);
    expect((await admin.delete(`/api/admin/recordings/${rec.id}`)).status).toBe(204);
    expect(existsSync(resolveVideoKey(key))).toBe(false);
    expect((await app.get(`/api/manager/recordings/${rec.id}/video`)).status).toBe(404);
    expect((await mgr.get(base)).body.items.find((r: RecordingRow) => r.id === rec.id).status).toBe("DELETED");
  });

  it("keeps a READY video without poster when ffmpeg can't read it", async () => {
    const { mgr, app, scrim } = await world();
    const [m1] = await sessionMatches(mgr, scrim.id, today());
    const rec = (await app.post(`/api/manager/matches/${m1!.id}/recordings`).send({})).body as RecordingRow;
    const done = await uploadAll(app, rec.id, Buffer.from("definitely not an mp4 file"));
    expect(done).toMatchObject({ status: "READY", hasPoster: false, width: 320, height: 240 });
  });

  it("retention sweep deletes videos older than the setting", async () => {
    const { admin, mgr, app, scrim } = await world();
    const [m1, m2] = await sessionMatches(mgr, scrim.id, today());
    const oldRec = (await app.post(`/api/manager/matches/${m1!.id}/recordings`).send({})).body as RecordingRow;
    await uploadAll(app, oldRec.id, Buffer.from("old video bytes"));
    const newRec = (await app.post(`/api/manager/matches/${m2!.id}/recordings`).send({})).body as RecordingRow;
    await uploadAll(app, newRec.id, Buffer.from("new video bytes"));

    const s = await admin.patch("/api/admin/settings").send({ videoRetentionDays: 7 });
    expect(s.status).toBe(200);
    expect(s.body.videoRetentionDays).toBe(7);
    await prisma.matchRecording.update({ where: { id: oldRec.id }, data: { createdAt: new Date(Date.now() - 8 * 86_400_000) } });
    const key = (await prisma.matchRecording.findUniqueOrThrow({ where: { id: oldRec.id } })).videoKey!;

    expect(await runRetentionSweep()).toBe(1);
    expect(existsSync(resolveVideoKey(key))).toBe(false);
    const rows = await prisma.matchRecording.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.status)).toEqual(["DELETED", "READY"]);
    expect(await runRetentionSweep()).toBe(0);
  });
});

// ---------------------------------------------------------------- admin settings

describe("admin settings", () => {
  it("returns retention (default 30) and video storage usage; validates updates", async () => {
    const { admin, app, mgr, scrim } = await world();
    const s = await admin.get("/api/admin/settings");
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ videoRetentionDays: 30, videoStorage: { usedBytes: 0, videos: 0 } });
    expect(s.body.videoStorage.dir).toBe(path.resolve(process.env.VIDEO_DIR!));
    expect(typeof s.body.videoStorage.freeBytes).toBe("number");
    expect((await admin.patch("/api/admin/settings").send({ videoRetentionDays: 0 })).status).toBe(400);
    expect((await mgr.get("/api/admin/settings")).status).toBe(401);

    const [m1] = await sessionMatches(mgr, scrim.id, today());
    const rec = (await app.post(`/api/manager/matches/${m1!.id}/recordings`).send({})).body as RecordingRow;
    await uploadAll(app, rec.id, Buffer.alloc(1234, 1));
    expect((await admin.get("/api/admin/settings")).body.videoStorage).toMatchObject({ usedBytes: 1234, videos: 1 });
  });
});

// ---------------------------------------------------------------- recipes

describe("recipes", () => {
  it("merges admin defaults with the manager's own versions", async () => {
    const { admin, app } = await world();
    expect(await ensureDefaultRecipes()).toBe(3);
    expect(await ensureDefaultRecipes()).toBe(0); // idempotent

    const defaults = await app.get("/api/manager/recipes");
    expect(defaults.status).toBe(200);
    expect(defaults.body.items.map((r: { key: string; scope: string }) => `${r.key}:${r.scope}`)).toEqual(["CREATE_ROOM:DEFAULT", "OPEN_TEAM_LIST:DEFAULT", "SCROLL_RESULTS:DEFAULT"]);
    expect(defaults.body.items[0].steps.length).toBe(DEFAULT_RECIPES[0]!.steps.length);
    expect(defaults.body.items[0].steps.every((s: { action: { type: string } }) => s.action.type === "manual")).toBe(true);

    const taught = {
      name: "My room flow",
      deviceProfile: "2400x1080",
      steps: [
        { id: "a", label: "Open Custom Room", action: { type: "tap", x: 0.9, y: 0.1 } },
        { id: "b", label: "Wait", action: { type: "wait", ms: 1000 } },
      ],
    };
    const put = await app.put("/api/manager/recipes/CREATE_ROOM").send(taught);
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body).toMatchObject({ key: "CREATE_ROOM", scope: "MANAGER", version: 1, deviceProfile: "2400x1080" });
    expect(put.body.steps[0].timeoutMs).toBe(15000);
    expect((await app.put("/api/manager/recipes/CREATE_ROOM").send(taught)).body.version).toBe(2);
    expect((await app.put("/api/manager/recipes/NOPE").send(taught)).status).toBe(400);
    expect((await app.put("/api/manager/recipes/CREATE_ROOM").send({ name: "x", steps: [] })).status).toBe(400);

    const merged = await app.get("/api/manager/recipes");
    expect(merged.body.items.map((r: { key: string; scope: string }) => `${r.key}:${r.scope}`)).toEqual(["CREATE_ROOM:MANAGER", "OPEN_TEAM_LIST:DEFAULT", "SCROLL_RESULTS:DEFAULT"]);

    // another manager still gets the default
    const other = await createManager(admin, "other");
    expect((await other.agent.get("/api/manager/recipes")).body.items[0]).toMatchObject({ key: "CREATE_ROOM", scope: "DEFAULT" });

    // admin edits the default (version bump), sees every recipe, can delete a manager's
    const adminPut = await admin.put("/api/admin/recipes/SCROLL_RESULTS").send({ name: "Results v2", steps: [{ id: "x", label: "Swipe", action: { type: "manual" } }] });
    expect(adminPut.body).toMatchObject({ scope: "DEFAULT", version: 2, name: "Results v2" });
    const all = await admin.get("/api/admin/recipes");
    expect(all.body.items).toHaveLength(4);
    const mine = all.body.items.find((r: { scope: string }) => r.scope === "MANAGER");
    expect(mine.manager).toMatchObject({ displayName: "Manager boss" });
    expect((await admin.delete(`/api/admin/recipes/${mine.id}`)).status).toBe(204);
    expect((await app.get("/api/manager/recipes")).body.items[0].scope).toBe("DEFAULT");
    expect((await app.get("/api/admin/recipes")).status).toBe(403);
  });
});

// ---------------------------------------------------------------- app release

describe("manager app release", () => {
  it("is null / 404 until an APK is published, then downloads it", async () => {
    const dir = path.join(storageRoot(), "apps", "manager");
    rmSync(dir, { recursive: true, force: true });
    expect((await http().get("/api/app/manager/latest")).body).toBeNull();
    expect((await http().get("/api/app/manager/download")).status).toBe(404);

    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "7xen-manager-0.1.0.apk"), Buffer.alloc(2048, 3));
    writeFileSync(path.join(dir, "latest.json"), JSON.stringify({ version: "0.1.0", versionCode: 1, file: "7xen-manager-0.1.0.apk", notes: "First build", publishedAt: "2026-10-17T10:00:00Z" }));
    try {
      const latest = await http().get("/api/app/manager/latest");
      expect(latest.body).toEqual({ version: "0.1.0", versionCode: 1, url: "/api/app/manager/download", sizeBytes: 2048, notes: "First build", publishedAt: "2026-10-17T10:00:00.000Z" });
      const dl = await http().get("/api/app/manager/download");
      expect(dl.status).toBe(200);
      expect(dl.headers["content-type"]).toBe("application/vnd.android.package-archive");
      expect(dl.headers["content-disposition"]).toBe('attachment; filename="7xen-manager-0.1.0.apk"');
      expect(dl.headers["content-length"]).toBe("2048");

      // a manifest pointing outside the folder is ignored
      writeFileSync(path.join(dir, "latest.json"), JSON.stringify({ version: "0.1.1", versionCode: 2, file: "../../secret.apk", publishedAt: "2026-10-17T10:00:00Z" }));
      expect((await http().get("/api/app/manager/latest")).body).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

