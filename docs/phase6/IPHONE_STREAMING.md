# Phase 6 — iPhone streaming devices (view-only)

## Goal
A manager adds an **iPhone device** in 7xen and gets a **security key** (shown in their profile → Devices).
On the iPhone the manager installs the **7XEN Stream** app, enters host + key, and taps **Start streaming**.
The phone then broadcasts its whole screen (BGMI) to 7xen. In the portal the manager sees the device as
**Online / Streaming**, watches the live video, and presses **Capture team list** / **Capture results**. Those
screenshots go into the existing reader → review → publish → points pipeline.

**No remote control.** The phone only sends video and still frames. The server never taps or types on the device.

## Flow
```
iPhone app (SwiftUI) ── pair with key ──────────────▶ API  /api/device/*      (X-Device-Key)
iPhone Broadcast Extension (ReplayKit)
   ├─ H.264 video (RTMP, short-lived publish token) ─▶ MediaMTX  (path dev_<deviceId>)
   │                                                     ├─ auth hook ─▶ API /api/internal/media/auth
   │                                                     ├─ record fMP4 segments ─▶ /recordings
   │                                                     └─ HLS ─▶ API proxy ─▶ manager / admin / teams
   ├─ heartbeat every 2 s while live ────────────────▶ API (reply may carry snapshot requests)
   └─ full-res PNG on request ───────────────────────▶ API ─▶ uploadScreenshots(kind) ─▶ OCR (existing)
```

## Owner decisions (defaults, change if needed)
1. **One key per device.** Manager can add several iPhones. Each one has its own key, and regenerating a key logs out only that phone.
2. **The key stays viewable** in profile → Devices, with Copy and a QR code. It is stored encrypted, and a hash is used for lookup.
3. **Two steps in Match Center: Preview → Broadcast.**
   - **Select device**: the manager picks "Stream from: Yogi's iPhone". The phone connects and the video starts, but in
     **Preview**: only the manager (and admin) can see it. Teams get 403/404 and see "Not live yet".
   - **Start broadcast**: the manager presses this primary button and the same stream becomes visible to the teams in the match.
     The `MatchRecording` starts here, so the saved video is the broadcast, not the setup.
   - **End broadcast** hides it from teams again and finalises the recording. The phone keeps previewing until the manager
     removes the device or stops on the phone.
   Match field `broadcast: OFF | PREVIEW | LIVE` (with `broadcastStartedAt`) drives the viewer check.
4. **Screenshots for OCR are full-quality PNGs from the phone**, not video frames, which are too compressed for small text.
   If the phone doesn't answer within 5 s, the server grabs a frame from the stream with ffmpeg.
5. **Video quality is chosen on the phone** (480p / 720p / 1080p, default 720p, at about 1.2 / 2.5 / 4.5 Mbps). The server only records and shows it
   (a quality chip on the device card and in Match Center, plus an "auto-lowered (phone hot)" note when the phone stepped down).
   OCR snapshots are full-resolution PNGs regardless of the quality setting.
6. Ingest is **RTMP** in v1, protected by a 10-minute single-use publish token. RTMPS/SRT can come later.

## Backend (apps/api, packages/shared)
- **Prisma** `Device { id, managerId, name, platform IOS, keyHash @unique, keyEnc, keyPrefix, model?, osVersion?,
  appVersion?, lastSeenAt?, state IDLE|LIVE, battery?, thermal?, currentMatchId?, revokedAt?, createdAt }`.
  `MatchRecording.deviceId String?`.
