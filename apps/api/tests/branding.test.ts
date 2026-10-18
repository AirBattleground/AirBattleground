import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolveKey } from "../src/lib/storage.js";
import { adminAgent, createAdminUser, createManager, createScrim, createTeam, prisma, resetDb, server } from "./helpers.js";

beforeEach(async () => {
  await resetDb();
  await createAdminUser();
});
afterAll(async () => {
  await prisma.$disconnect();
  server.close();
});

function fakePng(salt: string): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "ascii");
  ihdr.writeUInt32BE(512, 8);
  ihdr.writeUInt32BE(512, 12);
  return Buffer.concat([sig, ihdr, Buffer.from(salt)]);
}
const png = { filename: "p.png", contentType: "image/png" };
const keyOf = (url: string) => url.replace(/^\/api\/media\//, "");

describe("branding images", () => {
  it("org logo + scrim poster: upload, show to teams, replace, remove", async () => {
    const admin = await adminAgent();
    const mgr = await createManager(admin, "boss");
    const other = await createManager(admin, "rival");
    const team = await createTeam(admin, "Team Soul", "soul");
    const scrim = await createScrim(mgr.agent);

    expect((await mgr.agent.get("/api/manager/branding")).body).toEqual({ url: null });
    const logo = await mgr.agent.put("/api/manager/branding/logo").attach("file", fakePng("logo"), png);
    expect(logo.status).toBe(200);
    expect(logo.body.url).toMatch(/^\/api\/media\/branding\/[a-f0-9]{32}\.png$/);

    const poster = await mgr.agent.put(`/api/manager/scrims/${scrim.id}/poster`).attach("file", fakePng("poster"), png);
    expect(poster.status).toBe(200);

    // someone else's scrim
    const steal = await other.agent.put(`/api/manager/scrims/${scrim.id}/poster`).attach("file", fakePng("x"), png);
    expect(steal.status).toBe(404);

    // DTO carries both URLs
    const s = (await mgr.agent.get(`/api/manager/scrims/${scrim.id}`)).body;
    expect(s.posterUrl).toBe(poster.body.url);
    expect(s.manager.logoUrl).toBe(logo.body.url);

    // a team can load the images; anonymous can't
    const img = await team.agent.get(poster.body.url);
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");
    expect((await team.agent.get("/api/media/branding/nothere.png")).status).toBe(404);
    expect((await (await import("./helpers.js")).http().get(poster.body.url)).status).toBe(401);

    // replacing deletes the old file
    const oldAbs = resolveKey(keyOf(poster.body.url));
    const again = await mgr.agent.put(`/api/manager/scrims/${scrim.id}/poster`).attach("file", fakePng("poster2"), png);
    expect(again.body.url).not.toBe(poster.body.url);
    expect(existsSync(oldAbs)).toBe(false);

    // remove
    const gone = await mgr.agent.delete(`/api/manager/scrims/${scrim.id}/poster`);
    expect(gone.body).toEqual({ url: null });
    expect((await mgr.agent.get(`/api/manager/scrims/${scrim.id}`)).body.posterUrl).toBeNull();
    expect((await mgr.agent.delete("/api/manager/branding/logo")).body).toEqual({ url: null });
  });

  it("rejects non-images and missing files; teams can't upload", async () => {
    const admin = await adminAgent();
    const mgr = await createManager(admin, "boss");
    const team = await createTeam(admin, "Team Soul", "soul");
    const bad = await mgr.agent.put("/api/manager/branding/logo").attach("file", Buffer.from("not an image"), { filename: "a.png", contentType: "image/png" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");
    const none = await mgr.agent.put("/api/manager/branding/logo").field("x", "y");
    expect(none.status).toBe(400);
    const forbidden = await team.agent.put("/api/manager/branding/logo").attach("file", fakePng("t"), png);
    expect(forbidden.status).toBe(403);
  });

  it("tournament poster shows on the tournament", async () => {
    const admin = await adminAgent();
    const mgr = await createManager(admin, "boss");
    const t = await prisma.tournament.create({ data: { managerId: mgr.row.id, title: "Champions Festival", maxTeams: 16 } });
    const up = await mgr.agent.put(`/api/manager/tournaments/${t.id}/poster`).attach("file", fakePng("t"), png);
    expect(up.status).toBe(200);
    const list = (await mgr.agent.get("/api/manager/tournaments")).body.items;
    expect(list[0].posterUrl).toBe(up.body.url);
    expect(list[0].manager.logoUrl).toBeNull();
  });
});
