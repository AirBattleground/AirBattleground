/**
 * Phase 6: streaming devices (iPhone, view-only). The manager adds a device and gets its key; the phone sends the key
 * on every call (X-Device-Key). Status comes from heartbeats; video goes phone → MediaMTX (RTMP) → API (HLS proxy) → manager.
 * Match assignment / broadcast to teams arrive in the next milestone.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Device, Prisma } from "@prisma/client";
import {
  DEVICE_KEY_INVALID_MESSAGE,
  DEVICE_KEY_PREFIX,
  DEVICE_ONLINE_WINDOW_MS,
  MAX_DEVICES_PER_MANAGER,
  type DeviceHealth,
  type DeviceHeartbeatInput,
  type DeviceHeartbeatResponse,
  type DeviceHelloInput,
  type DeviceHelloResponse,
  type DeviceKey,
  type DeviceRow,
  type DeviceStatus,
  type DeviceStreamStartInput,
  type DeviceStreamStartResponse,
  type DeviceWithKey,
} from "@7xen/shared";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { AppError, conflict, notFound } from "../lib/errors.js";
import { decryptSecret, encryptSecret } from "../lib/secretBox.js";
import { deviceStreamReady, kickDevice, publishToken } from "./media.js";
import { outputStateOf, stopOutput } from "./broadcast/compositor.js";
import { takeSnapshotRequests } from "./deviceCapture.js";
import { matchContext } from "./matchContext.js";
import { loadOwnMatch, ownerInclude } from "./matches.js";

// ---------------------------------------------------------------- keys

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function newKey(): string {
  return DEVICE_KEY_PREFIX + randomBytes(24).toString("base64url");
}
const keyFields = (key: string) => ({ keyHash: sha256(key), keyEnc: encryptSecret(key), keyPrefix: key.slice(0, DEVICE_KEY_PREFIX.length + 4) });

// ---------------------------------------------------------------- serialise

export function deviceStatus(d: Pick<Device, "lastSeenAt" | "state">, now = Date.now()): DeviceStatus {
  if (!d.lastSeenAt || now - d.lastSeenAt.getTime() > DEVICE_ONLINE_WINDOW_MS) return "OFFLINE";
  return d.state === "LIVE" ? "STREAMING" : "ONLINE";
}

/**
 * `video` = what MediaMTX says (null = not asked). Video arriving wins over the phone's own state: the app's foreground
 * heartbeat can still say IDLE while its broadcast extension is streaming.
 */
/** Device + the match its broadcast layout shows (for DeviceRow.match). */
export const deviceInclude = { match: { include: ownerInclude } } satisfies Prisma.DeviceInclude;
export type DeviceWithMatch = Prisma.DeviceGetPayload<{ include: typeof deviceInclude }>;

export function toDeviceRow(d: DeviceWithMatch, now = Date.now(), video: { readySince: Date } | null = null): DeviceRow {
  const status: DeviceStatus = video ? "STREAMING" : deviceStatus(d, now);
  const since = video ? (d.state === "LIVE" && d.streamingSince ? d.streamingSince : video.readySince) : d.streamingSince;
  return {
    id: d.id,
    name: d.name,
    platform: d.platform,
    keyPrefix: d.keyPrefix,
    status,
    model: d.model,
    osVersion: d.osVersion,
    appVersion: d.appVersion,
    lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
    streamingSince: status === "STREAMING" ? (since?.toISOString() ?? null) : null,
    videoReady: !!video,
    health: (d.health as DeviceHealth | null) ?? null,
    createdAt: d.createdAt.toISOString(),
    match: d.match ? { id: d.match.id, ...pick(matchContext(d.match), "title", "subtitle") } : null,
    broadcastLive: d.broadcastLive && !!d.matchId,
    broadcastStartedAt: d.broadcastLive && d.matchId ? (d.broadcastStartedAt?.toISOString() ?? null) : null,
    outputState: outputStateOf(d.id),
  };
}

const pick = <T, K extends keyof T>(o: T, ...keys: K[]) => Object.fromEntries(keys.map((k) => [k, o[k]])) as Pick<T, K>;

// ---------------------------------------------------------------- manager

