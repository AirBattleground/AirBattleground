import { Router, type Request } from "express";
import { APP_COOKIE, createRegistrationSchema, dateQuerySchema, dateString, registrationScopeSchema, saveRosterSchema, scrimDetailQuerySchema, weeklyQuerySchema } from "@7xen/shared";
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
import { coinLeaderboard, coinWallet } from "../services/coins.js";
import { teamFinalsSlots, teamWeeklyBoard } from "../services/weekly.js";

/** The player's team (phase 5: from their membership); 403 NO_TEAM when they aren't in one (dashboard + mutations). */
function membership(req: Request) {
  const m = currentUser(req).membership;
  if (!m) throw new AppError("NO_TEAM", MSG.NO_TEAM);
  return m;
}
const teamId = (req: Request): string => membership(req).team.id;
/** phase 5c: browse reads work without a team — null means "not in a team" and the reads answer with empty team parts. */
const optTeamId = (req: Request): string | null => currentUser(req).membership?.team.id ?? null;
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

  r.get("/coins/leaderboard", async (req, res) => {
    res.json(await coinLeaderboard(optTeamId(req)));
  });
  r.get("/coins", async (req, res) => {
    res.json(await coinWallet(optTeamId(req)));
  });

  r.get("/scrims", async (req, res) => {
    const { date } = parse(dateQuerySchema, req.query);
    res.json({ items: await team.teamScrimsForDate(optTeamId(req), date) });
  });
  r.get("/scrims/:scrimId", async (req, res) => {
    const { date } = parse(scrimDetailQuerySchema, req.query);
    res.json(await team.teamScrimDetail(optTeamId(req), req.params.scrimId, date));
  });

  r.post("/registrations", async (req, res) => {
    const { scrimId, date } = parse(createRegistrationSchema, req.body);
    res.status(201).json(await registerTeam(leaderTeamId(req), scrimId, date, new Date(), currentUser(req).id));
  });
  r.get("/registrations", async (req, res) => {
    const { scope } = parse(registrationScopeSchema, req.query);
    const id = optTeamId(req);
    res.json({ items: id ? await team.teamRegistrations(id, scope) : [] });
  });
  r.delete("/registrations/:id", async (req, res) => {
    await cancelRegistration(leaderTeamId(req), req.params.id);
    res.status(204).end();
  });

  // ---- phase 2: results, points table, roster ----
  r.get("/results", async (req, res) => {
    const id = optTeamId(req);
    res.json({ items: id ? await results.teamResults(id) : [] });
  });
  r.get("/sessions/:scrimId/:date/standings", async (req, res) => {
    const date = parse(dateString, req.params.date);
    res.json(await results.teamSessionStandings(optTeamId(req), req.params.scrimId, date));
  });
  r.get("/matches/:matchId", async (req, res) => {
    res.json(await results.teamMatchScorecard(optTeamId(req), req.params.matchId));
  });
  r.get("/roster", async (req, res) => {
    const id = optTeamId(req);
    res.json(id ? await results.getRoster(id) : { players: [], suggestions: [] });
  });
  r.put("/roster", async (req, res) => {
    const id = leaderTeamId(req);
    parse(saveRosterSchema, req.body);
    res.json(await results.saveRoster(id));
  });

  // ---- Weekly Board (any player can see a scrim's board) + my team's Finals Slots ----
  r.get("/scrims/:scrimId/weekly", async (req, res) => {
    const { week } = parse(weeklyQuerySchema, req.query);
    res.json(await teamWeeklyBoard(req.params.scrimId, week));
  });
  r.get("/finals-slots", async (req, res) => {
    const id = optTeamId(req);
    res.json({ items: id ? await teamFinalsSlots(id) : [] });
  });

  // ---- phase 3: tournaments ----
  r.use("/tournaments", tournamentTeamRouter(optTeamId, leaderTeamId, (req) => currentUser(req).id));

  // ---- phase 4: room details for upcoming matches (shown once revealed) ----
  r.get("/rooms", async (req, res) => {
    const id = optTeamId(req);
    res.json({ items: id ? await teamRooms(id) : [] });
  });
  // ---- phase 4b: matches of this team being streamed by the AirBattleground Station right now ----
  r.get("/live", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const id = optTeamId(req);
    res.json({ items: id ? await teamLive(id) : [] });
  });

  return r;
}
