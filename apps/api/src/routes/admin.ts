import { Router } from "express";
import { z } from "zod";
import {
  SAMPLE_SPLITS,
  SCREENSHOT_KINDS,
  updateSampleSchema,
  ADMIN_COOKIE,
  createManagerSchema,
  resetPasswordSchema,
  searchQuerySchema,
  adminPlayersQuerySchema,
  adminUpdatePlayerSchema,
  updateManagerSchema,
  adminRecordingsQuerySchema,
  saveRecipeSchema,
  updateSettingsSchema,
  updateUiSkinSchema,
  updateYoutubeSchema,
  createManagerInviteSchema,
  managerInviteQuerySchema,
} from "@7xen/shared";
import { parse } from "../lib/validate.js";
import { currentUser, requireAuth } from "../middleware/requireAuth.js";
import * as admin from "../services/admin.js";
import * as training from "../services/training.js";
import * as uiSkin from "../services/uiSkin.js";
import * as youtube from "../services/youtube.js";
import { AppError } from "../lib/errors.js";
import { sendStoredFile } from "../lib/storage.js";
import { parseMultipart, singleImage } from "../lib/upload.js";
import { mountMatchCenter } from "./matchCenter.js";
import { tournamentManageRouter } from "./tournaments.js";
import { mountLive } from "./live.js";
import { mountStation } from "./station.js";
import { systemHealth } from "../services/system.js";
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

  // ---- phase 7b: site YouTube channel (every streamed match goes live there) ----
  r.get("/youtube", async (_req, res) => {
    res.json(await youtube.getYoutubeStatus());
  });
  r.patch("/youtube", async (req, res) => {
    res.json(await youtube.updateYoutube(parse(updateYoutubeSchema, req.body)));
  });
  r.post("/youtube/connect", (req, res) => {
    res.json({ url: youtube.connectUrl(currentUser(req).id) });
  });
  r.delete("/youtube", async (_req, res) => {
    res.json(await youtube.disconnectYoutube());
  });
  // Google sends the admin back here (top-level GET, so the lax session cookie comes along)
  r.get("/youtube/callback", async (req, res) => {
    const back = (q: string) => res.redirect(302, `/admin-ui/youtube?${q}`);
    const { code, state, error } = req.query as Record<string, string | undefined>;
    if (error || !code || !state) return back(`error=${encodeURIComponent(error === "access_denied" ? "You cancelled the Google sign-in." : "Google didn't finish the sign-in. Try again.")}`);
    try {
      await youtube.finishConnect(code, state, currentUser(req).id);
      back("connected=1");
    } catch (err) {
      back(`error=${encodeURIComponent(err instanceof AppError ? err.message : "Couldn't connect YouTube. Try again.")}`);
    }
  });
  r.get("/system/health", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await systemHealth());
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
  // ---- phase 5b: manager invitations (the invited email becomes a MANAGER on its first Google sign-in) ----
  r.get("/manager-invites", async (req, res) => {
    const { status } = parse(managerInviteQuerySchema, req.query);
    res.json({ items: await admin.listManagerInvites(status) });
  });
  r.post("/manager-invites", async (req, res) => {
    const input = parse(createManagerInviteSchema, req.body);
    res.status(201).json(await admin.createManagerInvite(input, currentUser(req).id));
  });
  r.delete("/manager-invites/:id", async (req, res) => {
    await admin.revokeManagerInvite(req.params.id);
    res.status(204).end();
  });
  r.post("/managers/:id/reset-password", async (req, res) => {
    const { password } = parse(resetPasswordSchema, req.body);
    await admin.resetManagerPassword(req.params.id, password);
    res.status(204).end();
  });

  // ---- teams (phase 5: groups of players; created by players, not the admin) ----
  r.get("/teams", async (req, res) => {
    const { q } = parse(searchQuerySchema, req.query);
    res.json({ items: await admin.listTeams(q || undefined) });
  });
  r.get("/teams/:id", async (req, res) => {
    res.json(await admin.teamDetail(req.params.id));
  });
  r.delete("/teams/:id", async (req, res) => {
    await admin.disbandTeam(req.params.id);
    res.status(204).end();
  });

  // ---- players (phase 5) ----
  r.get("/players", async (req, res) => {
    const { q } = parse(adminPlayersQuerySchema, req.query);
    res.json({ items: await admin.listPlayers(q || undefined) });
  });
  r.patch("/players/:id", async (req, res) => {
    res.json(await admin.updatePlayer(req.params.id, parse(adminUpdatePlayerSchema, req.body)));
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
  // ---- site look (teal | lux) of the web portal ----
  r.put("/site/skin", async (req, res) => {
    res.json(await uiSkin.setUiSkin(parse(updateUiSkinSchema, req.body)));
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
  // phase 4b: AirBattleground Station for any match
  mountStation(r, true);

  return r;
}