async function loadOwn(id: string, managerId: string): Promise<DeviceWithMatch> {
  const d = await prisma.device.findUnique({ where: { id }, include: deviceInclude });
  if (!d || d.managerId !== managerId) throw notFound("Device not found");
  return d;
}

/**
 * Rows with the video state asked from MediaMTX — for every phone, even "offline" ones: while BGMI is open the app is
 * in the background and may stop heartbeating, but its broadcast extension keeps streaming. (≤ MAX_DEVICES_PER_MANAGER local calls.)
 */
async function withVideo(rows: DeviceWithMatch[]): Promise<DeviceRow[]> {
  const now = Date.now();
  return Promise.all(rows.map(async (d) => toDeviceRow(d, now, await deviceStreamReady(d.id))));
}

export async function listDevices(managerId: string): Promise<DeviceRow[]> {
  return withVideo(await prisma.device.findMany({ where: { managerId }, orderBy: { createdAt: "desc" }, include: deviceInclude }));
}

export async function getDevice(id: string, managerId: string): Promise<DeviceRow> {
  const [row] = await withVideo([await loadOwn(id, managerId)]);
  return row!;
}

/** Throws 404 unless the device is this manager's (used by the HLS proxy). */
export async function assertOwnDevice(id: string, managerId: string): Promise<void> {
  await loadOwn(id, managerId);
}

export async function createDevice(managerId: string, name: string): Promise<DeviceWithKey> {
  const count = await prisma.device.count({ where: { managerId } });
  if (count >= MAX_DEVICES_PER_MANAGER) throw conflict(`You can add up to ${MAX_DEVICES_PER_MANAGER} devices. Remove one first.`);
  const key = newKey();
  const d = await prisma.device.create({ data: { managerId, name, ...keyFields(key) }, include: deviceInclude });
  return { ...toDeviceRow(d), key };
}

export async function renameDevice(id: string, managerId: string, name: string): Promise<DeviceRow> {
  await loadOwn(id, managerId);
  return toDeviceRow(await prisma.device.update({ where: { id }, data: { name }, include: deviceInclude }));
}

export async function getDeviceKey(id: string, managerId: string): Promise<DeviceKey> {
  return { key: decryptSecret((await loadOwn(id, managerId)).keyEnc) };
}

/** New key; the phone using the old one is signed out (marked offline right away). */
export async function regenerateKey(id: string, managerId: string): Promise<DeviceWithKey> {
  await loadOwn(id, managerId);
  const key = newKey();
  const d = await prisma.device.update({ where: { id }, data: { ...keyFields(key), lastSeenAt: null, state: "IDLE", streamingSince: null }, include: deviceInclude });
  await kickDevice(id);
  return { ...toDeviceRow(d), key };
}

export async function deleteDevice(id: string, managerId: string): Promise<void> {
  await loadOwn(id, managerId);
  await stopOutput(id);
  await prisma.device.delete({ where: { id } });
  await kickDevice(id);
}

// ---------------------------------------------------------------- phone

export async function deviceFromKey(key: string | undefined): Promise<Device & { manager: { displayName: string; isActive: boolean } }> {
  const k = key?.trim();
  if (!k || !k.startsWith(DEVICE_KEY_PREFIX) || k.length > 100) throw new AppError("DEVICE_KEY_INVALID", DEVICE_KEY_INVALID_MESSAGE);
  const d = await prisma.device.findUnique({ where: { keyHash: sha256(k) }, include: { manager: { select: { displayName: true, isActive: true } } } });
  if (!d || !d.manager.isActive) throw new AppError("DEVICE_KEY_INVALID", DEVICE_KEY_INVALID_MESSAGE);
  return d;
}

export async function hello(device: Device & { manager: { displayName: string } }, input: DeviceHelloInput): Promise<DeviceHelloResponse> {
  await prisma.device.update({
    where: { id: device.id },
    data: { model: input.deviceModel ?? device.model, osVersion: input.osVersion ?? device.osVersion, appVersion: input.appVersion ?? device.appVersion, lastSeenAt: new Date() },
  });
  return { device: { id: device.id, name: device.name }, manager: { name: device.manager.displayName }, assignedMatch: null };
}

