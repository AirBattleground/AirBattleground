/**
 * Phase 4 routes: match-day (today, room), recordings + resumable video upload, recipes.
 * `mountLive` is shared by the manager router (own matches) and the admin router (any match, `bypass`).
 */
import type { Router } from "express";
import {
  createUploadSchema,
  liveTodayQuerySchema,
  recordingEventSchema,
  saveRecipeSchema,
  saveRoomSchema,
  startRecordingSchema,
} from "@7xen/shared";
import { parse } from "../lib/validate.js";
import { sendRangeFile } from "../lib/video.js";
import { currentUser } from "../middleware/requireAuth.js";
import * as live from "../services/live.js";
import * as recipes from "../services/recipes.js";
import * as recordings from "../services/recordings.js";

const p = (v: unknown) => v as string;

export function mountLive(r: Router, bypass: boolean) {
  // ---- room ----
  r.get("/matches/:matchId/room", async (req, res) => {
    res.json(await live.getRoom(p(req.params.matchId), currentUser(req).id, bypass));
  });
  r.put("/matches/:matchId/room", async (req, res) => {
    res.json(await live.saveRoom(p(req.params.matchId), currentUser(req).id, parse(saveRoomSchema, req.body), bypass));
  });
  r.delete("/matches/:matchId/room", async (req, res) => {
    await live.deleteRoom(p(req.params.matchId), currentUser(req).id, bypass);
    res.status(204).end();
  });

  // ---- recordings ----
  r.post("/matches/:matchId/recordings", async (req, res) => {
    res.status(201).json(await recordings.startRecording(p(req.params.matchId), currentUser(req).id, parse(startRecordingSchema, req.body), bypass));
  });
  r.get("/matches/:matchId/recordings", async (req, res) => {
    res.json({ items: await recordings.listRecordings(p(req.params.matchId), currentUser(req).id, bypass) });
  });
  r.patch("/recordings/:id", async (req, res) => {
    res.json(await recordings.updateRecording(p(req.params.id), currentUser(req).id, parse(recordingEventSchema, req.body), bypass));
  });

  // ---- resumable upload ----
  r.post("/recordings/:id/upload", async (req, res) => {
    const state = await recordings.createUpload(p(req.params.id), currentUser(req).id, parse(createUploadSchema, req.body), bypass);
    res.setHeader("Upload-Offset", String(state.offset));
    res.setHeader("Cache-Control", "no-store");
    res.json(state);
  });
  r.head("/recordings/:id/upload", async (req, res) => {
    const state = await recordings.uploadOffset(p(req.params.id), currentUser(req).id, bypass);
    res.setHeader("Upload-Offset", String(state.offset));
    res.setHeader("Upload-Length", String(state.sizeBytes));
    res.setHeader("Cache-Control", "no-store");
    res.status(204).end();
  });
  r.patch("/recordings/:id/upload", async (req, res) => {
    const state = await recordings.appendChunk(req, p(req.params.id), currentUser(req).id, bypass);
    res.setHeader("Upload-Offset", String(state.offset));
    res.setHeader("Cache-Control", "no-store");
    res.json(state);
  });
  r.post("/recordings/:id/upload/complete", async (req, res) => {
    res.json(await recordings.completeUpload(p(req.params.id), currentUser(req).id, bypass));
  });

  // ---- playback ----
  r.get("/recordings/:id/video", async (req, res) => {
    await sendRangeFile(req, res, await recordings.videoFile(p(req.params.id), currentUser(req).id, bypass), "video/mp4");
  });
  r.get("/recordings/:id/poster", async (req, res) => {
    await sendRangeFile(req, res, await recordings.posterFile(p(req.params.id), currentUser(req).id, bypass), "image/jpeg");
  });
}

/** Manager-only phase 4 routes. */
export function mountManagerLive(r: Router) {
  r.get("/live/today", async (req, res) => {
    const { days } = parse(liveTodayQuerySchema, req.query);
    res.json({ items: await live.liveToday(currentUser(req).id, days) });
  });
  r.get("/recipes", async (req, res) => {
    res.json({ items: await recipes.managerRecipes(currentUser(req).id) });
  });
  r.put("/recipes/:key", async (req, res) => {
    const key = recipes.parseRecipeKey(p(req.params.key));
    res.json(await recipes.saveRecipe(key, currentUser(req).id, parse(saveRecipeSchema, req.body)));
  });
  mountLive(r, false);
}
