/** Phase 8 — Studio routes (manager). Contract: shared/studio.ts. */
import express, { type Router } from "express";
import { createShowSchema, ingestQuerySchema, MAX_INGEST_CHUNK_BYTES, updateShowSchema } from "@7xen/shared";
import { AppError } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { currentUser } from "../middleware/requireAuth.js";
import * as studio from "../services/studio.js";

const p = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function mountStudio(r: Router) {
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
}
