import { Router } from "express";
import { z } from "zod";
import {
  SAMPLE_SPLITS,
  SCREENSHOT_KINDS,
  updateSampleSchema,
  ADMIN_COOKIE,
  createManagerSchema,
  createTeamSchema,
  rejectTeamRequestSchema,
  resetPasswordSchema,
  teamAvailabilityQuerySchema,
  teamRequestListQuerySchema,
  searchQuerySchema,
  updateManagerSchema,
  updateTeamSchema,
  adminRecordingsQuerySchema,
  saveRecipeSchema,
  updateSettingsSchema,
} from "@7xen/shared";
import { parse } from "../lib/validate.js";
import { currentUser, requireAuth } from "../middleware/requireAuth.js";
import * as admin from "../services/admin.js";
import * as teamRequests from "../services/teamRequests.js";
import * as training from "../services/training.js";
import { AppError } from "../lib/errors.js";
import { sendStoredFile } from "../lib/storage.js";
import { parseMultipart, singleImage } from "../lib/upload.js";
import { mountMatchCenter } from "./matchCenter.js";
import { tournamentManageRouter } from "./tournaments.js";
import { mountLive } from "./live.js";
import { mountStation } from "./station.js";
import * as recordings from "../services/recordings.js";
import * as recipes from "../services/recipes.js";

const kindField = z.enum(SCREENSHOT_KINDS, { errorMap: () => ({ message: "Choose team list (SLOT_LIST) or results (RESULTS)" }) });
const sampleQuerySchema = z.object({
  kind: kindField.optional().or(z.literal("").transform(() => undefined)),
  split: z.enum(SAMPLE_SPLITS).optional().or(z.literal("").transform(() => undefined)),
  q: z.string().trim().max(60).optional(),
});
const sampleUploadSchema = z.object({
  kind: kindField,
  labels: z.string().max(100_000).optional(),
  split: z.enum(SAMPLE_SPLITS).optional().or(z.literal("").transform(() => undefined)),
  notes: z.string().trim().max(500).optional(),
});

function parseLabelsJson(raw: string | undefined): unknown {
  if (!raw) return { teams: [], rows: [] };
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError("VALIDATION_ERROR", "Labels aren't valid JSON", { labels: "Not valid JSON" });
  }
}