- **Shared contract** `packages/shared/src/device.ts`: schemas + DTOs below, plus catalogue entries in `api.ts`.
- **Manager (cookie auth)**, mirrored for admin with bypass:
  - `GET /api/manager/devices` → `DeviceRow[]` (online = lastSeenAt < 20 s; streaming = MediaMTX path ready)
  - `POST /api/manager/devices {name}` → `DeviceRow & {key}` · `GET /api/manager/devices/:id/key` → `{key}`
  - `POST /api/manager/devices/:id/regenerate-key` · `PATCH …/:id {name}` · `DELETE …/:id`
  - `PUT /api/manager/matches/:matchId/device {deviceId|null}` → assign/unassign, which sets broadcast PREVIEW / OFF.
    Unassigning while LIVE also ends the broadcast. A device can serve one match at a time (`409` "This iPhone is already used for <match>").
  - `POST /api/manager/matches/:matchId/broadcast/start` → LIVE + starts `MatchRecording` (`409` if the device isn't streaming yet)
  - `POST /api/manager/matches/:matchId/broadcast/stop` → PREVIEW + finalises the recording
  - `POST /api/manager/devices/:id/capture {kind, matchId}` → `ScreenshotRow` (snapshot request, ffmpeg fallback, then `uploadScreenshots`). Works in Preview too.
  - `GET /api/live/device/:deviceId/index.m3u8` + segments: HLS proxied from MediaMTX via `requireViewer`.
    The owner manager and admin can always watch. Teams in the assigned match can watch **only while broadcast = LIVE**.
    The team view shows "The manager hasn't started the broadcast yet" otherwise.
- **Device API** (`X-Device-Key`, rate-limited, `401 DEVICE_KEY_INVALID` on bad/revoked key). Contract in IOS_APP_BRIEF.md:
  `POST /api/device/hello`, `POST /api/device/stream/start`, `POST /api/device/heartbeat`,
  `POST /api/device/snapshots/:requestId` (multipart PNG), `POST /api/device/stream/stop`.
- **Snapshot requests**: an in-memory map `deviceId → pending[]`. The heartbeat reply returns them. The manager's capture call waits up to 5 s for the upload.
- **MediaMTX hooks**: `authHTTPAddress` → `/api/internal/media/auth` (publish = valid unexpired token for that path; read = only the API's internal user).
  `runOnReady`/`runOnNotReady` → mark streaming. Recording: fMP4 segments. When the match is unassigned or the stream stops, ffmpeg concatenates them into `VIDEO_DIR`, then the existing `processVideo` makes the poster and sets status READY.
- Generalise `MatchLive`/`liveInfoFor` so a source is `STATION | DEVICE`. Keep the existing fields so the change stays backward compatible.

## Web (apps/web, manager) + admin
- **Profile → Devices** (`/manager/devices`): "Add iPhone" dialog (name) → key card with Copy + QR + the 3 setup steps.
  Each device card shows a Pill (Offline / Online / Streaming), last seen, battery, live thumbnail, and actions Watch, Show key, Regenerate key (confirm), Remove (confirm). Empty state: "Add your first iPhone to stream matches."
- **Device live page**: big HLS player (hls.js, native on Safari) and a "Using for match: …" picker.
- **Match Center**: "Live" panel, one step at a time:
  1. **Select device** (dropdown of the manager's iPhones with online pills). Then it shows "Waiting for the iPhone…" until the stream is up.
  2. **Preview** (badge "Only you can see this"), player, and the primary button **Start broadcast to teams**.
  3. **Live** (red "Live to teams" badge, timer), with **End broadcast** behind a confirm dialog.
  Secondary buttons in steps 2–3: **Capture team list**, **Capture results**. Toast on success, and the new screenshot appears in the existing list.
  No input/tap controls.
- **Admin**: a Devices table for all managers (read-only + revoke).
- **Admin health widget (speedometer gauges)** on the admin Dashboard:
  - **Server**: CPU % and RAM % as two semicircle gauges, with needle animation and colour bands green < 60 · warning < 85 · destructive.
    Under them: load average, used/total GB, live streams count, and ingest Mbps.
    API: `GET /api/admin/system/health` → `{cpuPct, memUsedBytes, memTotalBytes, load1, uptimeSec, liveStreams, ingestKbps, at}`.
    CPU % is computed from two `os.cpus()` samples, or `/proc/stat` deltas taken by a 2 s sampler in the API process (cached, never per request).
    MediaMTX `/v3/paths/list` gives `bytesReceived` deltas for the ingest figure. The widget polls every 3 s and pauses while the tab is hidden.
  - **Per device**: small CPU / memory gauges on each device card, for admin and manager. The phone reports `cpuPct` (its own process)
    and `memMB`. Memory is measured against the extension's 50 MB limit, so the gauge shows "how close to being killed by iOS".
  - The gauge is an app component (SVG arc + needle, theme tokens only), not added to `packages/ui`.
- Tours: `manager.devices`, `manager.deviceLive`.

## Infra
- Add a `mediamtx` service (`bluenviron/mediamtx`, pinned version) to docker-compose. Its config lives in `infra/mediamtx.yml`.
- EC2 security group: open **TCP 1935** (RTMP). HLS stays internal (`:8888`) behind the API, so Caddy needs no change.
- Upload per phone is about 1.2 / 2.5 / 4.5 Mbps (480p / 720p / 1080p). Viewer egress multiplies with each viewer, so default the viewer quality to the source and add a 720p transcode later if needed.
- Retention: recordings follow the existing `videoRetentionDays`.

## Milestones
0. ✅ **Devices** (2026-10-19): `Device` model, manager add/rename/show key/new key/remove, phone `hello` + `heartbeat`,
   web `/manager/devices` with live status (Offline / Online / Streaming) and phone health. Contract: `packages/shared/src/device.ts`.
0b. ✅ **Manager live view + QR** (2026-10-19): MediaMTX service `media` (deploy/media/mediamtx.yml, host network, RTMP :1935,
   HLS :8888 + API :9997 behind the API's credentials), `POST /api/device/stream/start|stop`, auth hook `/api/internal/media/auth`
   (HMAC publish token tied to the device key; new key / remove kicks the stream), HLS proxy `/api/manager/devices/:id/live/*`
   (owner only), `/manager/devices/:id` live page, pairing QR on cards (hidden until tapped) and in the key dialog.
   Production needs: `MEDIA_RTMP_URL=rtmp://airbattleground.com:1935/live` in the server `.env`, and TCP 1935 open in the EC2 security group.
1. **Contract + DB + device API + MediaMTX in compose**, testable with `ffmpeg -re -i test.mp4 -f flv rtmp://…` (no phone needed).
2. **Web Devices page + live player + Match Center capture.**
3. **iOS app** (separate agent, brief in `IOS_APP_BRIEF.md`). It can start in parallel against the contract.
4. Recording finalise + admin view + hardening (rate limits, revoke kicks the live stream via MediaMTX API `kick`).
5. Later: RTMPS/SRT, auto-capture by screen detection (reuse Phase 4 detector cues), WebRTC low-latency viewing.

## Risks
- iOS **must be built on a Mac with Xcode** and an Apple Developer account (TestFlight). This Linux box can't build it.
- The ReplayKit broadcast extension has about a **50 MB memory limit**, so it needs a hardware encoder and no big buffers. That limit is the main iOS risk.
- The broadcast can only be started by the user tapping the system picker. iOS shows a red status pill, and Control Center can stop it at any time.
- BGMI anti-cheat: screen broadcast is passive and common (streamers use it). Low risk, and there is no automation.
