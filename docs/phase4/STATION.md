# 7XEN Station

The station PC runs an Android emulator that plays BGMI for a match. The station records the match to MP4 and
streams it live (HLS) to the manager, the admin and the teams playing in that match.
Contract: `packages/shared/src/station.ts`.

## Architecture

```
 browser ──/api/live/<match>/index.m3u8──▶ nginx (web, :80) ──▶ api container (:4000)
                                                                   │  reads STORAGE_DIR/live/<match>/*
                                                                   │  POST /sessions… (X-Station-Token)
                                                                   ▼
                                       host.docker.internal:4500  7XEN Station (host, systemd --user)
                                                                   │ adb / scrcpy / ffmpeg
                                                                   ▼
                                                    emulator-5554 (AVD bgmi14, window on DISPLAY :0)
```

- **services/station** is a Node 24 + TypeScript service run with tsx (`node --import tsx src/index.ts`). It runs on the
  **host**, not in Docker, because it needs `/dev/kvm`, the desktop display, adb, scrcpy and ffmpeg.
- **Capture pipeline.** `scrcpy --record=<fifo>.mkv` writes into a FIFO. `ffmpeg -c copy -f tee` reads it and writes two
  outputs with no re-encode:
  - a fragmented MP4 part in `STORAGE_DIR/station/sessions/<recordingId>/part-NNN.mp4`. It is crash-safe because
    every keyframe is a fragment.
  - HLS (`index.m3u8` plus `pN-xxxxx.ts`, about 1–2 s segments, last 6 kept) in `STORAGE_DIR/live/<matchId>/`.

  Capture runs at a maximum of 1280 px on the long side, 6 Mbps and 30 fps, with a keyframe about every 1 s
  (`i-frame-interval:float=0.5`).
- **Rotation.** scrcpy follows the display rotation. On a rotation it restarts its encoder, and the new size travels
  in-band in the stream. ffmpeg keeps going, so both the HLS stream and the MP4 carry the size change. This was tested
  on bgmi14 going landscape → portrait → landscape: the final MP4 decodes completely. If scrcpy or ffmpeg dies anyway
  (adb hiccup, encoder error), the pipeline restarts as a new part, up to `CAPTURE_MAX_RESTARTS`:
  - The HLS playlist is appended to (`append_list` adds `#EXT-X-DISCONTINUITY`).
  - On stop, the MP4 parts are joined with the ffmpeg concat demuxer.
- **Stop.** The station:
  1. sends SIGINT to scrcpy, so the Matroska stream is finalised;
  2. lets ffmpeg drain;
  3. adds `#EXT-X-ENDLIST`;
  4. joins and remuxes the part(s) into a faststart MP4 at `VIDEO_DIR/<videoKey>`;
  5. calls `POST /api/internal/station/recordings/:id/complete`.

  The API then runs the same ffmpeg duration and poster step as app uploads, and the recording goes
  PROCESSING → READY.
- **State machine** (one match at a time):
  - Normal path: `IDLE → STARTING_EMULATOR → LAUNCHING_BGMI → LIVE → STOPPING → IDLE`.
  - Any failure goes to `ERROR`.
  - A second match gets **409**.
  - If nothing could be recorded, the station calls `…/recordings/:id/fail` and the recording becomes FAILED.
  - If capture keeps dying mid-match, the station finalises what it has (READY) and shows `ERROR`.
- **Crash safety.**
  - Each session writes `session.json` (match, recording, video key, parts, child pids).
  - On start, the station kills leftover scrcpy/ffmpeg processes from those pids, finalises the parts and reports
    them to the API.
  - SIGTERM (systemctl stop/restart) finishes the active recording before exiting.
  - The emulator is started detached (logs in `storage/station/emulator.log`). It is reused when it's already running
    and never killed by the station.
- **Screenshots.**
  1. The station runs `adb exec-out screencap -p` and saves the PNG to `storage/station/captures/<match>/…png`.
  2. It POSTs the PNG to `/api/internal/station/matches/:id/screenshots` (multipart, source `STATION`), so it enters
     the normal reader pipeline.
  3. It returns `{ file }`. The API ingests the same file (deduplicated by hash) and returns the ScreenshotRow.
