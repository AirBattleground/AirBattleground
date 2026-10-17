# Phase 4 — 7XEN Manager App (Android): live match operations

## Context
Today the manager runs a match by hand: create the BGMI custom room, share the room ID/password, take
screenshots of the team list and results, then upload them in the web match center. The owner wants the
manager's match-day work to move into a phone app that sits next to BGMI and does this:
open BGMI, record the screen, create the room (assisted or automatic touch steps), and capture the
start (team list) and end (results/finishes) screenshots automatically — plus a full recording of every
game. The web portal stays for planning (scrims, tournaments, approvals); the app is the match-day
companion that feeds the existing pipeline (screenshot reader → review → publish → points).

Owner decisions: **Android only** · **direct APK** (not Play Store — Play forbids accessibility-based game
automation) · **assisted first, auto-taps opt-in** (anti-cheat/ban risk is shown in the app; recommend a spare
host account) · **every match video uploaded to 7xen**.

## What the manager experiences
1. Open **7XEN Manager** → sign in (same manager account) → "Today": their scrim / tournament matches with
   time, map, lobby, registered teams.
2. Tap a match → **Go live**. Android asks once for screen-capture permission; a small floating 7XEN bubble
   appears over BGMI and recording starts (foreground notification with Stop/Pause).
3. **Room** — the bubble shows a checklist for this match (Custom Room → Create → map, mode, slots,
   password …). Assisted mode highlights the next step and ticks it off automatically when it sees that
   screen; Auto mode (opt-in) performs the taps. The room ID/password are read from the screen (or typed)
   and sent to 7xen → approved teams see them in their app/portal, revealed X minutes before start.
4. **Start** — when the in-game team list is detected, screenshots are captured automatically (scrolling if
   needed) → uploaded as SLOT_LIST to the match → the reader fills the lineup.
5. **End** — when the results screen appears, every scroll position is captured (duplicates dropped) →
   uploaded as RESULTS → ranks/finishes filled.
6. Stop → the video uploads in the background (resumable, Wi-Fi by default). The manager reviews and
   publishes in the app (or on the web) — reusing the existing match-center screens.

## Architecture
```
apps/mobile (new)  React Native (Expo dev-client) + TypeScript — UI, login, matches, review
  └─ modules/gameops (Kotlin native module)
       ├ CaptureService   MediaProjection + MediaCodec → MP4 (720p, ~1.5–2.5 Mbps) + frame tap (1–2 fps)
       ├ ScreenDetector   on-device classifier on downscaled frames: TEAM_LIST / RESULTS / ROOM_* / OTHER
       │                  (colour/layout rules first — same cues as services/extractor detect.py; TFLite later)
       ├ OverlayService   floating bubble + checklist (SYSTEM_ALERT_WINDOW)
       └ AutomationService AccessibilityService: dispatchGesture taps/swipes from "recipes"
packages/shared → reused by the app (zod schemas, DTOs, api client — add bearer-token mode)
apps/api           new: mobile auth tokens, match room details, live sessions, chunked video upload
services/extractor unchanged — screenshots go through the existing upload → worker → reader → merge
```
- **Recipes** (JSON, versioned, editable by admin): steps = {expect screen, tap at relative point / anchor,
  wait, read text}. Coordinates relative to the detected game viewport (reuse the viewport idea from
  `services/extractor/app/pipeline/viewport.py`). **Teach mode**: manager performs the steps once while the
  app records taps → saved as that device's recipe. Survives BGMI UI changes by re-teaching.
- **Auto-capture dedupe**: perceptual hash per frame; results captured until the scroll position stops
  changing; ranks 1–2 repeat — already handled server-side by `apps/api/src/services/merge.ts`.

## Backend changes (apps/api, packages/shared)
- **Mobile auth**: `POST /api/auth/token` → JWT for the app; `requireAuth` (`apps/api/src/middleware/requireAuth.ts`)
  also accepts `Authorization: Bearer` (cookie flow unchanged). Reuse `signToken/verifyToken` in `src/lib/auth.ts`.
- **Room details on Match**: `roomId`, `roomPassword`, `roomRevealAt` (migration). `PUT /api/manager/matches/:id/room`;
  teams get room details for their matches once `roomRevealAt` passes (team dashboard / scorecard / tournament hub).
- **Live sessions**: `MatchRecording` model (matchId, deviceId, status, startedAt, endedAt, video key, size, duration).
  `POST /api/manager/matches/:id/live` (start), `PATCH …/live/:sid` (events: room created, captures, stop).
- **Screenshots**: reuse `POST /api/manager/matches/:matchId/screenshots` (`src/routes/matchCenter.ts`, `src/lib/upload.ts`)
  with a `source: "APP_AUTO" | "APP_MANUAL"` tag.
