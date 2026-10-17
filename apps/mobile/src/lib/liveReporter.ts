/**
 * App-wide bridge between GameOps native events and the 7XEN API:
 * - keeps an event queue per recording and PATCHes /api/manager/recordings/:id (start, captures, pause, stop…)
 * - remembers the latest upload progress per recording (for the Recordings screen)
 * - remembers the last room ID/password read from the screen
 * Lives outside React so it keeps working while the manager moves between screens.
 */
import { useSyncExternalStore } from "react";
import type { RecordingEventInput } from "@7xen/shared";
import type { BearerClient } from "./api";
import { RecordingEventQueue, type QueuedEvent } from "./eventQueue";
import { GameOps } from "@/native/gameops";
import type { SessionStatus, Subscription, UploadProgressEvent } from "@/native/types";

type State = {
  status: SessionStatus | null;
  /** when `status` arrived (to extrapolate elapsed time) */
  statusAt: number;
  uploads: Record<string, UploadProgressEvent>;
  roomInfo: { roomId: string | null; password: string | null; at: number } | null;
  lastError: { message: string; fatal: boolean; at: number } | null;
};

let state: State = { status: null, statusAt: 0, uploads: {}, roomInfo: null, lastError: null };
const listeners = new Set<() => void>();
const setState = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

let api: BearerClient | null = null;
let queue: RecordingEventQueue | null = null;
let subs: Subscription[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

function ensureQueue(recordingId: string | null) {
  if (!recordingId || !api) return null;
  if (!queue || queue.recordingId !== recordingId) {
    const client = api;
    queue = new RecordingEventQueue(recordingId, (id, body: RecordingEventInput) => client.patch(`/api/manager/recordings/${id}`, body));
  }
  return queue;
}

export const liveReporter = {
  /** Call once when signed in. */
  attach(client: BearerClient) {
    api = client;
    if (subs.length) return;
    subs = [
      GameOps.addListener("onStatus", (s) => {
        const prev = state.status;
        setState({ status: s, statusAt: Date.now() });
        if (prev && prev.state !== s.state && s.recordingId) {
          if (s.state === "PAUSED") ensureQueue(s.recordingId)?.push("pause");
          if (s.state === "LIVE" && prev.state === "PAUSED") ensureQueue(s.recordingId)?.push("resume");
          if (s.state === "ERROR") ensureQueue(s.recordingId)?.push("error", s.error ?? "Recorder error");
        }
      }),
      GameOps.addListener("onCapture", (c) => {
        const rid = state.status?.recordingId ?? null;
        ensureQueue(rid)?.push("capture", `${c.kind} ${c.auto ? "auto" : "manual"}${c.error ? ` · ${c.error}` : c.uploaded ? "" : " · upload pending"}`);
      }),
      GameOps.addListener("onScreen", (e) => {
        if (e.screen === "TEAM_LIST" || e.screen === "RESULTS") ensureQueue(state.status?.recordingId ?? null)?.push("screen", `${e.screen} (${Math.round(e.confidence * 100)}%)`);
      }),
      GameOps.addListener("onRoomInfo", (r) => setState({ roomInfo: { ...r, at: Date.now() } })),
      GameOps.addListener("onUploadProgress", (u) => setState({ uploads: { ...state.uploads, [u.recordingId]: u } })),
      GameOps.addListener("onError", (e) => {
        setState({ lastError: { ...e, at: Date.now() } });
        ensureQueue(state.status?.recordingId ?? null)?.push("error", e.message);
      }),
    ];
    flushTimer = setInterval(() => void queue?.flush(), 5000);
    void GameOps.getStatus()
      .then((s) => setState({ status: s, statusAt: Date.now() }))
      .catch(() => {});
  },
  detach() {
    subs.forEach((s) => s.remove());
    subs = [];
    if (flushTimer) clearInterval(flushTimer);
    flushTimer = null;
    api = null;
    queue = null;
  },
  log(recordingId: string, type: QueuedEvent["type"], detail?: string) {
    ensureQueue(recordingId)?.push(type, detail ?? null);
  },
  async flush(recordingId: string, extra: Omit<RecordingEventInput, "events"> = {}) {
    return ensureQueue(recordingId)?.flush(extra) ?? false;
  },
  setStatus(s: SessionStatus) {
    setState({ status: s, statusAt: Date.now() });
  },
  clearRoomInfo() {
    setState({ roomInfo: null });
  },
  get: () => state,
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export function useLive<T>(select: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}