- **Input.** The viewer sends x/y as 0..1 fractions of the frame it sees. The station maps them to the current
  rotated ("logical") screen: rotation 1 means a 2280×1080 frame. This was verified on the AVD: a tap at (0.25, 0.75)
  in landscape landed at (570, 808), and (570, 809) was expected. `INPUT_COORDS=natural` exists for devices that want
  portrait-panel coordinates.
- **Live files.**
  - The API serves `live/<matchId>/index.m3u8` (`application/vnd.apple.mpegurl`, `no-store`) and `*.ts`
    (`video/mp2t`, `max-age=60`).
  - Files are served while the match's station recording is LIVE, and for 15 min after it ended.
  - Viewers allowed: the owner manager, the admin, and teams in the match (scrim: APPROVED registration with a slot;
    tournament: GroupTeam of the group). Other teams get 403, no session gets 401, a bad path or no stream gets 404.
  - The station deletes a match's live dir 10 min after its last write (`LIVE_KEEP_MIN`).

### API endpoints

All `/api/manager/...` endpoints are mirrored under `/api/admin/...`:

| Endpoint | Purpose |
| --- | --- |
| `GET /station` | StationStatus (`online:false` when unreachable, plus `matchTitle`) |
| `GET /matches/:id/live` | MatchLive |
| `POST /matches/:id/station/prepare` | Start the session. Body `{}` or `{ launchBgmi?, bitrateMbps?, maxFps? }` |
| `POST /matches/:id/station/stop` | Stop recording and streaming |
| `POST /matches/:id/station/capture` | `{ kind }` → ScreenshotRow (source STATION) |
| `POST /matches/:id/station/input` | StationInput → 204 |
| `GET /api/team/live` | TeamLiveCard[] (includes `tournamentId`) |
| `GET /api/live/:matchId/index.m3u8`, `/:segment.ts` | HLS for viewers |
| `POST /api/internal/station/...` | Hooks: `complete`, `fail`, `screenshots` (X-Station-Token) |

`LiveMatchCard` gains `live: { streaming, hlsUrl, startedAt } | null`.

## Install / run

Prerequisites: AVD `bgmi14` with BGMI installed, and `pnpm install` done in the repo.

```bash
# station as a systemd --user service (no sudo). Creates services/station/.env with a token if missing,
# writes the same STATION_TOKEN into <repo>/.env (read by docker compose), enables + starts the unit.
bash scripts/station-install.sh
bash scripts/station-status.sh               # GET /health with the token
journalctl --user -u 7xen-station -f          # logs
systemctl --user restart 7xen-station         # finishes an active recording first
loginctl enable-linger "$USER"                # optional: keep running while logged out
bash scripts/station-install.sh --uninstall

# API container picks up STATION_URL/STATION_TOKEN + host.docker.internal
docker-compose --profile full build api web
docker-compose --profile full up -d api web

# development: station in the foreground + dev API (apps/api/.env has STATION_URL/STATION_TOKEN)
bash scripts/station-dev.sh
pnpm dev:api
```

## Environment (services/station/.env; see .env.example)

| var | default | |
| --- | --- | --- |
| `STATION_TOKEN` | (required, ≥16 chars) | Same value in `<repo>/.env` (compose) and `apps/api/.env` (dev). |
| `STATION_PORT` / `STATION_HOST` | `4500` / `0.0.0.0` | Address the station listens on. |
| `API_URL` | `http://127.0.0.1:4000` | Where the hooks go. |
| `STORAGE_DIR` / `VIDEO_DIR` | `<repo>/storage` / `STORAGE_DIR/videos` | Must be the folders the API container mounts at `/data/storage`. |
| `ADB`, `SCRCPY`, `SCRCPY_SERVER_PATH`, `FFMPEG`, `ANDROID_HOME`, `ANDROID_AVD_HOME`, `AVD_NAME`, `DISPLAY`, `EMULATOR_ARGS`, `ADB_SERIAL` | under `~/.local/share/7xen-android` | Android tools and emulator settings. |
| `CAPTURE_MAX_SIZE`, `CAPTURE_BITRATE_MBPS`, `CAPTURE_MAX_FPS` | `1280`, `6`, `30` | Capture size and quality. |
| `HLS_TIME`, `HLS_LIST_SIZE`, `LIVE_KEEP_MIN` | `2`, `6`, `10` | HLS segment length, playlist length, how long live files are kept. |
| `INPUT_COORDS` | `logical` | Coordinate system for remote input. |
| `CAPTURE_MAX_RESTARTS` | `5` | Capture restarts allowed per match. |
| `EMULATOR_BOOT_TIMEOUT_SEC` | `240` | How long to wait for the emulator to boot. |

