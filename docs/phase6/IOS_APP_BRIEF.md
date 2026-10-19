# Brief for the iOS agent — "7XEN Stream" (iPhone, view-only screen streaming)

You are building a **native iOS app** (Swift 5.10+, SwiftUI, iOS 16+) that streams the iPhone's full screen,
which is usually the game BGMI in landscape, to the 7xen server. The app **never** receives remote-control commands.
It only sends video, health heartbeats, and full-quality still images when the server asks for one.
Full system plan: `docs/phase6/IPHONE_STREAMING.md`.

## Where
- New folder `apps/ios/` with an Xcode project `7XENStream.xcodeproj`. It is **not** part of the pnpm workspace, so don't touch package.json files.
- Two targets: **App** (`com.airbattleground.stream`) and **Broadcast Upload Extension**
  (`com.airbattleground.stream.broadcast`). Shared **App Group** `group.com.airbattleground.stream` plus a shared Keychain access group.
- Dependency (SPM, pinned exact version): **HaishinKit** for RTMP publishing from the extension. Nothing else unless it's essential.
- Must build on macOS + Xcode 16. Ship through TestFlight. Write `apps/ios/README.md` with build, signing, and TestFlight steps for the owner.

## User experience (non-technical users: big text, plain words)
1. **First launch → "Connect to 7xen"**: Server field (default `https://airbattleground.com`), Security key field
   (paste, or **Scan QR**, where the QR holds `7xen://pair?host=…&key=…`). Button **Connect**.
   It calls `hello`. On success it shows "Connected as *Yogi* · Device *iPhone 1*". On 401 it shows "This key doesn't work. Copy it again from your 7xen profile → Devices."
2. **Home**: a big status (Not streaming / **Preview: only your manager can see** / **Live to teams** with a timer, taken from
   `assignedMatch.broadcast`), the match it is assigned to if any ("Streaming for: Evening Scrim · Match 2"),
   and one primary button **Start streaming**, which is an `RPSystemBroadcastPickerView` with `preferredExtension` set to our extension and the mic hidden.
   Show a 3-step hint: "Tap Start → choose 7XEN Stream → Start Broadcast, then open BGMI."
   Above the button there is a **Video quality** segmented control: **480p · 720p · 1080p** (default 720p), with a one-line hint under it
   ("Lower quality uses less data and battery"). The choice is saved in the App Group and read by the extension when the broadcast starts.
   It is locked while streaming, with the hint "Stop streaming to change quality".
   Small text: "Your screen is shared with your 7xen manager. Nobody can control your phone." Also a **Disconnect** link in settings.
3. Stop works from the app button (the same picker) or the iOS red status pill / Control Center.

## Broadcast extension (`SampleHandler: RPBroadcastSampleHandler`), which does the real work
- `broadcastStarted`: read host + key from the shared Keychain. Read the chosen quality from the App Group. Call `POST /api/device/stream/start` with it and get the RTMP URL and stream name.
  Connect HaishinKit `RTMPConnection`/`RTMPStream` and publish. If the call fails, `finishBroadcastWithError` with a readable message
  (for example "Not connected to 7xen. Open the 7XEN Stream app first.").
- `processSampleBuffer(.video)`: append to the stream. Apply the **orientation** from `RPVideoSampleOrientationKey`,
  because BGMI is landscape and the output must be upright 16:9. Keep a reference to **only the latest** pixel buffer, for snapshots.
- `.audioApp`: send game audio (AAC). Ignore `.audioMic`.
- Encoder: hardware H.264 (VideoToolbox through HaishinKit), 30 fps, keyframe every 2 s, using the **quality chosen in the app**:

  | Quality | Size (16:9, upright) | Video bitrate |
  |---|---|---|
  | 480p | 854×480 | 1.2 Mbps |
  | 720p | 1280×720 | 2.5 Mbps |
  | 1080p | 1920×1080 | 4.5 Mbps |

  If `ProcessInfo.thermalState >= .serious` or the upload falls behind for more than 10 s, step down one level (1080p → 720p → 480p) and report it
  as `autoDowngraded: true`. Never step back up during a broadcast.
