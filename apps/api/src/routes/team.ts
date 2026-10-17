import { Router, type Request } from "express";
import { APP_COOKIE, createRegistrationSchema, dateQuerySchema, dateString, registrationScopeSchema, saveRosterSchema } from "@7xen/shared";
import { AppError } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { currentUser, requireAuth } from "../middleware/requireAuth.js";
import { cancelRegistration, registerTeam } from "../services/registrations.js";
import * as team from "../services/team.js";
import * as results from "../services/teamResults.js";
import { tournamentTeamRouter } from "./tournaments.js";

function teamId(req: Request): string {
  const t = currentUser(req).team;
  if (!t) throw new AppError("FORBIDDEN", "This login isn't linked to a team. Contact the admin.");
  return t.id;
}

export function teamRouter() {
  const r = Router();
  r.use(requireAuth("TEAM", APP_COOKIE));

  r.get("/dashboard", async (req, res) => {
    res.json(await team.teamDashboard(teamId(req)));
  });

  r.get("/scrims", async (req, res) => {
    const { date } = parse(dateQuerySchema, req.query);
    res.json({ items: await team.teamScrimsForDate(teamId(req), date) });
  });

  r.post("/registrations", async (req, res) => {
    const { scrimId, date } = parse(createRegistrationSchema, req.body);
    res.status(201).json(await registerTeam(teamId(req), scrimId, date));
  });
  r.get("/registrations", async (req, res) => {
    const { scope } = parse(registrationScopeSchema, req.query);
    res.json({ items: await team.teamRegistrations(teamId(req), scope) });
  });
  r.delete("/registrations/:id", async (req, res) => {
    await cancelRegistration(teamId(req), req.params.id);
    res.status(204).end();
  });

  // ---- phase 2: results, points table, roster ----
  r.get("/results", async (req, res) => {
    res.json({ items: await results.teamResults(teamId(req)) });
  });
  r.get("/sessions/:scrimId/:date/standings", async (req, res) => {
    const date = parse(dateString, req.params.date);
    res.json(await results.teamSessionStandings(teamId(req), req.params.scrimId, date));
  });
  r.get("/matches/:matchId", async (req, res) => {
    res.json(await results.teamMatchScorecard(teamId(req), req.params.matchId));
  });
  r.get("/roster", async (req, res) => {
    res.json(await results.getRoster(teamId(req)));
  });
  r.put("/roster", async (req, res) => {
    res.json(await results.saveRoster(teamId(req), parse(saveRosterSchema, req.body)));
  });

  // ---- phase 3: tournaments ----
  r.use("/tournaments", tournamentTeamRouter(teamId));

  return r;
}
