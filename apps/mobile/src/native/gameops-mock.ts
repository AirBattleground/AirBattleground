/**
 * In-JS stand-in for the Kotlin GameOps module — used when the native module isn't in the build
 * (or EXPO_PUBLIC_GAMEOPS_MOCK=1). Simulates a session so the UI can be developed and demoed.
 */
import type { ScreenshotKind } from "@7xen/shared";
import type { CaptureEvent, GameOpsEventName, GameOpsEvents, GameOpsModule, GameOpsPermissions, SessionStatus, StartSessionOptions, Subscription, TeachResult } from "./types";

type Listener<K extends GameOpsEventName> = (e: GameOpsEvents[K]) => void;

const idle = (): SessionStatus => ({
  state: "IDLE",
  recordingId: null,
  matchId: null,
  elapsedMs: 0,
  screen: null,
  captures: { slotList: 0, results: 0, pendingUploads: 0 },
  checklist: [],
  videoPath: null,
  error: null,
});

export function createGameOpsMock(): GameOpsModule & { addListener<K extends GameOpsEventName>(name: K, cb: Listener<K>): Subscription } {
  const listeners = new Map<GameOpsEventName, Set<(e: unknown) => void>>();
  const emit = <K extends GameOpsEventName>(name: K, e: GameOpsEvents[K]) => listeners.get(name)?.forEach((cb) => cb(e));
  const perms: GameOpsPermissions = { overlay: false, accessibility: false, notifications: false, batteryOptimizationIgnored: false, bgmiInstalled: true };
  let status = idle();
  let startedAt = 0;
  let pausedTotal = 0;
  let pausedAt = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let tick = 0;

  const snapshot = (): SessionStatus => {
    if (status.state === "LIVE" || status.state === "PAUSED") {
      const now = status.state === "PAUSED" ? pausedAt : Date.now();
      status = { ...status, elapsedMs: now - startedAt - pausedTotal };
    }
    return { ...status, captures: { ...status.captures }, checklist: status.checklist.map((c) => ({ ...c })) };
  };
  const set = (patch: Partial<SessionStatus>) => {
    status = { ...status, ...patch };
    const s = snapshot();
    emit("onStatus", s);
    return s;
  };
  const capture = (kind: ScreenshotKind, auto: boolean): CaptureEvent => {
    const captures = { ...status.captures };
    if (kind === "SLOT_LIST") captures.slotList++;
    else captures.results++;
    set({ captures });
    const ev: CaptureEvent = { kind, auto, path: `/mock/${kind.toLowerCase()}-${Date.now()}.jpg`, screenshotId: `mock-${Date.now()}`, uploaded: true, error: null };
    emit("onCapture", ev);
    return ev;
  };

  return {
    addListener(name, cb) {
      const set = listeners.get(name) ?? new Set();
      set.add(cb as (e: unknown) => void);
      listeners.set(name, set);
      return { remove: () => set.delete(cb as (e: unknown) => void) };
    },
    async getPermissions() {
      return { ...perms };
    },
    async requestOverlayPermission() {
      perms.overlay = true;
    },
    async openAccessibilitySettings() {
      perms.accessibility = true;
    },
    async requestNotificationPermission() {
      perms.notifications = true;
      return true;
    },
    async requestIgnoreBatteryOptimizations() {
      perms.batteryOptimizationIgnored = true;
    },
    async launchBgmi() {
      return true;
    },
    async startSession(o: StartSessionOptions) {
      startedAt = Date.now();
      pausedTotal = 0;
      tick = 0;
      status = { ...idle(), state: "STARTING", recordingId: o.recordingId, matchId: o.matchId, checklist: o.checklist.map((s) => ({ stepId: s.id, done: false })) };
      emit("onStatus", snapshot());
      await new Promise((r) => setTimeout(r, 600));
      const s = set({ state: "LIVE" });
      if (timer) clearInterval(timer);
      timer = setInterval(() => {
        if (status.state !== "LIVE") return;
        tick++;
        const step = status.checklist.find((c) => !c.done);
        if (step && tick % 2 === 0) status = { ...status, checklist: status.checklist.map((c) => (c === step ? { ...c, done: true } : c)) };
        const screens = ["LOBBY", "OTHER", "TEAM_LIST", "OTHER", "OTHER", "RESULTS"] as const;
        const screen = screens[Math.floor(tick / 3) % screens.length]!;
        if (screen !== status.screen) {
          emit("onScreen", { screen, confidence: 0.92 });
          status = { ...status, screen };
          if (o.autoCapture && (screen === "TEAM_LIST" || screen === "RESULTS")) capture(screen === "TEAM_LIST" ? "SLOT_LIST" : "RESULTS", true);
        }
        if (tick === 4) emit("onRoomInfo", { roomId: "4417302", password: o.roomPassword ?? "7xen" });
        emit("onStatus", snapshot());
      }, 1000);
      return s;
    },
    async pauseSession() {
      pausedAt = Date.now();
      return set({ state: "PAUSED" });
    },
    async resumeSession() {
      pausedTotal += Date.now() - pausedAt;
      return set({ state: "LIVE" });
    },
    async stopSession({ wifiOnly }) {
      if (timer) clearInterval(timer);
      timer = null;
      const final = snapshot();
      const rid = status.recordingId ?? "mock";
      const s = set({ state: "STOPPED", elapsedMs: final.elapsedMs, videoPath: "/mock/match.mp4" });
      const total = 48 * 1024 * 1024;
      let sent = 0;
      emit("onUploadProgress", { recordingId: rid, uploadedBytes: 0, totalBytes: total, state: wifiOnly ? "QUEUED" : "UPLOADING", error: null });
      const up = setInterval(() => {
        sent = Math.min(total, sent + total / 8);
        emit("onUploadProgress", { recordingId: rid, uploadedBytes: sent, totalBytes: total, state: sent >= total ? "DONE" : "UPLOADING", error: null });
        if (sent >= total) clearInterval(up);
      }, 700);
      return s;
    },
    async getStatus() {
      return snapshot();
    },
    async captureNow(kind) {
      return capture(kind, false);
    },
    async retryUploads() {},
    async startTeachMode() {},
    async stopTeachMode(): Promise<TeachResult> {
      return {
        deviceProfile: "2400x1080",
        steps: [
          { id: "t1", label: "Tap 1", action: { type: "tap", x: 0.92, y: 0.18 }, timeoutMs: 15000 },
          { id: "t2", label: "Tap 2", action: { type: "tap", x: 0.5, y: 0.82 }, timeoutMs: 15000 },
          { id: "t3", label: "Tap 3", action: { type: "tap", x: 0.71, y: 0.64 }, timeoutMs: 15000 },
        ],
      };
    },
  };
}
