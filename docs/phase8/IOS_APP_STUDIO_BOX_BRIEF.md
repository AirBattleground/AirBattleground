# Brief for the iOS agent: "7XEN Stream" v2, streaming to a local Studio Box

This brief is the **delta** on top of `docs/phase6/IOS_APP_BRIEF.md` (read that first; everything there still applies unless
this file changes it). Work in `apps/ios/`. The web/server side is being built in parallel by other agents; this file is the
contract between you.

## Why this change

Until now the phone streamed over the internet to the AirBattleground server (AWS). From now on a **Studio Box**, a PC at the
venue, runs the phone pairing, the media server and the Studio that produces the show. The phone streams to the box over the
**venue Wi-Fi**. The box then sends the finished show to YouTube and other platforms. The phone never talks to AWS in this mode.

```text
iPhone/iPad ──Wi-Fi──► Studio Box (same LAN): device API (HTTP) + media server (RTMP)
                           └──► YouTube / AirBattleground / other platforms (internet)
```

## 1. Pairing with a box (the main change)

- The box shows a QR with the same scheme as before: `7xen://pair?host=<base URL>&key=<device key>&name=<box name>`
  - `host` is a full base URL that is now usually **plain HTTP on the local network with a port**, e.g.
    `http://192.168.1.20:4300` or `http://studio-box.local:4300`. Treat `host` as opaque: store it exactly, and build every API URL as
    `<host>/api/...`. Don't force `https://`, don't strip the port, and don't assume a domain name.
  - `name` (new, optional) is the box's display name, e.g. "Opus Studio". Show it: "Connected to **Opus Studio** · Device *iPad 1*".
- The manual Connect screen keeps a Server field, now labelled **Studio address**. Its placeholder is `http://192.168.1.20:4300`, and
  there's no default value any more.
- **App Transport Security:** add `NSAppTransportSecurity → NSAllowsLocalNetworking = YES` to **both** targets. It allows plain HTTP to
  local IPs and `.local` hosts, while HTTPS stays required everywhere else. Don't use `NSAllowsArbitraryLoads`.
- **Local Network permission (iOS 14+):** add `NSLocalNetworkUsageDescription` = "7XEN Stream sends your screen to the Studio PC on this
  Wi-Fi." Trigger the prompt early, on the Connect screen (a quick request to `host` does it), so it doesn't pop up in the middle of a broadcast.
  If permission is denied, show: "Allow Local Network for 7XEN Stream in Settings → Privacy → Local Network."
- **Discovery (nice to have, after everything else works):** the box advertises Bonjour `_7xen-studio._tcp` with TXT `name=<box name>`,
  `api=<base URL>`. If you add it, show "Studios on this Wi-Fi" with a list to tap, plus `NSBonjourServices = ["_7xen-studio._tcp"]`.
  Pairing still needs the key, from the QR or pasted.
- One box at a time. **Disconnect** forgets the host and key; scanning another box's QR replaces them.

## 2. Same device API, served by the box

The box answers the **same five endpoints with the same bodies** as the phase-6 contract (`hello`, `stream/start`, `heartbeat`,
`snapshots/:requestId`, `stream/stop`, all under `<host>/api/device/...`, header `X-Device-Key`). Differences:

- `stream/start` returns the box's RTMP address, e.g. `{ rtmpUrl: "rtmp://192.168.1.20:1935/live", streamName: "dev_<id>?token=<t>", ... }`.
  Use it as given, as you do today.
- `hello` gains an optional `studio: { name: string }` (the box name). Ignore it if it's missing.
- Errors keep the same shape. On a **network error** (box unreachable), show: "Can't reach the studio at <host>. Make sure this phone is
  on the venue Wi-Fi and the Studio PC is on." Don't clear the key on network errors, only on `401`.
- If the phone is on cellular and `host` is a local address, say so: "You're on mobile data. Join the venue Wi-Fi to stream to the studio."

## 3. Audio: currently broken, must be fixed

