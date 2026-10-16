import { Router } from "express";
import {
  ADMIN_COOKIE,
  createManagerSchema,
  createTeamSchema,
  resetPasswordSchema,
  searchQuerySchema,
  updateManagerSchema,
  updateTeamSchema,
} from "@7xen/shared";
import { parse } from "../lib/validate.js";
import { requireAuth } from "../middleware/requireAuth.js";
import * as admin from "../services/admin.js";

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

  return r;
}
