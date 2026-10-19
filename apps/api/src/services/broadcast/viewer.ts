/**
 * Phase 6c: what teams see of an iPhone broadcast — the phone's HLS and the organiser's layout over it.
 * Access is checked by the caller (liveRouter: any signed-in user, phase 6d).
 */
import type { GameMap, LiveBroadcastCard, TeamLiveCard } from "@7xen/shared";
import { brandingUrl } from "../../lib/serialize.js";
import { prisma } from "../../db.js";
import { broadcastingDevice } from "../devices.js";
import { matchContext } from "../matchContext.js";
import { ownerInclude } from "../matches.js";
import { overlayDataForMatch } from "./data.js";
import { loadLayout, sponsorPaths } from "./layout.js";
import { renderOverlay } from "./render.js";

export const deviceHlsUrlFor = (matchId: string) => `/api/live/${matchId}/d/index.m3u8`;
export const overlayUrlFor = (matchId: string) => `/api/live/${matchId}/overlay.png`;

const cache = new Map<string, { at: number; png: Buffer }>();

/** The layout PNG for a broadcasting match (null = nothing is broadcasting it). Rendered ≤ ~1/s per match for all viewers. */
export async function matchOverlayPng(matchId: string): Promise<Buffer | null> {
  const d = await broadcastingDevice(matchId);
  if (!d) return null;
  const hit = cache.get(matchId);
  if (hit && Date.now() - hit.at < 900) return hit.png;
  const [layout, data] = await Promise.all([loadLayout(d.managerId), overlayDataForMatch(matchId, d.managerId)]);
  const png = await renderOverlay(layout.config, data, { sponsorPaths: sponsorPaths(layout.config, layout.sponsors), liveSince: d.broadcastStartedAt });
  cache.set(matchId, { at: Date.now(), png });
  if (cache.size > 200) cache.clear();
  return png;
}

/** Live cards for the iPhone broadcasts of matches this team plays in. */
export async function teamDeviceLive(teamId: string, teamInMatch: (teamId: string, m: { sessionId: string | null; groupId: string | null }) => Promise<boolean>): Promise<TeamLiveCard[]> {
  const devices = await prisma.device.findMany({
    where: { broadcastLive: true, matchId: { not: null } },
    include: { match: { include: ownerInclude } },
    orderBy: { broadcastStartedAt: "desc" },
    take: 50,
  });
  const out: TeamLiveCard[] = [];
  const seen = new Set<string>();
  for (const d of devices) {
    const m = d.match;
    if (!m || seen.has(m.id) || !(await teamInMatch(teamId, m))) continue;
    seen.add(m.id);
    const ctx = matchContext(m);
    out.push({
      matchId: m.id,
      title: ctx.title,
      subtitle: ctx.subtitle,
      number: m.number,
      map: m.map as GameMap,
      startedAt: (d.broadcastStartedAt ?? new Date()).toISOString(),
      hlsUrl: deviceHlsUrlFor(m.id),
      tournamentId: m.group?.stage.tournament.id ?? null,
      overlayUrl: overlayUrlFor(m.id),
    });
  }
  return out;
}

/** Every iPhone broadcast on right now (Live page + sidebar count), newest first. */
export async function liveBroadcasts(): Promise<LiveBroadcastCard[]> {
  const devices = await prisma.device.findMany({
    where: { broadcastLive: true, matchId: { not: null } },
    include: { match: { include: ownerInclude }, manager: { select: { displayName: true, orgName: true, orgLogoKey: true } } },
    orderBy: { broadcastStartedAt: "desc" },
    take: 100,
  });
  const out: LiveBroadcastCard[] = [];
  const seen = new Set<string>();
  for (const d of devices) {
    const m = d.match;
    if (!m || seen.has(m.id)) continue;
    seen.add(m.id);
    const ctx = matchContext(m);
    out.push({
      matchId: m.id,
      kind: ctx.kind,
      title: ctx.title,
      subtitle: ctx.subtitle,
      number: m.number,
      map: m.map as GameMap,
      startedAt: (d.broadcastStartedAt ?? new Date()).toISOString(),
      hlsUrl: deviceHlsUrlFor(m.id),
      overlayUrl: overlayUrlFor(m.id),
      organizer: { name: d.manager.orgName ?? d.manager.displayName, logoUrl: brandingUrl(d.manager.orgLogoKey) },
      tournamentId: m.group?.stage.tournament.id ?? null,
    });
  }
  return out;
}
