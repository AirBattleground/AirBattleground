import { Router } from "express";
import { z } from "zod";
import {
  SCREENSHOT_KINDS,
  saveLineupSchema,
  saveResultsSchema,
  createTeamSchema,
  teamAvailabilityQuerySchema,
  APP_COOKIE,
  createScrimSchema,
  dateQuerySchema,
  dateString,
  rejectRegistrationSchema,
  updateScrimSchema,
} from "@7xen/shared";
import { parse } from "../lib/validate.js";
import { currentUser, requireAuth } from "../middleware/requireAuth.js";
import { approveRegistration, rejectRegistration } from "../services/registrations.js";
import * as matches from "../services/matches.js";
import * as scrims from "../services/scrims.js";
import { sendStoredFile } from "../lib/storage.js";
import { parseMultipart, uploadedImages } from "../lib/upload.js";
import * as teamRequests from "../services/teamRequests.js";

const screenshotKindSchema = z.object({
  kind: z.enum(SCREENSHOT_KINDS, { errorMap: () => ({ message: "Choose what the screenshots show: team list or results" }) }),
});

export function managerRouter() {
  const r = Router();
  r.use(requireAuth("MANAGER", APP_COOKIE));

  r.get("/dashboard", async (req, res) => {
    res.json(await scrims.managerDashboard(currentUser(req).id));
  });

  r.get("/scrims", async (req, res) => {
    res.json({ items: await scrims.listScrims(currentUser(req).id) });
  });
  r.post("/scrims", async (req, res) => {
    res.status(201).json(await scrims.createScrim(currentUser(req).id, parse(createScrimSchema, req.body)));
  });
  r.get("/scrims/:id", async (req, res) => {
    res.json(await scrims.getScrim(req.params.id, currentUser(req).id));
  });
  r.patch("/scrims/:id", async (req, res) => {
    res.json(await scrims.updateScrim(req.params.id, currentUser(req).id, parse(updateScrimSchema, req.body)));
  });
  r.get("/scrims/:id/sessions/:date", async (req, res) => {
    const date = parse(dateString, req.params.date);
    res.json(await scrims.sessionDetail(req.params.id, currentUser(req).id, date));
  });

  r.get("/schedule", async (req, res) => {
    const { date } = parse(dateQuerySchema, req.query);
    res.json({ items: await scrims.scheduleForDate(currentUser(req).id, date) });
  });

  r.get("/requests", async (req, res) => {
    res.json({ items: await scrims.pendingRequests(currentUser(req).id) });
  });

  r.post("/registrations/:id/approve", async (req, res) => {
    res.json(await approveRegistration(req.params.id, currentUser(req).id));
  });
  r.post("/registrations/:id/reject", async (req, res) => {
    const { reason } = parse(rejectRegistrationSchema, req.body);
    res.json(await rejectRegistration(req.params.id, currentUser(req).id, reason));
  });

  // ---- phase 2: matches, screenshots, review, points ----
  r.get("/scrims/:id/sessions/:date/matches", async (req, res) => {
    const date = parse(dateString, req.params.date);
    res.json({ items: await matches.listSessionMatches(req.params.id, currentUser(req).id, date) });
  });
  r.get("/scrims/:id/sessions/:date/standings", async (req, res) => {
    const date = parse(dateString, req.params.date);
    res.json(await matches.managerStandings(req.params.id, currentUser(req).id, date));
  });
  r.get("/matches/:matchId", async (req, res) => {
    res.json(await matches.getMatchDetail(req.params.matchId, currentUser(req).id));
  });
  r.post("/matches/:matchId/screenshots", async (req, res) => {
    await parseMultipart(req, res);
    const { kind } = parse(screenshotKindSchema, req.body);
    const images = uploadedImages(req, ["files", "files[]", "file"]);
    res.status(201).json(await matches.uploadScreenshots(req.params.matchId, currentUser(req).id, kind, images));
  });
  r.get("/screenshots/:id/image", async (req, res) => {
    const f = await matches.screenshotFile(req.params.id, currentUser(req).id);
    await sendStoredFile(res, f.storageKey, f.mimeType);
  });
  r.post("/screenshots/:id/retry", async (req, res) => {
    res.json(await matches.retryScreenshot(req.params.id, currentUser(req).id));
  });
  r.delete("/screenshots/:id", async (req, res) => {
    await matches.deleteScreenshot(req.params.id, currentUser(req).id);
    res.status(204).end();
  });
  r.put("/matches/:matchId/lineup", async (req, res) => {
    res.json(await matches.saveLineup(req.params.matchId, currentUser(req).id, parse(saveLineupSchema, req.body)));
  });
  r.put("/matches/:matchId/results", async (req, res) => {
    res.json(await matches.saveResults(req.params.matchId, currentUser(req).id, parse(saveResultsSchema, req.body)));
  });
  r.post("/matches/:matchId/publish", async (req, res) => {
    res.json(await matches.publishMatch(req.params.matchId, currentUser(req).id));
  });
  r.post("/matches/:matchId/unpublish", async (req, res) => {
    res.json(await matches.unpublishMatch(req.params.matchId, currentUser(req).id));
  });

  // ---- team login requests (admin approves) ----
  r.get("/teams/availability", async (req, res) => {
    res.json(await teamRequests.checkAvailability(parse(teamAvailabilityQuerySchema, req.query)));
  });
  r.get("/team-requests", async (req, res) => {
    res.json({ items: await teamRequests.listManagerTeamRequests(currentUser(req).id) });
  });
  r.post("/team-requests", async (req, res) => {
    res.status(201).json(await teamRequests.createTeamRequest(currentUser(req).id, parse(createTeamSchema, req.body)));
  });
  r.delete("/team-requests/:id", async (req, res) => {
    await teamRequests.withdrawTeamRequest(currentUser(req).id, req.params.id);
    res.status(204).end();
  });

  return r;
}