API side: `STATION_URL` (default `http://127.0.0.1:4500`; compose uses `http://host.docker.internal:4500`) and
`STATION_TOKEN` (empty disables the station: prepare → 503, hooks → 401).

## Security

- The station binds to `0.0.0.0` so the API container can reach it through `host.docker.internal` (the docker
  bridge). Every route requires `X-Station-Token`, compared in constant time. Port 4500 can still be reached from the
  LAN, so block it if you like: `sudo ufw deny in on <lan-if> to any port 4500`.
- The internal API hooks (`/api/internal/station/*`) require the same token. They are reachable through nginx's `/api/`
  like everything else, but useless without the token.
- Browsers never talk to the station. HLS is served by the API with normal session auth (cookie or bearer).
- Paths exchanged between the API and the station are relative and validated: match ids `[A-Za-z0-9_-]`, video keys
  `YYYY/MM/<id>.mp4`, capture files under `station/captures/`. Live file names must match `index.m3u8` or `*.ts`.
- `.env`, `services/station/.env` and `apps/api/.env` are gitignored and have mode 600.

## Limits

- **One match at a time** per station PC; a second prepare gets 409.
- **Emulator performance.**
  - The AVD's H.264 encoder runs in software inside the emulator, which is why capture is limited to 1280 px by default.
  - A static screen produces no new frames, so HLS segments only advance while something moves on screen (BGMI always
    animates). On a still home screen the first playlist can take a while to appear; players should retry on 404.
  - Latency is about 4–8 s (2 s segments, 6 in the list).
- **BGMI on an emulator.** Krafton's anti-cheat can detect emulators and may refuse to run or ban the account. Use a
  dedicated account. This is a known, accepted risk.
- **BGMI GPU crash (fixed).** With plain `-gpu host`, BGMI crashed after ~20 s with a native SIGSEGV in
  `libEGL_emulation.so createNativeSync` (from `eglSwapBuffers`). Disabling the emulator's async swap fixes it:
  `EMULATOR_ARGS=-gpu host -feature -GLAsyncSwap -no-boot-anim -no-snapshot-save` (now the default). If an emulator
  was started by hand without that flag, stop it (`adb emu kill`); the station starts it correctly on the next Prepare.
- Mid-stream resolution changes (rotation) play fine in hls.js and Safari and decode completely with ffmpeg. Some
  desktop players show a brief glitch at the switch.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Web says "The 7XEN Station PC isn't running" | Run `systemctl --user status 7xen-station`. Check that the API container has `STATION_TOKEN` (`docker exec 7xen-api env \| grep STATION`) and that it matches `services/station/.env`. A mismatch shows as "token mismatch" in the station status error. |
| Prepare → ERROR "scrcpy could not start" | Run `adb devices`. Check the emulator is booted and that `SCRCPY_SERVER_PATH` matches the scrcpy version (5.0.1). |
| Emulator never starts | Check `storage/station/emulator.log`, that `DISPLAY` is set (`systemctl --user show-environment`), and that `/dev/kvm` is accessible. |
| Playlist 404 for a long time | The screen is static (no frames) or the capture failed: check `journalctl --user -u 7xen-station`. |
| Recording stuck LIVE after a station crash | Restart the station: it recovers `storage/station/sessions/*`. The manager's Stop also marks a lost recording FAILED. |
| Taps land in the wrong place | Check `status.rotation`. Set `INPUT_COORDS=natural` only if the device wants panel coordinates. Turn on Settings → pointer location to see where taps land. |
| ffprobe/ffmpeg segfaults reading `.ts` on the host | The static ffmpeg 7.0.2 in `~/.local/bin` crashes when demuxing MPEG-TS. The station only *writes* TS, so it's unaffected. To inspect segments, use the api image: `docker run --rm -v $PWD/storage:/s --entrypoint ffprobe 7xen-api:latest /s/live/<id>/p0-00000.ts`. |
