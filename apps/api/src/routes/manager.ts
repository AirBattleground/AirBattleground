import { Router } from "express";
import {
  searchQuerySchema,
  createTeamSchema,
  teamAvailabilityQuerySchema,
  APP_COOKIE,
  createScrimSchema,
  dateQuerySchema,
  dateString,
  rejectRegistrationSchema,
  updateScrimSchema,
} from "@7xen/shared";
import { prisma } from "../db.js";
import { toTeamSummary } from "../lib/serialize.js";
import { parse } from "../lib/validate.js";
import { currentUser, requireAuth } from "../middleware/requireAuth.js";
import { approveRegistration, rejectRegistration } from "../services/registrations.js";
import * as matches from "../services/matches.js";
import * as scrims from "../services/scrims.js";
import * as teamRequests from "../services/teamRequests.js";
import { mountMatchCenter } from "./matchCenter.js";
import { tournamentManageRouter } from "./tournaments.js";
import { mountManagerLive } from "./live.js";

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
  mountMatchCenter(r, false);

  // ---- phase 3: tournaments ----
  r.use("/tournaments", tournamentManageRouter(false));

  // ---- phase 4: manager app (today, room, recordings, recipes) ----
  mountManagerLive(r);

  // ---- team login requests (admin approves) ----
  // team search for tournament invites (active team logins only)
  r.get("/teams", async (req, res) => {
    const { q } = parse(searchQuerySchema, req.query);
    const teams = await prisma.team.findMany({
      where: {
        user: { isActive: true },
        ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { tag: { contains: q, mode: "insensitive" as const } }] } : {}),
      },
      select: { id: true, name: true, tag: true },
      orderBy: { name: "asc" },
      take: 20,
    });
    res.json({ items: teams.map(toTeamSummary) });
  });

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