The server logs show every phone stream so far arrived **video only** ("1 track (H264)"). Viewers hear nothing.

- In `processSampleBuffer`, for `.audioApp`, append the buffer to the RTMP stream (AAC, 48 kHz stereo, ~128 kbps). Keep ignoring `.audioMic`.
- **Configure the audio track before `publish()`.** The media server fixes the track list when publishing starts. If the first audio
  buffer arrives after that (BGMI is silent at first), the stream stays video-only for the whole session.
  - If HaishinKit can't announce audio without samples, feed **silent AAC frames** from the start until real `.audioApp` buffers arrive.
- Done when the box's media server logs `2 tracks (H264, MPEG-4 Audio)` for a phone stream, and game sound is heard in the Studio.

## 4. Frame rate: 60 fps option

Smooth gameplay matters more than resolution. On a local Wi-Fi the bandwidth is there.

- Add **Frame rate: 30 · 60** under Video quality (default **60**), saved in the App Group like quality and locked while streaming.
- Bitrates (16:9 upright, hardware H.264, keyframe every 2 s):

  | Quality | 30 fps | 60 fps |
  |---|---|---|
  | 480p (854×480) | 1.2 Mbps | 2.0 Mbps |
  | 720p (1280×720) | 2.5 Mbps | 4.0 Mbps |
  | 1080p (1920×1080) | 4.5 Mbps | 7.0 Mbps |

- ReplayKit may deliver fewer than 60 frames. Send what arrives; don't duplicate frames. Report the real rate in the heartbeat `fps`.
- `stream/start` body gains an optional `fps: 30 | 60`, so the box knows what to expect. Send it.
- Auto step-down (thermal / upload behind) now goes **60 → 30 fps first**, then down in resolution. Report it as `autoDowngraded: true`.

## 5. Unchanged (keep working)

- Snapshots: native-resolution PNG on request, within 5 s, to `<host>/api/device/snapshots/:id`.
- Heartbeats every 2 s from the extension and 15 s from the app (with the "broadcasting" flag); reconnect with backoff; memory under ~50 MB.
- Keys stay in the shared Keychain only, masked in the UI.
- Still works against a cloud host (`https://…`) if a QR ever points there.

## Testing without the real box

- Media server: `docker run --rm -p 1935:1935 -p 8888:8888 bluenviron/mediamtx:1.9.3`, then check its log for `2 tracks (H264, MPEG-4 Audio)`.
- Mock the five endpoints on a Mac on the same Wi-Fi (any tiny HTTP server), with `rtmpUrl` pointing at the Mac's LAN IP. Make a QR
  for `7xen://pair?host=http://<mac-ip>:4300&key=test&name=Test%20Studio`.
- Test: denied Local Network permission, phone on cellular, box switched off mid-stream (it must reconnect when the box is back), 60 fps on an
  older iPhone (watch thermal), and a 30-minute broadcast.

## Done when

1. Scanning the box's QR pairs the phone, and the screen shows "Connected to <box name>".
2. Start streaming sends BGMI at 60 fps **with game audio** to the box over Wi-Fi.
3. Snapshots work, and a Wi-Fi drop of 30 s reconnects by itself.
4. Plain HTTP works only to local hosts (ATS local networking); public hosts still need HTTPS.
5. README updated: pairing with a Studio Box, the Local Network permission, and 60 fps notes.

## Contract summary (what the box guarantees you)

| Call | Change vs. phase 6 |
|---|---|
| QR `7xen://pair?host&key&name` | `host` may be `http://<lan-ip>:<port>`; `name` added |
| `POST /api/device/hello` | response may include `studio: { name }` |
| `POST /api/device/stream/start` | body may include `fps: 30\|60`; `rtmpUrl` is the box's LAN RTMP |
| `POST /api/device/heartbeat` | unchanged (report real `fps`) |
| `POST /api/device/snapshots/:id` | unchanged |
| `POST /api/device/stream/stop` | unchanged |