export function adminRouter() {
  const r = Router();
  r.use(requireAuth("ADMIN", ADMIN_COOKIE));

  r.get("/stats", async (_req, res) => {
    res.json(await admin.adminStats());
  });

  r.get("/managers", async (req, res) => {
    const { q } = parse(searchQuerySchema, req.query);
    res.json({ items: await admin.listManagers(q || undefined) });
  });
  r.post("/managers", async (req, res) => {
    res.status(201).json(await admin.createManager(parse(createManagerSchema, req.body)));
  });
  r.patch("/managers/:id", async (req, res) => {
    res.json(await admin.updateManager(req.params.id, parse(updateManagerSchema, req.body)));
  });
  r.post("/managers/:id/reset-password", async (req, res) => {
    const { password } = parse(resetPasswordSchema, req.body);
    await admin.resetManagerPassword(req.params.id, password);
    res.status(204).end();
  });

  r.get("/teams/availability", async (req, res) => {
    res.json(await teamRequests.checkAvailability(parse(teamAvailabilityQuerySchema, req.query)));
  });
  r.get("/teams", async (req, res) => {
    const { q } = parse(searchQuerySchema, req.query);
    res.json({ items: await admin.listTeams(q || undefined) });
  });
  r.post("/teams", async (req, res) => {
    res.status(201).json(await admin.createTeam(parse(createTeamSchema, req.body)));
  });
  r.patch("/teams/:id", async (req, res) => {
    res.json(await admin.updateTeam(req.params.id, parse(updateTeamSchema, req.body)));
  });
  r.post("/teams/:id/reset-password", async (req, res) => {
    const { password } = parse(resetPasswordSchema, req.body);
    await admin.resetTeamPassword(req.params.id, password);
    res.status(204).end();
  });

  r.get("/team-requests", async (req, res) => {
    const { status } = parse(teamRequestListQuerySchema, req.query);
    res.json({ items: await teamRequests.listTeamRequests(status) });
  });
  r.post("/team-requests/:id/approve", async (req, res) => {
    res.json(await teamRequests.approveTeamRequest(currentUser(req).id, req.params.id));
  });
  r.post("/team-requests/:id/reject", async (req, res) => {
    const { reason } = parse(rejectTeamRequestSchema, req.body);
    res.json(await teamRequests.rejectTeamRequest(currentUser(req).id, req.params.id, reason));
  });

  // ---- phase 2: training center ----
  r.get("/training/samples", async (req, res) => {
    res.json({ items: await training.listSamples(parse(sampleQuerySchema, req.query)) });
  });
  r.post("/training/samples", async (req, res) => {
    await parseMultipart(req, res);
    const body = parse(sampleUploadSchema, req.body);
    const image = singleImage(req, "file");
    const raw = parseLabelsJson(body.labels);
    const labels =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? body.kind === "SLOT_LIST"
          ? { teams: (raw as { teams?: unknown }).teams ?? [] }
          : { rows: (raw as { rows?: unknown }).rows ?? [] }
        : raw;
    res.status(201).json(await training.createSample(currentUser(req).id, { image, kind: body.kind, labels, split: body.split, notes: body.notes }));
  });
  r.get("/training/samples/:id", async (req, res) => {
    res.json(await training.getSample(req.params.id));
  });
  r.patch("/training/samples/:id", async (req, res) => {
    res.json(await training.updateSample(req.params.id, parse(updateSampleSchema, req.body)));
  });
  r.delete("/training/samples/:id", async (req, res) => {
    await training.deleteSample(req.params.id);
    res.status(204).end();
  });
  r.get("/training/samples/:id/image", async (req, res) => {
    const f = await training.sampleFile(req.params.id);
    await sendStoredFile(res, f.storageKey, f.mime);
  });
  r.post("/training/samples/:id/prefill", async (req, res) => {
    res.json(await training.prefillSample(req.params.id));
  });
  r.post("/training/preview", async (req, res) => {
    await parseMultipart(req, res);
    const { kind } = parse(z.object({ kind: kindField }), req.body);
    res.json(await training.preview(singleImage(req, "file"), kind));
  });
  r.get("/extractor/status", async (_req, res) => {
    res.json(await training.extractorStatus());
  });

  // ---- phase 3: tournaments (any manager's) + the match center for any match ----
  r.use("/tournaments", tournamentManageRouter(true));
  mountMatchCenter(r, true);

  // ---- phase 4: recordings, settings, recipes ----
  r.get("/recordings", async (req, res) => {
    res.json({ items: await recordings.adminListRecordings(parse(adminRecordingsQuerySchema, req.query)) });
  });
  r.delete("/recordings/:id", async (req, res) => {
    await recordings.adminDeleteRecording(req.params.id);
    res.status(204).end();
  });
  r.get("/settings", async (_req, res) => {
    res.json(await recordings.getSettings());
  });
  r.patch("/settings", async (req, res) => {
    res.json(await recordings.updateSettings(parse(updateSettingsSchema, req.body)));
  });
  r.get("/recipes", async (_req, res) => {
    res.json({ items: await recipes.adminRecipes() });
  });
  r.put("/recipes/:key", async (req, res) => {
    res.json(await recipes.saveRecipe(recipes.parseRecipeKey(req.params.key), null, parse(saveRecipeSchema, req.body)));
  });
  r.delete("/recipes/:id", async (req, res) => {
    await recipes.deleteRecipe(req.params.id);
    res.status(204).end();
  });
  // room + recordings of any match (video/poster streaming, uploads on a manager's behalf)
  mountLive(r, true);
  // phase 4b: 7XEN Station for any match
  mountStation(r, true);

  return r;
}
