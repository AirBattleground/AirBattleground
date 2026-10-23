import { Router } from "express";
import {
  searchQuerySchema,
  teamAvailabilityQuerySchema,
  APP_COOKIE,
  createScrimSchema,
  dateQuerySchema,
  dateString,
  rejectRegistrationSchema,
  updateScrimSchema,
  giveFinalsSlotSchema,
  weeklyQuerySchema,
} from "@7xen/shared";
import { prisma } from "../db.js";
import { toTeamSummary } from "../lib/serialize.js";
import { parseMultipart, singleImage } from "../lib/upload.js";
import { parse } from "../lib/validate.js";
import { currentUser, requireAuth } from "../middleware/requireAuth.js";
import { approveRegistration, rejectRegistration } from "../services/registrations.js";
import * as branding from "../services/branding.js";
import * as matches from "../services/matches.js";
import * as scrims from "../services/scrims.js";
import * as weekly from "../services/weekly.js";
import { checkAvailability } from "../services/players.js";
import { mountMatchCenter } from "./matchCenter.js";
import { tournamentManageRouter } from "./tournaments.js";
import { mountManagerLive } from "./live.js";
import { mountStation } from "./station.js";
import { mountManagerDevices } from "./devices.js";
import { mountBroadcast } from "./broadcast.js";
import { mountStudio } from "./studio.js";

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
  r.put("/scrims/:id/poster", async (req, res) => {
    await parseMultipart(req, res);
    res.json(await branding.setScrimPoster(req.params.id as string, currentUser(req).id, singleImage(req)));
  });
  r.delete("/scrims/:id/poster", async (req, res) => {
    res.json(await branding.setScrimPoster(req.params.id as string, currentUser(req).id, null));
  });

  // ---- branding: organisation logo ----
  r.get("/branding", async (req, res) => {
    res.json(await branding.getOrgLogo(currentUser(req).id));
  });
  r.put("/branding/logo", async (req, res) => {
    await parseMultipart(req, res);
    res.json(await branding.setOrgLogo(currentUser(req).id, singleImage(req)));
  });
  r.delete("/branding/logo", async (req, res) => {
    res.json(await branding.setOrgLogo(currentUser(req).id, null));
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

  // ---- Weekly Board + Finals Slot ----
  r.get("/scrims/:id/weekly", async (req, res) => {
    const { week } = parse(weeklyQuerySchema, req.query);
    res.json(await weekly.managerWeeklyBoard(req.params.id, currentUser(req).id, week));
  });
  r.post("/scrims/:id/weekly/finals-slot", async (req, res) => {
    res.json(await weekly.giveFinalsSlot(req.params.id, currentUser(req).id, parse(giveFinalsSlotSchema, req.body)));
  });
  r.get("/finals-targets", async (req, res) => {
    res.json({ items: await weekly.finalsTargets(currentUser(req).id) });
  });

  // ---- phase 3: tournaments ----
  r.use("/tournaments", tournamentManageRouter(false));

  // ---- phase 4: manager app (today, room, recordings, recipes) ----
  mountManagerLive(r);
  // ---- phase 4b: AirBattleground Station (emulator recording + live stream) ----
  mountStation(r, false);
  mountManagerDevices(r);
  mountBroadcast(r);
  mountStudio(r);

  // team search for tournament invites (teams whose leader's account is active)
  r.get("/teams", async (req, res) => {
    const { q } = parse(searchQuerySchema, req.query);
    const teams = await prisma.team.findMany({
      where: {
        leader: { isActive: true },
        ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { tag: { contains: q, mode: "insensitive" as const } }] } : {}),
      },
      select: { id: true, name: true, tag: true },
      orderBy: { name: "asc" },
      take: 20,
    });
    res.json({ items: teams.map(toTeamSummary) });
  });

  r.get("/teams/availability", async (req, res) => {
    res.json(await checkAvailability(parse(teamAvailabilityQuerySchema, req.query)));
  });

  return r;
}
