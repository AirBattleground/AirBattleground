/** Phase 5: player hub — profile, own team, join requests, suggestions. Contract: packages/shared/src/players.ts */
import { Router, type Request } from "express";
import {
  APP_COOKIE,
  createJoinRequestSchema,
  createPlayerTeamSchema,
  inviteByBgmiSchema,
  playerStatsQuerySchema,
  tdmStatsQuerySchema,
  createSuggestionSchema,
  suggestionQuerySchema,
  transferLeaderSchema,
  updatePlayerProfileSchema,
  updatePlayerTeamSchema,
} from "@7xen/shared";
import { parseMultipart, singleImage } from "../lib/upload.js";
import { parse } from "../lib/validate.js";
import { currentUser, requireAuth } from "../middleware/requireAuth.js";
import * as branding from "../services/branding.js";
import * as players from "../services/players.js";
import { getPlayerStats, getTdmStats } from "../services/playerStats.js";
import * as suggestions from "../services/suggestions.js";

export function playerRouter() {
  const r = Router();
  r.use(requireAuth("PLAYER", APP_COOKIE));
  const me = (req: Request) => currentUser(req).id;
  const p = (req: Request, k: string) => req.params[k] as string;

  r.get("/me", async (req, res) => {
    res.json(await players.getProfile(me(req)));
  });
  r.patch("/me", async (req, res) => {
    res.json(await players.updateProfile(me(req), parse(updatePlayerProfileSchema, req.body)));
  });
  r.get("/stats", async (req, res) => {
    res.json(await getPlayerStats(me(req), parse(playerStatsQuerySchema, req.query)));
  });
  r.get("/stats/tdm", async (req, res) => {
    res.json(await getTdmStats(me(req), parse(tdmStatsQuerySchema, req.query)));
  });

  // ---- own team ----
  r.post("/team", async (req, res) => {
    res.status(201).json(await players.createTeam(me(req), parse(createPlayerTeamSchema, req.body)));
  });
  r.get("/team", async (req, res) => {
    res.json(await players.myTeam(me(req)));
  });
  r.patch("/team", async (req, res) => {
    res.json(await players.updateTeam(me(req), parse(updatePlayerTeamSchema, req.body)));
  });
  r.delete("/team", async (req, res) => {
    await players.disbandMyTeam(me(req));
    res.status(204).end();
  });
  r.post("/team/invite-code", async (req, res) => {
    res.json(await players.rotateInviteCode(me(req)));
  });
  r.post("/team/leave", async (req, res) => {
    await players.leaveTeam(me(req));
    res.status(204).end();
  });
  r.delete("/team/members/:userId", async (req, res) => {
    res.json(await players.removeMember(me(req), p(req, "userId")));
  });
  r.post("/team/transfer", async (req, res) => {
    const { userId } = parse(transferLeaderSchema, req.body);
    res.json(await players.transferLeadership(me(req), userId));
  });
  r.post("/team/join-requests/:id/approve", async (req, res) => {
    res.json(await players.approveJoinRequest(me(req), p(req, "id")));
  });
  r.post("/team/join-requests/:id/reject", async (req, res) => {
    res.json(await players.rejectJoinRequest(me(req), p(req, "id")));
  });

  // ---- team logo ----
  r.put("/team/logo", async (req, res) => {
    await parseMultipart(req, res);
    res.json(await players.updateTeamLogo(me(req), singleImage(req)));
  });
  r.delete("/team/logo", async (req, res) => {
    res.json(await players.updateTeamLogo(me(req), null));
  });

  // ---- my photo (replaces the Google picture everywhere) ----
  r.put("/avatar", async (req, res) => {
    await parseMultipart(req, res);
    res.json(await branding.setPlayerAvatar(me(req), singleImage(req)));
  });
  r.delete("/avatar", async (req, res) => {
    res.json(await branding.setPlayerAvatar(me(req), null));
  });

  // ---- invite by BGMI ID (leader) + my invitations ----
  r.post("/team/invites", async (req, res) => {
    res.status(201).json(await players.inviteByBgmiId(me(req), parse(inviteByBgmiSchema, req.body)));
  });
  r.delete("/team/invites/:id", async (req, res) => {
    res.json(await players.revokeInvite(me(req), p(req, "id")));
  });
  r.get("/team-invites", async (req, res) => {
    res.json({ items: await players.myTeamInvites(me(req)) });
  });
  r.post("/team-invites/:id/accept", async (req, res) => {
    res.json(await players.acceptInvite(me(req), p(req, "id")));
  });
  r.post("/team-invites/:id/decline", async (req, res) => {
    await players.declineInvite(me(req), p(req, "id"));
    res.status(204).end();
  });

  // ---- suggestions ("Ask my leader") ----
  r.get("/team/suggestions", async (req, res) => {
    const { status } = parse(suggestionQuerySchema, req.query);
    res.json({ items: await suggestions.listSuggestions(me(req), status) });
  });
  r.post("/team/suggestions", async (req, res) => {
    res.status(201).json(await suggestions.createSuggestion(me(req), parse(createSuggestionSchema, req.body)));
  });
  r.post("/team/suggestions/:id/dismiss", async (req, res) => {
    res.json(await suggestions.dismissSuggestion(me(req), p(req, "id")));
  });

  // ---- invites + my join requests ----
  r.get("/invites/:code", async (req, res) => {
    res.json(await players.invitePreview(p(req, "code")));
  });
  r.post("/join-requests", async (req, res) => {
    const { code, message } = parse(createJoinRequestSchema, req.body);
    res.status(201).json(await players.createJoinRequest(me(req), code, message));
  });
  r.get("/join-requests", async (req, res) => {
    res.json({ items: await players.myJoinRequests(me(req)) });
  });
  r.delete("/join-requests/:id", async (req, res) => {
    await players.cancelJoinRequest(me(req), p(req, "id"));
    res.status(204).end();
  });

  return r;
}
