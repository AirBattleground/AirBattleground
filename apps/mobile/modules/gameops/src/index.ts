/**
 * JS entry of the local Expo module "GameOps" (Kotlin: android/src/main/java/com/sevenxen/gameops/GameOpsModule.kt).
 * Contract: ./GameOps.types.ts. Android only — on other platforms / Expo Go the native module is missing (see `isAvailable`).
 */
import { NativeModule, requireOptionalNativeModule } from "expo";
import type { ScreenshotKind } from "@7xen/shared";
import type {
  CaptureEvent,
  GameOpsModule,
  GameOpsPermissions,
  ScreenKind,
  SessionStatus,
  StartSessionOptions,
  TeachResult,
  UploadProgressEvent,
} from "./GameOps.types";

export * from "./GameOps.types";

/** Event payloads (names as documented at the bottom of GameOpsModule in GameOps.types.ts). */
export type GameOpsEvents = {
  onStatus: (status: SessionStatus) => void;
  onCapture: (event: CaptureEvent) => void;
  onScreen: (event: { screen: ScreenKind; confidence: number }) => void;
  onRoomInfo: (event: { roomId: string | null; password: string | null }) => void;
  onUploadProgress: (event: UploadProgressEvent) => void;
  onError: (event: { message: string; fatal: boolean }) => void;
};
export type GameOpsEventName = keyof GameOpsEvents;

declare class GameOpsNativeModule extends NativeModule<GameOpsEvents> implements GameOpsModule {
  getPermissions(): Promise<GameOpsPermissions>;
  requestOverlayPermission(): Promise<void>;
  openAccessibilitySettings(): Promise<void>;
  requestNotificationPermission(): Promise<boolean>;
  requestIgnoreBatteryOptimizations(): Promise<void>;
  launchBgmi(): Promise<boolean>;
  startSession(options: StartSessionOptions): Promise<SessionStatus>;
  pauseSession(): Promise<SessionStatus>;
  resumeSession(): Promise<SessionStatus>;
  stopSession(options: { wifiOnly: boolean }): Promise<SessionStatus>;
  getStatus(): Promise<SessionStatus>;
  captureNow(kind: ScreenshotKind): Promise<CaptureEvent>;
  retryUploads(): Promise<void>;
  startTeachMode(key: string): Promise<void>;
  stopTeachMode(): Promise<TeachResult>;
}

/** null when the native module isn't in the binary (iOS, web, Expo Go). */
const GameOps = requireOptionalNativeModule<GameOpsNativeModule>("GameOps");

export const isAvailable = GameOps != null;

/**
 * Native rejections carry `code`: SESSION_ACTIVE | INVALID_OPTIONS | INVALID_RECIPE | NO_ACTIVITY | LOW_STORAGE |
 * PERMISSION_DENIED | START_FAILED | NO_SESSION | INVALID_KIND | CAPTURE_FAILED | OVERLAY_REQUIRED |
 * ACCESSIBILITY_REQUIRED | TEACH_FAILED | NO_TEACH.
 */
export type GameOpsErrorCode =
  | "SESSION_ACTIVE"
  | "INVALID_OPTIONS"
  | "INVALID_RECIPE"
  | "NO_ACTIVITY"
  | "LOW_STORAGE"
  | "PERMISSION_DENIED"
  | "START_FAILED"
  | "NO_SESSION"
  | "INVALID_KIND"
  | "CAPTURE_FAILED"
  | "OVERLAY_REQUIRED"
  | "ACCESSIBILITY_REQUIRED"
  | "TEACH_FAILED"
  | "NO_TEACH";

/** Typed as non-null for convenience; check `isAvailable` before use outside Android dev/prod builds. */
export default GameOps as GameOpsNativeModule;
