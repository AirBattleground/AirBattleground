/**
 * Match center routes (phase 2), shared by the manager router (own scrim/tournament matches) and the admin
 * router (any match; `bypass` skips the ownership check, the admin is recorded as uploader).
 */
import type { Router } from "express";
import { z } from "zod";
import { SCREENSHOT_KINDS, liveAutoSchema, saveLineupSchema, saveLiveTeamSchema, saveResultsSchema } from "@7xen/shared";
import { sendStoredFile } from "../lib/storage.js";
import { parseMultipart, uploadedImages } from "../lib/upload.js";
import { parse } from "../lib/validate.js";
import { currentUser } from "../middleware/requireAuth.js";
import { liveCaptureFile } from "../services/liveCapture.js";
import * as live from "../services/liveStatus.js";
import * as matches from "../services/matches.js";

const screenshotKindSchema = z.object({
  kind: z.enum(SCREENSHOT_KINDS, { errorMap: () => ({ message: "Choose what the screenshots show: team list or results" }) }),
  /** phase 4: who took it (the manager app tags its uploads) */
  source: z
    .enum(matches.SCREENSHOT_SOURCES, { errorMap: () => ({ message: "Source must be WEB, APP_AUTO or APP_MANUAL" }) })
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export function mountMatchCenter(r: Router, bypass: boolean) {
  r.get("/matches/:matchId", async (req, res) => {
    res.json(await matches.getMatchDetail(req.params.matchId as string, currentUser(req).id, bypass));
  });
  r.post("/matches/:matchId/screenshots", async (req, res) => {
    await parseMultipart(req, res);
    const { kind, source } = parse(screenshotKindSchema, req.body);
    const images = uploadedImages(req, ["files", "files[]", "file"]);
    res.status(201).json(await matches.uploadScreenshots(req.params.matchId as string, currentUser(req).id, kind, images, bypass, source ?? "WEB"));
  });
  r.get("/screenshots/:id/image", async (req, res) => {
    const f = await matches.screenshotFile(req.params.id as string, currentUser(req).id, bypass);
    await sendStoredFile(res, f.storageKey, f.mimeType);
  });
  r.post("/screenshots/:id/retry", async (req, res) => {
    res.json(await matches.retryScreenshot(req.params.id as string, currentUser(req).id, bypass));
  });
  r.delete("/screenshots/:id", async (req, res) => {
    await matches.deleteScreenshot(req.params.id as string, currentUser(req).id, bypass);
    res.status(204).end();
  });
  r.put("/matches/:matchId/lineup", async (req, res) => {
    res.json(await matches.saveLineup(req.params.matchId as string, currentUser(req).id, parse(saveLineupSchema, req.body), bypass));
  });
  r.put("/matches/:matchId/results", async (req, res) => {
    res.json(await matches.saveResults(req.params.matchId as string, currentUser(req).id, parse(saveResultsSchema, req.body), bypass));
  });
  // live team status for the studio's Team Status board
  r.get("/matches/:matchId/team-status", async (req, res) => {
    res.json(await live.getLive(req.params.matchId as string, currentUser(req).id, bypass));
  });
  r.patch("/matches/:matchId/team-status", async (req, res) => {
    res.json(await live.saveLiveTeam(req.params.matchId as string, currentUser(req).id, parse(saveLiveTeamSchema, req.body), bypass));
  });
  r.patch("/matches/:matchId/team-status/auto", async (req, res) => {
    res.json(await live.setAutoPaused(req.params.matchId as string, currentUser(req).id, parse(liveAutoSchema, req.body).paused, bypass));
  });
  r.get("/matches/:matchId/captures/:id/image", async (req, res) => {
    const f = await liveCaptureFile(req.params.matchId as string, req.params.id as string, currentUser(req).id, bypass);
    await sendStoredFile(res, f.storageKey, f.mimeType);
  });
  r.post("/matches/:matchId/publish", async (req, res) => {
    res.json(await matches.publishMatch(req.params.matchId as string, currentUser(req).id, bypass));
  });
  r.post("/matches/:matchId/unpublish", async (req, res) => {
    res.json(await matches.unpublishMatch(req.params.matchId as string, currentUser(req).id, bypass));
  });
}
