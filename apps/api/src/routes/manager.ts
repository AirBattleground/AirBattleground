import { Router } from "express";
import {
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
import * as scrims from "../services/scrims.js";

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

  return r;
}
