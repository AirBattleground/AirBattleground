/**
 * Paired phones: the phase-6 device API logic (served by the box), live state from heartbeats (memory only),
 * snapshot requests riding on heartbeat replies, and BoxDevice rows for the Studio.
 */
import { randomUUID } from "node:crypto";
import {
  DEVICE_KEY_INVALID_MESSAGE,
  DEVICE_KEY_PREFIX,
  DEVICE_ONLINE_WINDOW_MS,
  type BoxDevice,
  type DeviceHealth,
  type DeviceHeartbeatInput,
  type DeviceHeartbeatResponse,
  type DeviceHelloInput,
  type DeviceHelloResponse,
  type DeviceStreamStartResponse,
} from "@7xen/shared";
import { HttpError } from "./http.js";
import type { MediaClient } from "./media.js";
import type { StoredDevice, Store } from "./store.js";
import type { Tokens } from "./tokens.js";

export const MAX_BOX_DEVICES = 50;
const SNAPSHOT_TTL_MS = 20_000;

/** hello response on the box: adds the box's name */
export interface BoxHelloResponse extends DeviceHelloResponse {
  studio: { name: string };
}

interface Live {
  lastSeenAt: number;
  state: "IDLE" | "LIVE";
  streamingSince: number | null;
  health: DeviceHealth | null;
  /** fps the phone said it would send (stream/start) */
  fps: number | null;
}

interface PendingSnapshot {
  id: string;
  deviceId: string;
  at: number;
  sent: boolean;
  resolve: (png: Buffer | null) => void;
}

export interface DevicesDeps {
  store: Store;
  tokens: Tokens;
  media: Pick<MediaClient, "pathReady" | "kick">;
  boxName: () => string;
  lanHost: string;
  rtmpPort: number;
  now?: () => number;
}

export class Devices {
  private live = new Map<string, Live>();
  private snapshots = new Map<string, PendingSnapshot>();
  private readonly now: () => number;

  constructor(private readonly d: DevicesDeps) {
    this.now = d.now ?? Date.now;
  }

  // ---------------------------------------------------------------- phone

  fromKey(key: string | undefined): StoredDevice {
    const k = key?.trim();
    const dev = k && k.startsWith(DEVICE_KEY_PREFIX) && k.length <= 100 ? this.d.store.byKey(k) : undefined;
    if (!dev) throw new HttpError(401, "DEVICE_KEY_INVALID", DEVICE_KEY_INVALID_MESSAGE);
    return dev;
  }

  private touch(id: string): Live {
    let l = this.live.get(id);
    if (!l) {
      l = { lastSeenAt: 0, state: "IDLE", streamingSince: null, health: null, fps: null };
      this.live.set(id, l);
    }
    l.lastSeenAt = this.now();
    return l;
  }

  hello(dev: StoredDevice, input: DeviceHelloInput): BoxHelloResponse {
    this.touch(dev.id);
    this.d.store.update(dev.id, {
      model: input.deviceModel ?? dev.model,
      osVersion: input.osVersion ?? dev.osVersion,
      appVersion: input.appVersion ?? dev.appVersion,
      lastHelloAt: new Date(this.now()).toISOString(),
    });
    const name = this.d.boxName();
    return { device: { id: dev.id, name: dev.name }, manager: { name }, assignedMatch: null, studio: { name } };
  }

