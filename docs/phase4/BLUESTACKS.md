# BlueStacks on a Mac (stream API backend)

BGMI runs well in BlueStacks on a Mac. A small server on that Mac streams the BlueStacks window as H.264 and takes touch,
keys and text over Wi-Fi. The 7XEN Station uses it instead of adb/scrcpy: the manager starts the emulator from the
Match Center, watches and plays it with low latency, then presses **Start match**, which records everything and
streams it to the teams.

Set `BLUESTACKS_URL` and `BLUESTACKS_TOKEN` in `services/station/.env` and restart the station
(`systemctl --user restart 7xen-station`). Without them the station behaves as before (local AVD / `REMOTE_DEVICE`).
Contract: the "BlueStacks device control" section of `packages/shared/src/station.ts`.

## Flow in the Match Center

1. **Start emulator** → `POST …/station/device/start` → station `POST /api/launch {target:"game"}` on the Mac, polls the
   job until it is done, makes sure the stream is on (`/api/start`, `/api/mode control`).
2. **Watch + control.** The browser opens a WebSocket `GET /api/manager/matches/:id/station/stream`. It is proxied
   API → station → Mac (`ws`), and is the Mac's own protocol (H.264 Annex-B frames, touch `[0,…]`, keyframe `[2]`,
   key `[3,…]`, text `[4,…]`). The page is plain http on the LAN, so it decodes with MSE (jmuxer), not WebCodecs.
   Only the owner of the match (or an admin) may connect, and only while the station is idle or running that match.
3. **Start match** → `POST …/station/prepare`. The station starts a recording pipeline on the *same* upstream stream:
   FrameSource → FIFO → `ffmpeg -f h264 -use_wallclock_as_timestamps 1 -c copy -f tee` → fragmented MP4 part +
   HLS in `storage/live/<match>/` (teams watch the HLS). If BGMI is already running it is not relaunched.
4. **End match** → `POST …/station/stop`: the recording is finalised and reported to the API (→ Recordings). The emulator
   keeps running, so the next match starts instantly.
5. **Shut down emulator** → `POST …/station/device/stop` (refused while a match is recording) → `/api/quit {target}`.

## Pieces (services/station/src)

| file | role |
| --- | --- |
| `bluestacks.ts` | `BsClient` (REST), `BsLink` (ONE shared upstream WebSocket, ref-counted, auto-reconnect), `BlueStacksDevice` (the `Device` the state machine uses), `makeEnsureBlueStacks`, `BlueStacksControl` (independent start/stop) |
| `frameSource.ts` | writes the stream into the capture FIFO; looks like a child process so `CapturePipeline` (restart/parts/finalise) is reused unchanged |
| `server.ts` | `POST /device/start`, `POST /device/stop`, `GET /device/stream` (WebSocket relay + input filter) |
| `apps/api/src/lib/stationStream.ts` | authenticates the browser (cookie/bearer, role, match ownership, Origin) and proxies to the station |

Notes:
- The upstream stream is in the Mac's **control** mode (30 fps, short buffer) and is what gets recorded; the 60 fps `video`
  mode is not used because touch is only accepted in control mode.
- Screenshots (team list / results) decode the latest keyframe with ffmpeg; there is no screenshot endpoint on the Mac.
- Enter/Delete/text only exist on the WebSocket; Back/Home/Recents and taps use `/api/touch`.
- Reverse proxy: `deploy/nginx/spa.conf.template` has a WebSocket location for the stream path. Rebuild/restart the web image.
- Security: the Mac token gives full control of the game. It lives only in `services/station/.env` (mode 600); browsers
  never see it. The API ↔ station hop uses the existing `X-Station-Token`.
- `tests/bluestacks.test.ts` runs the station against a fake Mac (REST + WebSocket sending real x264 video) and checks the
  resulting MP4/HLS, the relay, input and the full device → match → stop flow.
