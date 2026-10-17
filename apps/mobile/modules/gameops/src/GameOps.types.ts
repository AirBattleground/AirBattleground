/**
 * CONTRACT between the React Native app (apps/mobile/src/**) and the Kotlin native module "GameOps"
 * (apps/mobile/modules/gameops/android/**). Both sides are built in parallel against this file — change only
 * additively. Plan: docs/phase4/MANAGER_APP.md.
 *
 * The native side owns everything that must keep working while BGMI is in the foreground:
 * screen recording (MediaProjection + MediaCodec), frame analysis (ScreenDetector), the floating bubble /
 * checklist overlay, AccessibilityService gestures, and uploads (screenshots immediately, video resumable via
 * WorkManager) — so nothing depends on the JS thread being alive.
 */
import type { RecipeStep, ScreenshotKind } from "@7xen/shared";

export type ScreenKind = "TEAM_LIST" | "RESULTS" | "LOBBY" | "OTHER";

export interface GameOpsPermissions {
  /** SYSTEM_ALERT_WINDOW ("Display over other apps") */
  overlay: boolean;
  /** our AccessibilityService is enabled (only needed for Auto mode) */
  accessibility: boolean;
  /** POST_NOTIFICATIONS (Android 13+) for the foreground-service notification */
  notifications: boolean;
  /** battery optimisation ignored (recommended so OEMs don't kill the session) */
  batteryOptimizationIgnored: boolean;
  /** BGMI (com.pubg.imobile) installed */
  bgmiInstalled: boolean;
}

export interface StartSessionOptions {
  /** 7xen API base, e.g. "http://192.168.0.199" (no trailing slash) */
  apiBaseUrl: string;
  /** Bearer token from POST /api/auth/token */
  token: string;
  matchId: string;
  /** MatchRecording id from POST /api/manager/matches/:id/recordings */
  recordingId: string;
  /** shown in the notification + bubble, e.g. "Daily Evening Showdown · Match 2" */
  title: string;
  /** steps for the floating checklist (CREATE_ROOM recipe, etc.) */
  checklist: RecipeStep[];
  /** perform recipe taps automatically (requires accessibility). false = assisted (highlight + auto-tick) */
  autoMode: boolean;
  /** record the full match video (owner decision: always true; kept configurable) */
  recordVideo: boolean;
  quality: "720p" | "1080p";
  /** run ScreenDetector and capture TEAM_LIST / RESULTS automatically */
  autoCapture: boolean;
  /** room password to type when a recipe step says input_text roomPassword */
  roomPassword?: string;
  /** launch BGMI right after starting */
  launchBgmi: boolean;
}

export interface SessionStatus {
  state: "IDLE" | "STARTING" | "LIVE" | "PAUSED" | "STOPPING" | "STOPPED" | "ERROR";
  recordingId: string | null;
  matchId: string | null;
  elapsedMs: number;
  /** last detected screen (when autoCapture) */
  screen: ScreenKind | null;
  captures: { slotList: number; results: number; pendingUploads: number };
  checklist: { stepId: string; done: boolean }[];
  videoPath: string | null;
  error: string | null;
}

export interface CaptureEvent {
  kind: ScreenshotKind;
  auto: boolean;
  /** local file path (jpeg) */
  path: string;
  /** server Screenshot id once uploaded */
  screenshotId: string | null;
  uploaded: boolean;
  error: string | null;
}

export interface UploadProgressEvent {
  recordingId: string;
  uploadedBytes: number;
  totalBytes: number;
  state: "QUEUED" | "UPLOADING" | "DONE" | "FAILED" | "WAITING_FOR_WIFI";
  error: string | null;
}

export interface TeachResult {
  /** captured steps (taps/swipes relative to the game viewport + screen fingerprints) */
  steps: RecipeStep[];
  /** e.g. "2400x1080" */
  deviceProfile: string;
}

export interface GameOpsModule {
  getPermissions(): Promise<GameOpsPermissions>;
  requestOverlayPermission(): Promise<void>;
  openAccessibilitySettings(): Promise<void>;
  requestNotificationPermission(): Promise<boolean>;
  requestIgnoreBatteryOptimizations(): Promise<void>;
  launchBgmi(): Promise<boolean>;

  /** Asks for MediaProjection consent (system dialog), starts the foreground service, overlay and recording. */
  startSession(options: StartSessionOptions): Promise<SessionStatus>;
  pauseSession(): Promise<SessionStatus>;
  resumeSession(): Promise<SessionStatus>;
  /** Stops recording; queues the video upload (WorkManager; Wi-Fi only if `wifiOnly`). */
  stopSession(options: { wifiOnly: boolean }): Promise<SessionStatus>;
  getStatus(): Promise<SessionStatus>;
  /** Manual capture of the current screen (also available from the floating bubble). */
  captureNow(kind: ScreenshotKind): Promise<CaptureEvent>;
  /** Retry pending screenshot/video uploads (e.g. after network returns). */
  retryUploads(): Promise<void>;

  /** Teach mode: record the manager's own taps (via accessibility) as a recipe for `key`. */
  startTeachMode(key: string): Promise<void>;
  stopTeachMode(): Promise<TeachResult>;

  /** Events (Expo module events): */
  // "onStatus" (SessionStatus), "onCapture" (CaptureEvent), "onScreen" ({ screen: ScreenKind; confidence: number }),
  // "onRoomInfo" ({ roomId: string | null; password: string | null }), "onUploadProgress" (UploadProgressEvent),
  // "onError" ({ message: string; fatal: boolean })
}