- **Video upload**: resumable chunked upload (tus-style: create → PATCH chunks with offset → finalize), stored via
  `src/lib/storage.ts` under a new `videos/` area with its own `VIDEO_DIR` (can point to a bigger disk); poster
  thumbnail + duration via ffmpeg; managers/admin can stream it (HTTP range) from the match center; retention
  setting (e.g. delete after N days) in the admin console.
- **Recipes**: `GET /api/manager/recipes` (admin-maintained defaults + per-manager taught versions).

## Phased delivery
1. **Foundation**: Android toolchain on this machine (JDK 17 + Android SDK ≈ 4 GB; Expo/EAS local build), app
   shell (login, Today list, match detail, room details), bearer auth, room-detail API + team view. Signed APK +
   download link in the web portal.
2. **Record + manual capture**: MediaProjection recording service, floating bubble with "Capture team list" /
   "Capture results" buttons → upload to the match; video upload pipeline + playback in match center.
3. **Auto-capture**: on-device screen detection (team list, results, room screens), results auto-scroll capture
   via assisted prompts ("swipe the results"), dedupe, live status in the app.
4. **Assisted + auto room creation**: checklist overlay with auto-tick, teach mode, recipes; opt-in Auto mode
   (AccessibilityService gestures) behind a warning + per-device toggle; auto-read room ID/password.
5. **Polish**: in-app review & publish (reuse match-center logic), retries/offline queue, battery/thermal care,
   admin recipes + video retention UI.

## Risks / constraints (to state in the app and docs)
- **BGMI ToS / anti-cheat**: automated taps may be flagged → Auto mode opt-in, warning, spare host account.
- **Android 14+**: screen-capture consent each session; foreground service type `mediaProjection`; some OEMs
  kill background services (guide to disable battery optimisation).
- **Phone load**: BGMI + recording + detection on one phone — 720p/30 fps recording, detection at ≤2 fps.
- **Storage**: ~300–600 MB per match video; this machine has ~28 GB free → `VIDEO_DIR` on a larger disk or
  object storage, plus retention. Uploads from outside the Wi-Fi need the server online (public HTTPS).
- **Testing**: I can build the APK and unit-test the native/detector logic, but BGMI on a real Android phone must
  be tested by the owner (no emulator runs BGMI reliably).

## Verification
- API: new tests (bearer auth, room details + reveal timing, live sessions, chunked upload resume/finalize,
  range streaming) alongside the existing suites; `pnpm smoke` still passes.
- Detector: run the on-device classifier logic (shared rules) against the 181 labelled screenshots in
  `services/extractor/eval/dataset/` → must classify SLOT_LIST/RESULTS ≈100%.
- App: build signed APK; owner installs on their phone; scripted checklist: login → Go live → record 2 min of
  BGMI → manual capture → auto-capture of team list/results → video uploads and plays in the web match center →
  screenshots read and merged.
- Parallel build as before (agents: mobile shell, native capture/overlay, detection+recipes, backend, QA).

## Contracts & environment (for the build)
- API contract: `packages/shared/src/phase4.ts` (endpoints in its header). DB: `MatchRecording`, `Recipe`, `AppSetting`,
  `Match.room*`, `Screenshot.source` (migration `phase4_manager_app`, applied).
- App ↔ native contract: `apps/mobile/modules/gameops/src/GameOps.types.ts`.
- `apps/mobile` is an Expo (SDK 58, RN 0.88) app **outside the pnpm workspace** (own `npm install`); it uses
  `@7xen/shared` via Metro `watchFolders` + TS paths (no pnpm link).
- Android toolchain (no sudo): `JAVA_HOME=~/.local/share/7xen-android/jdk17`, `ANDROID_HOME=~/.local/share/7xen-android/sdk`
  (platform 35, build-tools 35.0.0, NDK 27.1.12297006, cmake 3.22.1). Build locally with `npx expo prebuild` + Gradle
  (`./gradlew assembleRelease`) — no EAS cloud.
- The production stack runs on this machine (port 80, api on 127.0.0.1:4000, extractor). Don't touch docker containers;
  use test DB schemas / other ports for dev.

## Ownership for parallel work
| Workstream | Owns |
|---|---|
| Backend | `apps/api/**` (+ additive changes to `packages/shared/src/phase4.ts`) |
| Mobile app (JS/TS) | `apps/mobile/**` except `apps/mobile/modules/gameops/**` |
| Native GameOps (Kotlin) | `apps/mobile/modules/gameops/**` except `.../detector/**` |
| Detection | `apps/mobile/modules/gameops/android/src/main/java/**/detector/**`, `tools/detector-jvm/**` (JVM test harness) |
| Web | `apps/web/src/**`, `apps/admin/src/**` (room details, recordings player, team room reveal, admin settings/recipes/recordings, APK download) |
