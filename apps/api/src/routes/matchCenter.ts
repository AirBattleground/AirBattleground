/**
 * Match center routes (phase 2), shared by the manager router (own scrim/tournament matches) and the admin
 * router (any match; `bypass` skips the ownership check, the admin is recorded as uploader).
 */
import type { Router } from "express";
import { z } from "zod";
import { SCREENSHOT_KINDS, saveLineupSchema, saveResultsSchema } from "@7xen/shared";
import { sendStoredFile } from "../lib/storage.js";
import { parseMultipart, uploadedImages } from "../lib/upload.js";
import { parse } from "../lib/validate.js";
import { currentUser } from "../middleware/requireAuth.js";
import * as matches from "../services/matches.js";

const screenshotKindSchema = z.object({
  kind: z.enum(SCREENSHOT_KINDS, { errorMap: () => ({ message: "Choose what the screenshots show: team list or results" }) }),
});

export function mountMatchCenter(r: Router, bypass: boolean) {
  r.get("/matches/:matchId", async (req, res) => {
    res.json(await matches.getMatchDetail(req.params.matchId as string, currentUser(req).id, bypass));
  });
  r.post("/matches/:matchId/screenshots", async (req, res) => {
    await parseMultipart(req, res);
    const { kind } = parse(screenshotKindSchema, req.body);
    const images = uploadedImages(req, ["files", "files[]", "file"]);
    res.status(201).json(await matches.uploadScreenshots(req.params.matchId as string, currentUser(req).id, kind, images, bypass));
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
  r.post("/matches/:matchId/publish", async (req, res) => {
    res.json(await matches.publishMatch(req.params.matchId as string, currentUser(req).id, bypass));
  });
  r.post("/matches/:matchId/unpublish", async (req, res) => {
    res.json(await matches.unpublishMatch(req.params.matchId as string, currentUser(req).id, bypass));
  });
}
