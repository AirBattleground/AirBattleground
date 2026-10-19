import { Router, type Request } from "express";
import { APP_COOKIE, createRegistrationSchema, dateQuerySchema, dateString, registrationScopeSchema, saveRosterSchema } from "@7xen/shared";
import { AppError } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import { currentUser, requireAuth } from "../middleware/requireAuth.js";
import { cancelRegistration, registerTeam } from "../services/registrations.js";
import * as team from "../services/team.js";
import * as results from "../services/teamResults.js";
import { tournamentTeamRouter } from "./tournaments.js";
import { teamRooms } from "../services/live.js";
import { teamLive } from "../services/station.js";
import { MSG } from "../services/players.js";

/** The player's team (phase 5: from their membership); 403 NO_TEAM when they aren't in one. */
function membership(req: Request) {
  const m = currentUser(req).membership;
  if (!m) throw new AppError("NO_TEAM", MSG.NO_TEAM);
  return m;
}
const teamId = (req: Request): string => membership(req).team.id;
/** Team id for a mutation: only the leader acts for the team (members "Ask my leader"). */
function leaderTeamId(req: Request): string {
  const m = membership(req);
  if (m.role !== "LEADER") throw new AppError("LEADER_ONLY", MSG.LEADER_ONLY);
  return m.team.id;
}

export function teamRouter() {
  const r = Router();
  r.use(requireAuth("PLAYER", APP_COOKIE));

  r.get("/dashboard", async (req, res) => {
    res.json(await team.teamDashboard(teamId(req), membership(req).role));
  });

  r.get("/scrims", async (req, res) => {
    const { date } = parse(dateQuerySchema, req.query);
    res.json({ items: await team.teamScrimsForDate(teamId(req), date) });
  });

  r.post("/registrations", async (req, res) => {
    const { scrimId, date } = parse(createRegistrationSchema, req.body);
    res.status(201).json(await registerTeam(leaderTeamId(req), scrimId, date, new Date(), currentUser(req).id));
  });
  r.get("/registrations", async (req, res) => {
    const { scope } = parse(registrationScopeSchema, req.query);
    res.json({ items: await team.teamRegistrations(teamId(req), scope) });
  });
  r.delete("/registrations/:id", async (req, res) => {
    await cancelRegistration(leaderTeamId(req), req.params.id);
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
    const id = leaderTeamId(req);
    parse(saveRosterSchema, req.body);
    res.json(await results.saveRoster(id));
  });

  // ---- phase 3: tournaments ----
  r.use("/tournaments", tournamentTeamRouter(teamId, leaderTeamId, (req) => currentUser(req).id));

  // ---- phase 4: room details for upcoming matches (shown once revealed) ----
  r.get("/rooms", async (req, res) => {
    res.json({ items: await teamRooms(teamId(req)) });
  });
  // ---- phase 4b: matches of this team being streamed by the 7XEN Station right now ----
  r.get("/live", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ items: await teamLive(teamId(req)) });
  });

  return r;
}
