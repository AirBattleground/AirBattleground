/** Phase 8 — Studio routes (manager). Contract: shared/studio.ts. */
import express, { type Router } from "express";
import { z } from "zod";
import { createShowSchema, createWorkerSchema, ingestQuerySchema, MAX_INGEST_CHUNK_BYTES, showControlSchema, startWorkerSchema, updateShowSchema } from "@7xen/shared";
import { AppError } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { currentUser } from "../middleware/requireAuth.js";
import * as studio from "../services/studio.js";
import * as workers from "../services/studioWorkers.js";

const sinceSchema = z.object({ since: z.coerce.number().int().min(-1).default(-1) });

const p = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function mountStudio(r: Router) {
  r.get("/studio/outputs", async (req, res) => {
    res.json(await studio.studioOutputs(currentUser(req).id));
  });
  r.get("/studio/shows", async (req, res) => {
    res.json({ items: await studio.listShows(currentUser(req).id) });
  });
  r.post("/studio/shows", async (req, res) => {
    res.status(201).json(await studio.createShow(currentUser(req).id, parse(createShowSchema, req.body)));
  });
  r.get("/studio/shows/:id", async (req, res) => {
    res.json(await studio.getShow(p(req.params.id), currentUser(req).id));
  });
  r.patch("/studio/shows/:id", async (req, res) => {
    res.json(await studio.updateShow(p(req.params.id), currentUser(req).id, parse(updateShowSchema, req.body)));
  });
  r.delete("/studio/shows/:id", async (req, res) => {
    await studio.deleteShow(p(req.params.id), currentUser(req).id);
    res.status(204).end();
  });
  // a ~1 s WebM/Matroska chunk of the mixed show (raw body)
  r.post("/studio/shows/:id/ingest", express.raw({ type: () => true, limit: MAX_INGEST_CHUNK_BYTES }), async (req, res) => {
    const q = parse(ingestQuerySchema, req.query);
    const body = req.body as unknown;
    if (!Buffer.isBuffer(body) || body.length === 0) throw new AppError("VALIDATION_ERROR", "Empty chunk");
    const out = await studio.ingestChunk(p(req.params.id), currentUser(req).id, q, body);
    if ("restart" in out) {
      res.status(409).json({ error: { code: "CONFLICT", message: "RESTART" } });
      return;
    }
    res.json(out);
  });
  r.post("/studio/shows/:id/stop", async (req, res) => {
    res.json(await studio.stopShow(p(req.params.id), currentUser(req).id));
  });
  r.get("/studio/shows/:id/status", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await studio.showStatus(p(req.params.id), currentUser(req).id));
  });

  // ---- phase 8b: Studio workers (shared/studioWorker.ts) ----
  r.get("/studio/workers", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ items: await workers.listWorkers(currentUser(req).id) });
  });
  r.post("/studio/workers", async (req, res) => {
    const { name } = parse(createWorkerSchema, req.body);
    res.status(201).json(await workers.createWorker(currentUser(req).id, name));
  });
  r.delete("/studio/workers/:id", async (req, res) => {
    await workers.deleteWorker(p(req.params.id), currentUser(req).id);
    res.status(204).end();
  });
  r.post("/studio/shows/:id/start-worker", async (req, res) => {
    const { workerId } = parse(startWorkerSchema, req.body);
    res.json(await studio.startWorkerShow(p(req.params.id), currentUser(req).id, workerId));
  });
  r.patch("/studio/shows/:id/control", async (req, res) => {
    res.json(await studio.setShowControl(p(req.params.id), currentUser(req).id, parse(showControlSchema, req.body)));
  });
  // long-poll (≤ 25 s) for the render page
  r.get("/studio/shows/:id/control", async (req, res) => {
    const { since } = parse(sinceSchema, req.query);
    const ac = new AbortController();
    res.on("close", () => ac.abort());
    res.setHeader("Cache-Control", "no-store");
    const state = await studio.showControl(p(req.params.id), currentUser(req).id, since, ac.signal);
    if (!res.writableEnded && !res.destroyed) res.json(state);
  });
}
