export type {
  CaptureEvent,
  GameOpsModule,
  GameOpsPermissions,
  ScreenKind,
  SessionStatus,
  StartSessionOptions,
  TeachResult,
  UploadProgressEvent,
} from "../../modules/gameops/src/GameOps.types";
import type { CaptureEvent, ScreenKind, SessionStatus, UploadProgressEvent } from "../../modules/gameops/src/GameOps.types";

/** Event payloads emitted by the native module (see GameOps.types.ts). */
export interface GameOpsEvents {
  onStatus: SessionStatus;
  onCapture: CaptureEvent;
  onScreen: { screen: ScreenKind; confidence: number };
  onRoomInfo: { roomId: string | null; password: string | null };
  onUploadProgress: UploadProgressEvent;
  onError: { message: string; fatal: boolean };
}
export type GameOpsEventName = keyof GameOpsEvents;
export interface Subscription {
  remove(): void;
}