- Snapshots for OCR are **always native-resolution PNGs**, whatever the stream quality, so 480p streaming never hurts result reading.
- **Memory limit ≈ 50 MB.** Don't copy frames, don't queue more than a few buffers, and don't use UIKit or SwiftUI in the extension. Profile it with Instruments.
- **Heartbeat** every 2 s (a `DispatchSourceTimer`). The reply can contain `snapshotRequests`. For each one, take the latest pixel buffer,
  rotate it upright, encode a **PNG at native resolution**, and `POST /api/device/snapshots/:requestId`. This must work within 5 s,
  because these images are read by OCR, so never downscale or JPEG them.
- Reconnect: if RTMP drops, retry with backoff (1, 2, 4, 8 s, max 15 s). On every retry call `stream/start` again for a fresh token.
  After 2 minutes of failure, `finishBroadcastWithError`.
- `broadcastFinished`: `POST /api/device/stream/stop` (best effort), then close RTMP.
- The main app also sends a heartbeat every 15 s while it's in the foreground, so the manager sees the phone online before the stream starts.
  It must send `state: "LIVE"` (not IDLE) while the broadcast extension is running: read a "broadcasting" flag the extension
  writes to the App Group. (The server now trusts the video server over this field, but wrong IDLE reports still confuse the timer.)

## Server contract (JSON, all under `<host>/api`)
Every device call sends the header `X-Device-Key: <key>`. Errors look like `{ "error": { "code", "message" } }`.
Show `message` to the user as-is. `401 DEVICE_KEY_INVALID` → clear the stored key and go back to the Connect screen.

| Call | Body | Response |
|---|---|---|
| `POST /device/hello` | `{ deviceModel, osVersion, appVersion }` | `{ device: { id, name }, manager: { name }, assignedMatch: { id, title, broadcast: "PREVIEW"\|"LIVE" } \| null }` |
| `POST /device/stream/start` | `{ quality: "480p"\|"720p"\|"1080p" }` | `{ rtmpUrl: "rtmp://host:1935/live", streamName: "dev_<id>?token=<t>", expiresAt }` (token single-use, 10 min) |
| `POST /device/heartbeat` | `{ state: "IDLE"\|"LIVE", quality, autoDowngraded, battery: 0–1, charging, thermal: "nominal"\|"fair"\|"serious"\|"critical", cpuPct, memMB, fps, bitrateKbps, width, height, network: "wifi"\|"cellular" }` | `{ assignedMatch \| null, snapshotRequests: [{ id }] }` |
| `POST /device/snapshots/:requestId` | `multipart/form-data`, field `image` (PNG) | `204` |
| `POST /device/stream/stop` | `{ reason?: string }` | `204` |

- `cpuPct`: CPU use of the extension process (sum `thread_basic_info.cpu_usage` across `task_threads`, as a percentage).
  `memMB`: `task_vm_info.phys_footprint` / 1 MB. The admin shows these as speedometer gauges, where memory is measured against the 50 MB limit.
- Until the backend is ready, test with a local MediaMTX (`docker run --rm -p 1935:1935 -p 8888:8888 bluenviron/mediamtx`) and a small mock of these 5 endpoints.

- Who can watch (manager only vs. teams) is decided **entirely by the server**. The app streams the same way in both states and only
  shows the label. The phone may stream with no match assigned, and then only the manager sees it on the Devices page.

## Security
- Store the key **only in Keychain** (shared group), never in UserDefaults or logs. Mask it in the UI (`7xk_abcd••••`).
- Use HTTPS for the API (ATS stays on). RTMP is plain in v1. That is acceptable because the publish token is short-lived and single-use. Keep the code ready for `rtmps://`.
- No analytics SDKs and no third-party network calls.

## Done when
- A fresh install pairs with a key (pasted or from QR), starts the broadcast, and BGMI plays on the manager's 7xen page with less than 5 s delay. It runs 30 minutes without being killed, peak extension memory stays under 40 MB, and snapshots come back sharp at native resolution.
- Killing the network for 30 s reconnects automatically. Regenerating the key on the web stops the phone with a clear message.
- README covers signing, App Group setup, TestFlight upload, and the known limits (Mac required, red status pill, iOS can stop the broadcast).