  heartbeat(dev: StoredDevice, input: DeviceHeartbeatInput): DeviceHeartbeatResponse {
    const prev = this.live.get(dev.id);
    const now = this.now();
    // a broadcast "continues" only if the previous heartbeat was LIVE and recent; otherwise it starts now
    const wasLive = !!prev && prev.state === "LIVE" && now - prev.lastSeenAt <= DEVICE_ONLINE_WINDOW_MS;
    const l = this.touch(dev.id);
    l.state = input.state;
    l.streamingSince = input.state === "LIVE" ? (wasLive ? (prev?.streamingSince ?? now) : now) : null;
    l.health = {
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
    return { assignedMatch: null, snapshotRequests: this.takeSnapshotRequests(dev.id) };
  }

  streamStart(dev: StoredDevice, input: { fps?: number }): DeviceStreamStartResponse {
    const l = this.touch(dev.id);
    if (input.fps) l.fps = input.fps;
    const { token, expiresAt } = this.d.tokens.publishToken(dev.id, dev.keyHash, this.now());
    return {
      rtmpUrl: `rtmp://${this.d.lanHost}:${this.d.rtmpPort}/live`,
      streamName: `dev_${dev.id}?token=${token}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  streamStop(dev: StoredDevice) {
    const l = this.touch(dev.id);
    l.state = "IDLE";
    l.streamingSince = null;
  }

  // ---------------------------------------------------------------- snapshots

  private sweep() {
    const now = this.now();
    for (const p of this.snapshots.values()) {
      if (now - p.at > SNAPSHOT_TTL_MS) {
        this.snapshots.delete(p.id);
        p.resolve(null);
      }
    }
  }

  takeSnapshotRequests(deviceId: string): { id: string }[] {
    this.sweep();
    const out: { id: string }[] = [];
    for (const p of this.snapshots.values()) {
      if (p.deviceId === deviceId && !p.sent) {
        p.sent = true;
        out.push({ id: p.id });
      }
    }
    return out;
  }

  /** The phone uploaded the PNG for a request. False when unknown / expired / another device's. */
  fulfilSnapshot(deviceId: string, requestId: string, png: Buffer): boolean {
    const p = this.snapshots.get(requestId);
    if (!p || p.deviceId !== deviceId) return false;
    this.snapshots.delete(requestId);
    p.resolve(png);
    return true;
  }

  /** Ask the phone for a full-quality screenshot (rides on its next heartbeat reply); null after `waitMs`. */
  requestSnapshot(deviceId: string, waitMs = 5_000): Promise<Buffer | null> {
    return new Promise((resolve) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.snapshots.delete(id);
        resolve(null);
      }, waitMs);
      this.snapshots.set(id, {
        id,
        deviceId,
        at: this.now(),
        sent: false,
        resolve: (png) => {
          clearTimeout(timer);
          resolve(png);
        },
      });
    });
  }

  // ---------------------------------------------------------------- Studio (box UI)

  async row(dev: StoredDevice): Promise<BoxDevice> {
    const video = await this.d.media.pathReady(dev.id);
    const l = this.live.get(dev.id);
    const now = this.now();
    const online = !!l && now - l.lastSeenAt <= DEVICE_ONLINE_WINDOW_MS;
    // video arriving wins over the phone's own state (the app's heartbeat can say IDLE while its extension streams)
    const streaming = !!video || (online && l?.state === "LIVE");
    const since = l?.state === "LIVE" && l.streamingSince ? new Date(l.streamingSince) : (video?.readySince ?? null);
    const lastSeen = l?.lastSeenAt ? new Date(l.lastSeenAt).toISOString() : dev.lastHelloAt;
    return {
      id: dev.id,
      name: dev.name,
      online,
      streaming,
      videoReady: !!video,
      streamingSince: streaming && since ? since.toISOString() : null,
      lastSeenAt: lastSeen,
      model: dev.model,
      osVersion: dev.osVersion,
      appVersion: dev.appVersion,
      health: (l?.health as Record<string, unknown> | null | undefined) ?? null,
      hlsUrl: `/box/devices/${dev.id}/live/index.m3u8`,
    };
  }

  async rows(): Promise<BoxDevice[]> {
    return Promise.all(this.d.store.list().map((dev) => this.row(dev)));
  }

  create(name: string) {
    if (this.d.store.list().length >= MAX_BOX_DEVICES) throw new HttpError(409, "CONFLICT", `You can add up to ${MAX_BOX_DEVICES} devices. Remove one first.`);
    return this.d.store.create(name);
  }

  async remove(id: string) {
    if (!this.d.store.remove(id)) throw new HttpError(404, "NOT_FOUND", "Device not found");
    this.live.delete(id);
    await this.d.media.kick(id);
  }

  /** counts for BoxPollInfo */
  async counts(): Promise<{ devices: number; streaming: number }> {
    const rows = await this.rows();
    return { devices: Math.min(100, rows.length), streaming: Math.min(100, rows.filter((r) => r.streaming).length) };
  }
}
