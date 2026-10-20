/**
 * Phase 6b — broadcast output: the phone's video + a 7xen layout (title bar, team list, points table, ticker, sponsors)
 * burned into one stream, watchable in 7xen and pushed to YouTube / any RTMP destination.
 * Plan: docs/phase6/BROADCAST_OUTPUT.md.
 *
 * MANAGER (role MANAGER)
 *   GET    /api/manager/stream/layout                         → StreamLayoutResponse
 *   PUT    /api/manager/stream/layout     StreamLayoutConfig  → StreamLayoutResponse
 *   POST   /api/manager/stream/sponsors   multipart "image"   → SponsorLogo (201; max MAX_SPONSOR_LOGOS)
 *   DELETE /api/manager/stream/sponsors/:id                   → 204
 *   GET    /api/manager/stream/destinations                   → ListResponse<StreamDestinationRow>
 *   POST   /api/manager/stream/destinations  StreamDestinationInput → StreamDestinationRow (201)
 *   PATCH  /api/manager/stream/destinations/:id StreamDestinationUpdate → StreamDestinationRow
 *   DELETE /api/manager/stream/destinations/:id               → 204
 *   POST   /api/manager/stream/preview    { config, matchId?, deviceId? } → PNG overlay of an UNSAVED layout (editor preview)
 *   GET    /api/manager/devices/:id/overlay.png               → PNG overlay (saved layout + the device's match + LIVE timer);
 *                                                               the device page draws it over the live video, refreshing ~1/s
 *   PUT    /api/manager/devices/:id/match    { matchId|null }  → DeviceRow    (which match the overlay shows)
 *   GET    /api/manager/devices/:id/output                     → DeviceOutput
 *   POST   /api/manager/devices/:id/output/start  StartOutputInput → DeviceOutput (409 if the phone isn't sending video)
 *   POST   /api/manager/devices/:id/output/stop                → DeviceOutput
 *   GET    /api/manager/devices/:id/output/live/index.m3u8     → HLS of the finished (composed) stream
 */
import { z } from "zod";
import type { GameMap } from "./enums";
import type { OutputYoutube } from "./youtube";

export const OUTPUT_WIDTH = 1280;
export const OUTPUT_HEIGHT = 720;
export const MAX_SPONSOR_LOGOS = 6;
export const MAX_DESTINATIONS = 5;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour");
const onOff = z.boolean();

export const LAYOUT_SIDES = ["left", "right"] as const;
export const LAYOUT_CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;

/** Everything a manager can change about the layout. Missing fields fall back to DEFAULT_STREAM_LAYOUT. */
export const streamLayoutSchema = z.object({
  /** brand colour for bars, highlights */
  accent: hex,
  /** 0–100: panel background opacity */
  panelOpacity: z.number().int().min(30).max(100),
  titleBar: z.object({
    enabled: onOff,
    /** empty = scrim / tournament title */
    title: z.string().trim().max(60),
    showLogo: onOff,
    showMatchInfo: onOff,
    showMap: onOff,
    showLiveTimer: onOff,
  }),
  teams: z.object({
    enabled: onOff,
    side: z.enum(LAYOUT_SIDES),
    /** how many rows fit; extra teams are cut */
    maxRows: z.number().int().min(4).max(25),
  }),
  points: z.object({
    enabled: onOff,
    side: z.enum(LAYOUT_SIDES),
    topN: z.number().int().min(3).max(16),
  }),
  ticker: z.object({
    enabled: onOff,
    text: z.string().trim().max(200),
  }),
  sponsors: z.object({
    enabled: onOff,
    corner: z.enum(LAYOUT_CORNERS),
    /** shown left → right; ids from SponsorLogo */
    logoIds: z.array(z.string()).max(MAX_SPONSOR_LOGOS),
  }),
  socials: z.object({
    enabled: onOff,
    /** e.g. "YT: @opusesports · IG: @opus" */
    text: z.string().trim().max(80),
  }),
});
export type StreamLayoutConfig = z.infer<typeof streamLayoutSchema>;

export const DEFAULT_STREAM_LAYOUT: StreamLayoutConfig = {
  accent: "#22c7c7",
  panelOpacity: 82,
  titleBar: { enabled: true, title: "", showLogo: true, showMatchInfo: true, showMap: true, showLiveTimer: true },
  teams: { enabled: true, side: "left", maxRows: 16 },
  points: { enabled: false, side: "right", topN: 8 },
  ticker: { enabled: false, text: "" },
  sponsors: { enabled: false, corner: "bottom-right", logoIds: [] },
  socials: { enabled: false, text: "" },
};

export interface SponsorLogo {
  id: string;
  url: string;
}

export interface StreamLayoutResponse {
  config: StreamLayoutConfig;
  sponsors: SponsorLogo[];
  updatedAt: string | null;
}

// ---------------------------------------------------------------- destinations

export const DESTINATION_PRESETS = {
  YOUTUBE: { label: "YouTube", url: "rtmp://a.rtmp.youtube.com/live2" },
  FACEBOOK: { label: "Facebook", url: "rtmps://live-api-s.facebook.com:443/rtmp" },
  CUSTOM: { label: "Other (RTMP)", url: "" },
} as const;
export type DestinationKind = keyof typeof DESTINATION_PRESETS;

export const streamDestinationSchema = z.object({
  kind: z.enum(["YOUTUBE", "FACEBOOK", "CUSTOM"]),
  name: z.string().trim().min(2, "At least 2 characters").max(40),
  url: z.string().trim().regex(/^rtmps?:\/\/\S+$/i, "Must start with rtmp:// or rtmps://").max(300),
  streamKey: z.string().trim().min(4, "Paste the stream key").max(300),
});
export type StreamDestinationInput = z.infer<typeof streamDestinationSchema>;
export const streamDestinationUpdateSchema = streamDestinationSchema.partial();
export type StreamDestinationUpdate = z.infer<typeof streamDestinationUpdateSchema>;

export interface StreamDestinationRow {
  id: string;
  kind: DestinationKind;
  name: string;
  url: string;
  /** "abcd••••" — never the whole key */
  keyHint: string;
  createdAt: string;
}

// ---------------------------------------------------------------- output (per device)

export const setDeviceMatchSchema = z.object({ matchId: z.string().min(1).nullable() });
export type SetDeviceMatchInput = z.infer<typeof setDeviceMatchSchema>;

export const startOutputSchema = z.object({
  /** where to push besides 7xen (empty = 7xen only) */
  destinationIds: z.array(z.string()).max(MAX_DESTINATIONS).default([]),
});
export type StartOutputInput = z.infer<typeof startOutputSchema>;

export type OutputState = "OFF" | "STARTING" | "LIVE" | "RECONNECTING" | "ERROR";

export interface DeviceOutput {
  state: OutputState;
  startedAt: string | null;
  /** destinations being pushed to, with their own health */
  destinations: { id: string; name: string; kind: DestinationKind; ok: boolean }[];
  /** plain-English problem when state is ERROR / RECONNECTING */
  error: string | null;
  /** HLS of the composed output (null while OFF) */
  hlsUrl: string | null;
  match: { id: string; title: string; subtitle: string; map: GameMap } | null;
  /** phase 7b: this match's broadcast on the site YouTube channel (youtube.ts); absent/null = not streaming there */
  youtube?: OutputYoutube | null;
}
