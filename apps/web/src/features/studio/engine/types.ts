/**
 * Studio show setup (saved on the show as `config`, version 1). Scenes are frames (layouts) whose slots are filled
 * with sources; overlays sit on top of whatever scene is on air.
 */
export type SourceRef =
  | { kind: "device"; id: string }
  | { kind: "camera" }
  | { kind: "prop"; id: string }
  | { kind: "scorecard" }
  | { kind: "mvp" }
  | { kind: "slate" };

/** full = one source · side = two side by side · pip = main + inset · desk = main + host column · trio = 1 big + 2 small */
export type LayoutKind = "full" | "side" | "pip" | "desk" | "trio";

export interface Scene {
  id: string;
  name: string;
  layout: LayoutKind;
  slots: (SourceRef | null)[];
}

export interface Overlays {
  /** the organiser's broadcast layout (title bar, teams, points) from the server, refreshed every few seconds */
  layout: boolean;
  /** "LIVE" + clock bug, top-right */
  liveBug: boolean;
  /** host name strip, bottom-left */
  lowerThird: boolean;
  lowerTitle: string;
  lowerSubtitle: string;
  /** scrolling text at the bottom */
  ticker: boolean;
  tickerText: string;
}

export interface StudioConfigV1 {
  v: 1;
  scenes: Scene[];
  overlays: Overlays;
  transition: "cut" | "fade";
  /** prop video that loops on the "Starting soon" scene */
  introPropId: string | null;
}

export const DEFAULT_OVERLAYS: Overlays = {
  layout: false,
  liveBug: true,
  lowerThird: false,
  lowerTitle: "",
  lowerSubtitle: "Caster",
  ticker: false,
  tickerText: "",
};

export const sameSource = (a: SourceRef | null, b: SourceRef | null) =>
  !!a && !!b && a.kind === b.kind && ("id" in a ? a.id : "") === ("id" in b ? b.id : "");

export const sourceKey = (s: SourceRef) => `${s.kind}:${"id" in s ? s.id : ""}`;
