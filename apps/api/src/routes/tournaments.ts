/**
 * Tournament management routes (phase 3). Mounted at /api/manager/tournaments (own tournaments) and at
 * /api/admin/tournaments (any tournament; admin is the acting user). Same paths, bodies and responses.
 */
import { Router, type Request } from "express";
import {
  createTournamentSchema,
  disqualifySchema,
  drawSchema,
  groupMovesSchema,
  inviteTeamSchema,
  promoteSchema,
  registerTournamentSchema,
  rescheduleMatchSchema,
  scheduleConfigSchema,
  tournamentScopeSchema,
  updateTournamentSchema,
  type ScheduleConfig,
} from "@7xen/shared";
import { parseMultipart, singleImage } from "../lib/upload.js";
import { parse } from "../lib/validate.js";
import { currentUser } from "../middleware/requireAuth.js";
import { setTournamentPoster } from "../services/branding.js";
import type { Actor } from "../services/tournaments/core.js";
import * as manage from "../services/tournaments/manage.js";
import * as stages from "../services/tournaments/stages.js";
import * as team from "../services/tournaments/team.js";

export function tournamentManageRouter(admin: boolean) {
  const r = Router();
  const actor = (req: Request): Actor => ({ userId: currentUser(req).id, admin });
  const p = (req: Request, k: string) => req.params[k] as string;

  r.get("/", async (req, res) => {
    res.json({ items: await manage.listTournaments(actor(req)) });
  });
  r.post("/", async (req, res) => {
    res.status(201).json(await manage.createTournament(actor(req), parse(createTournamentSchema, req.body)));
  });
  r.get("/:id", async (req, res) => {
    res.json(await manage.getTournament(p(req, "id"), actor(req)));
  });
  r.patch("/:id", async (req, res) => {
    res.json(await manage.updateTournament(p(req, "id"), actor(req), parse(updateTournamentSchema, req.body)));
  });
  r.put("/:id/poster", async (req, res) => {
    await parseMultipart(req, res);
    res.json(await setTournamentPoster(p(req, "id"), actor(req), singleImage(req)));
  });
  r.delete("/:id/poster", async (req, res) => {
    res.json(await setTournamentPoster(p(req, "id"), actor(req), null));
  });
  r.post("/:id/publish", async (req, res) => {
    res.json(await manage.publishTournament(p(req, "id"), actor(req)));
  });
  r.post("/:id/close-registration", async (req, res) => {
    res.json(await manage.closeRegistration(p(req, "id"), actor(req)));
  });
  r.post("/:id/reopen-registration", async (req, res) => {
    res.json(await manage.reopenRegistration(p(req, "id"), actor(req)));
  });
  r.post("/:id/cancel", async (req, res) => {
    res.json(await manage.cancelTournament(p(req, "id"), actor(req)));
  });
  r.post("/:id/complete", async (req, res) => {
    res.json(await manage.completeTournament(p(req, "id"), actor(req)));
  });

  r.get("/:id/entries", async (req, res) => {
    res.json({ items: await manage.listEntries(p(req, "id"), actor(req)) });
  });
  r.delete("/:id/entries/:entryId", async (req, res) => {
    await manage.removeEntry(p(req, "id"), actor(req), p(req, "entryId"));
    res.status(204).end();
  });
  r.post("/:id/invites", async (req, res) => {
    res.status(201).json(await manage.inviteTeam(p(req, "id"), actor(req), parse(inviteTeamSchema, req.body)));
  });

  r.put("/:id/stages/:stageId/schedule", async (req, res) => {
    const config = parse(scheduleConfigSchema, req.body) as ScheduleConfig;
    await manage.setStageSchedule(p(req, "id"), actor(req), p(req, "stageId"), config);
    res.json(await stages.stageDetail(p(req, "id"), p(req, "stageId"), actor(req)));
  });
  r.post("/:id/stages/:stageId/draw", async (req, res) => {
    res.json(await stages.drawStage(p(req, "id"), actor(req), p(req, "stageId"), parse(drawSchema, req.body)));
  });
  r.post("/:id/stages/:stageId/redraw", async (req, res) => {
    res.json(await stages.redrawStage(p(req, "id"), actor(req), p(req, "stageId"), parse(drawSchema, req.body)));
  });
  r.patch("/:id/stages/:stageId/groups", async (req, res) => {
    res.json(await stages.moveTeams(p(req, "id"), actor(req), p(req, "stageId"), parse(groupMovesSchema, req.body)));
  });
  r.patch("/:id/matches/:matchId/schedule", async (req, res) => {
    res.json(await stages.rescheduleMatch(p(req, "id"), actor(req), p(req, "matchId"), parse(rescheduleMatchSchema, req.body)));
  });
  r.post("/:id/stages/:stageId/start", async (req, res) => {
    res.json(await stages.startStage(p(req, "id"), actor(req), p(req, "stageId")));
  });
  r.get("/:id/stages/:stageId", async (req, res) => {
    res.json(await stages.stageDetail(p(req, "id"), p(req, "stageId"), actor(req)));
  });
  r.get("/:id/stages/:stageId/promotion", async (req, res) => {
    res.json(await stages.promotionPreview(p(req, "id"), actor(req), p(req, "stageId")));
  });
  r.post("/:id/stages/:stageId/promote", async (req, res) => {
    await stages.promoteStage(p(req, "id"), actor(req), p(req, "stageId"), parse(promoteSchema, req.body));
    res.json(await manage.getTournament(p(req, "id"), actor(req)));
  });
  r.post("/:id/stages/:stageId/teams/:teamId/disqualify", async (req, res) => {
    const { reason } = parse(disqualifySchema, req.body);
    res.json(await stages.disqualifyTeam(p(req, "id"), actor(req), p(req, "stageId"), p(req, "teamId"), reason));
  });
  return r;
}

/** Team routes, mounted at /api/team/tournaments. `teamIdOf` resolves the signed-in team. */
export function tournamentTeamRouter(teamIdOf: (req: Request) => string) {
  const r = Router();
  const p = (req: Request, k: string) => req.params[k] as string;
  r.get("/", async (req, res) => {
    const { scope } = parse(tournamentScopeSchema, req.query);
    res.json({ items: await team.listForTeam(teamIdOf(req), scope) });
  });
  r.get("/:id", async (req, res) => {
    res.json(await team.teamTournamentDetail(teamIdOf(req), p(req, "id")));
  });
  r.post("/:id/entry", async (req, res) => {
    res.status(201).json(await team.registerForTournament(teamIdOf(req), p(req, "id"), parse(registerTournamentSchema, req.body)));
  });
  r.put("/:id/entry", async (req, res) => {
    res.json(await team.updatePreferences(teamIdOf(req), p(req, "id"), parse(registerTournamentSchema, req.body)));
  });
  r.delete("/:id/entry", async (req, res) => {
    await team.withdrawFromTournament(teamIdOf(req), p(req, "id"));
    res.status(204).end();
  });
  r.get("/:id/stages/:stageId", async (req, res) => {
    // ensure the team can see the tournament (DRAFT is invisible), then the public stage view
    res.json(await stages.stageDetail(p(req, "id"), p(req, "stageId"), null));
  });
  return r;
}