export async function heartbeat(device: Device, input: DeviceHeartbeatInput): Promise<DeviceHeartbeatResponse> {
  const now = new Date();
  const live = input.state === "LIVE";
  // a broadcast "continues" only if the previous heartbeat was LIVE and recent; otherwise it starts now
  const wasLive = device.state === "LIVE" && deviceStatus(device, now.getTime()) === "STREAMING";
  const health: DeviceHealth = {
    battery: input.battery ?? null,
    charging: input.charging ?? null,
    thermal: input.thermal ?? null,
    cpuPct: input.cpuPct ?? null,
    memMB: input.memMB ?? null,
    quality: input.quality ?? null,
    autoDowngraded: input.autoDowngraded ?? false,
    fps: input.fps ?? null,
    bitrateKbps: input.bitrateKbps ?? null,
    width: input.width ?? null,
    height: input.height ?? null,
    network: input.network ?? null,
  };
  await prisma.device.update({
    where: { id: device.id },
    data: {
      lastSeenAt: now,
      state: input.state,
      streamingSince: live ? (wasLive ? device.streamingSince : now) : null,
      health: health as unknown as Prisma.InputJsonValue,
    },
  });
  return { assignedMatch: null, snapshotRequests: takeSnapshotRequests(device.id) };
}

/** Where the phone should publish, with a fresh 10-minute token (asked again on every reconnect). */
export async function streamStart(device: Device, _input: DeviceStreamStartInput): Promise<DeviceStreamStartResponse> {
  const { token, expiresAt } = publishToken(device.id, device.keyHash);
  await prisma.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
  return { rtmpUrl: env.MEDIA_RTMP_URL.replace(/\/+$/, ""), streamName: `dev_${device.id}?token=${token}`, expiresAt: expiresAt.toISOString() };
}

export async function streamStop(device: Device): Promise<void> {
  await prisma.device.update({ where: { id: device.id }, data: { state: "IDLE", streamingSince: null, lastSeenAt: new Date() } });
}

// ---------------------------------------------------------------- phase 6b: broadcast match

/** Which match the device's broadcast layout shows (must be one of the manager's matches). */
export async function setDeviceMatch(id: string, managerId: string, matchId: string | null): Promise<DeviceRow> {
  await loadOwn(id, managerId);
  if (matchId) await loadOwnMatch(matchId, managerId);
  const before = await loadOwn(id, managerId);
  // a broadcast belongs to one match: switching or clearing the match ends it
  const keepBroadcast = before.broadcastLive && before.matchId === matchId;
  const d = await prisma.device.update({
    where: { id },
    data: { matchId, ...(keepBroadcast ? {} : { broadcastLive: false, broadcastStartedAt: null }) },
    include: deviceInclude,
  });
  const [row] = await withVideo([d]);
  return row!;
}

// ---------------------------------------------------------------- phase 6c: broadcast to the match's teams

export async function startBroadcast(id: string, managerId: string): Promise<DeviceRow> {
  const d = await loadOwn(id, managerId);
  if (!d.matchId) throw conflict("Pick the match for this iPhone first.");
  if (!(await deviceStreamReady(id))) throw conflict("The iPhone isn't streaming. Start streaming on the phone, then start the broadcast.");
  const u = await prisma.device.update({
    where: { id },
    data: { broadcastLive: true, broadcastStartedAt: d.broadcastLive && d.broadcastStartedAt ? d.broadcastStartedAt : new Date() },
    include: deviceInclude,
  });
  const [row] = await withVideo([u]);
  return row!;
}

export async function stopBroadcast(id: string, managerId: string): Promise<DeviceRow> {
  await loadOwn(id, managerId);
  const u = await prisma.device.update({ where: { id }, data: { broadcastLive: false, broadcastStartedAt: null }, include: deviceInclude });
  const [row] = await withVideo([u]);
  return row!;
}

/** The device broadcasting this match to its teams (null = none). */
export async function broadcastingDevice(matchId: string) {
  return prisma.device.findFirst({ where: { matchId, broadcastLive: true }, orderBy: { broadcastStartedAt: "desc" } });
}
