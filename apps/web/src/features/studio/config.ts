import type { DeviceRow } from "@7xen/shared";
import { DEFAULT_OVERLAYS, type LayoutKind, type Scene, type SourceRef, type StudioConfigV1 } from "./engine/types";

/** Short random id for scenes. */
export const sid = () => Math.random().toString(36).slice(2, 9);

/** A first setup for a new show: a slate, each phone, side by side, game + host, host, scorecard, MVP. */
export function defaultConfig(devices: DeviceRow[]): StudioConfigV1 {
  const d = devices.map((x) => ({ kind: "device" as const, id: x.id }));
  const scenes: Scene[] = [
    { id: sid(), name: "Starting soon", layout: "full", slots: [{ kind: "slate" }] },
    ...(d[0] ? [{ id: sid(), name: devices[0]!.name, layout: "full" as LayoutKind, slots: [d[0]] }] : []),
    ...(d[1] ? [{ id: sid(), name: devices[1]!.name, layout: "full" as LayoutKind, slots: [d[1]] }] : []),
    ...(d[1] ? [{ id: sid(), name: "Side by side", layout: "side" as LayoutKind, slots: [d[0]!, d[1]] }] : []),
    { id: sid(), name: "Game + host", layout: "desk", slots: [d[0] ?? null, { kind: "camera" }] },
    { id: sid(), name: "Host", layout: "full", slots: [{ kind: "camera" }] },
    { id: sid(), name: "Scorecard", layout: "full", slots: [{ kind: "scorecard" }] },
    { id: sid(), name: "MVP", layout: "full", slots: [{ kind: "mvp" }] },
  ];
  return { v: 1, scenes, overlays: { ...DEFAULT_OVERLAYS }, transition: "fade", introPropId: null };
}

/** The saved show config, or null when it isn't a (valid) v1 config. */
export function asConfig(raw: unknown): StudioConfigV1 | null {
  const c = raw as Partial<StudioConfigV1> | null;
  return c && c.v === 1 && Array.isArray(c.scenes) ? ({ ...c, overlays: { ...DEFAULT_OVERLAYS, ...(c.overlays ?? {}) } } as StudioConfigV1) : null;
}

/** The "Starting soon" slate plays the intro prop when one is picked. */
export function resolveScene(s: Scene, introPropId: string | null): Scene {
  return { ...s, slots: s.slots.map((x) => (x?.kind === "slate" && introPropId ? { kind: "prop", id: introPropId } : x)) };
}

/**
 * On a Studio worker: prop videos live in the manager's own browser and there is no webcam/mic, so those slots show
 * the slate instead (and the intro prop isn't played).
 */
export function resolveSceneForWorker(s: Scene): Scene {
  const slate: SourceRef = { kind: "slate" };
  return { ...s, slots: s.slots.map((x) => (x && (x.kind === "prop" || x.kind === "camera") ? slate : x)) };
}

/** Transition length of a take. */
export const fadeMsOf = (c: StudioConfigV1) => (c.transition === "fade" ? 600 : 0);
