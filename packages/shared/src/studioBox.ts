/**
 * Phase 8c — Studio Box: a PC at the venue runs the phones, the media server, the Studio UI and the show itself; it
 * sends the finished show straight to YouTube / stream keys. The AirBattleground server (AWS) keeps logins, matches,
 * scores, branding, stream keys and the YouTube channel, and hands the box what it needs at go-live. No video goes
 * through AWS unless the Live page needs a copy.
 *
 *   phones ──Wi-Fi──► BOX: device API + MediaMTX + Studio UI (served from the box) + worker (render/encode) + outputs
 *                        └──► YouTube / stream keys / (optional) AWS live/show_<id> for the Live page
 *
 * A box IS a Studio worker (same StudioWorker row and key, see studioWorker.ts) that also reports `box` in its poll.
 * The website calls them "Studio boxes"; the Devices section is removed from the website — phones are added on the box.
 *
 * ── SERVER (AWS) changes ────────────────────────────────────────────────────────────────────────────────────────────
 *  POST /api/studio-worker/poll   WorkerPollInput + { box?: BoxPollInfo }        (additive)
 *  WorkerJob additions (additive): outputs, sendToAws, renderUrl on the box when it reported a lanUrl.
 *    - For a show running on a BOX the server does NOT run relays. At start-worker it creates the site-YouTube
 *      broadcast (when siteYoutube + connected) and puts its ingest into `outputs`, together with the show's stream
 *      keys (decrypted, full rtmp URL incl. key). The box pushes to them directly.
 *    - `sendToAws` = publicListing && no YouTube output. When true the box also publishes `publishUrl` (AWS) so the
 *      Live page can play HLS; when false the Live page embeds the YouTube video (LiveBroadcastCard.youtubeVideoId).
 *  StudioWorkerRow additions: box: BoxInfo | null (lanUrl to open its Studio).
 *  LiveBroadcastCard addition (device.ts): youtubeVideoId?: string — the web Live/Watch page embeds YouTube instead of HLS.
 *  Website: the Devices section (nav + pages) goes away; Studio lists boxes with "Open Studio on <box>" (box.lanUrl).
 *
 * ── BOX local HTTP API (services/studio-box, default port 4300, LAN only) ─────────────────────────────────────────
 *  Device API for the 7XEN Stream app — SAME contract as phase 6 (device.ts), header X-Device-Key, under /api/device/:
 *    POST /api/device/hello · /stream/start (body may add fps: 30|60) · /heartbeat · /snapshots/:requestId · /stream/stop
 *    hello response adds `studio: { name }`. stream/start returns the box's LAN RTMP (rtmp://<lan-ip>:1935/live).
 *  Box UI API (the Studio UI served by the box; signed-in manager — the box checks the session against AWS):
 *    GET    /box/info                        → BoxInfo
 *    GET    /box/devices                     → { items: BoxDevice[] }
 *    POST   /box/devices      { name }       → { device: BoxDevice; key: string; pairUrl: string }  (key shown once)
 *    PATCH  /box/devices/:id  { name }       → BoxDevice
 *    DELETE /box/devices/:id                 → 204
 *    GET    /box/devices/:id/live/<hls file> → the phone's HLS from the box's MediaMTX (same origin for the Studio)
 *    POST   /box/media/auth                  ← MediaMTX auth hook (local only): phones publish dev_<id> with their token;
 *                                              reads/publishes from 127.0.0.1 with the box's internal credentials
 *  Everything else under /api/* is proxied to AWS (cookies rewritten for the box origin), and the web app build is
 *  served for every other path — so http://<box>:4300 is the full website, with the box's Studio.
 *  Mixer in box mode: device sources play `BoxDevice.hlsUrl` (same origin) instead of the AWS device URL.
 */
import { z } from "zod";

export const BOX_DEFAULT_PORT = 4300;

/** What a box adds to its worker poll. */
export const boxPollInfoSchema = z.object({
  /** where managers open the box's Studio on the LAN, e.g. http://192.168.1.20:4300 */
  lanUrl: z.string().url().max(200),
  /** phones paired on the box (for the website's box card) */
  devices: z.number().int().min(0).max(100),
  /** phones streaming to the box right now */
  streaming: z.number().int().min(0).max(100),
});
export type BoxPollInfo = z.infer<typeof boxPollInfoSchema>;

export interface BoxInfo extends BoxPollInfo {
  name: string;
}

/** A finished-show destination the box pushes to (full RTMP URL including the stream key — keep it in memory only). */
export interface BoxOutput {
  id: string;
  name: string;
  url: string;
}

/** A phone paired on the box. */
export interface BoxDevice {
  id: string;
  name: string;
  /** heartbeat within 30 s */
  online: boolean;
  /** RTMP publishing to the box now */
  streaming: boolean;
  /** HLS of the phone is playable */
  videoReady: boolean;
  streamingSince: string | null;
  lastSeenAt: string | null;
  model: string | null;
  osVersion: string | null;
  appVersion: string | null;
  /** last heartbeat health (battery 0–1, thermal, fps, bitrateKbps, quality, width, height, network) */
  health: Record<string, unknown> | null;
  /** same-origin HLS for the Studio, e.g. /box/devices/<id>/live/index.m3u8 */
  hlsUrl: string;
}

export const boxDeviceNameSchema = z.object({ name: z.string().trim().min(2, "At least 2 characters").max(40) });
export type BoxDeviceNameInput = z.infer<typeof boxDeviceNameSchema>;

/** QR the 7XEN Stream app scans to pair with a box: host is the box's LAN base URL. */
export const boxPairUrl = (host: string, key: string, name: string) =>
  `7xen://pair?host=${encodeURIComponent(host)}&key=${encodeURIComponent(key)}&name=${encodeURIComponent(name)}`;
