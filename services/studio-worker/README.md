# 7XEN Studio worker

Runs a Studio show on **your own computer** instead of in a browser tab. The worker checks the website every
2 seconds; when you start a show "on this worker" in Studio, it opens the show in a hidden Google Chrome window,
encodes it with ffmpeg (using your graphics card when it can) and sends it to the site, which passes it on to
the Live page, YouTube and your stream keys. Closing the Studio console doesn't stop the show — only **End show** does.

## You need

- **Node 24** and **pnpm** (this repo), or just Node 24 with the folder installed
- **Google Chrome** (the real one, not Chromium — it needs H.264 to play the phone feeds)
- **ffmpeg 5.1 or newer**. For a graphics-card encoder it must be built with it:
  NVIDIA → `h264_nvenc`, Intel → `h264_qsv`, AMD (Windows) → `h264_amf`, Mac → `h264_videotoolbox`.
  Without one it uses the CPU (`libx264`), which works but needs a strong CPU (about 2 cores for ffmpeg + 3 for Chrome at 720p60).

The worker tries the encoders in that order at start-up and prints the one it picked.

## Set up

1. On the website: **Studio → Studio workers → Add worker**, give it a name, copy the key (shown once).
2. In this folder: `cp .env.example .env` and paste the key into `WORKER_KEY=`.
3. From the repo root: `pnpm install --filter @7xen/studio-worker...`

Optional settings in `.env`:

| Variable | Default | What |
|---|---|---|
| `API_URL` | `https://airbattleground.com` | the website |
| `FFMPEG_PATH` | `ffmpeg` | path to ffmpeg |
| `CHROME_PATH` | (installed Google Chrome) | path to Chrome |
| `ENCODER` | (detected) | force one, e.g. `libx264` |
| `CHROME_ARGS` | | extra Chrome flags |
| `LOG_LEVEL` | `info` | `debug` for more |
| `PUBLISH_RTMP_BASE` | | publish the show to this RTMP base instead of the job's host (media server on this PC) |
| `LOCAL_HLS_BASE` | | read the phone feeds from a media server on this PC |
| `BOX_URL` | | **Studio Box**: the box on this PC, e.g. `http://127.0.0.1:4300` — reported to the website in every poll |
| `BOX_RTMP_BASE` | | **Studio Box**: the box's media server, e.g. `rtmp://127.0.0.1:1935/live` — a preview copy of the show goes there |

### On a Studio Box (phase 8c)

See `services/studio-box/README.md`. With `BOX_URL` set the worker reads `BOX_URL/box/worker-info` before each poll
and sends it as `box` (the box never polls the website itself). For a box job the website sends `outputs` (stream keys,
site-YouTube ingest) and `sendToAws`; ffmpeg then publishes to all of them at once with the tee muxer
(`onfail=ignore`: one dead destination doesn't stop the others — it is reported as the worker's error), plus
`publishUrl` when `sendToAws`, plus a copy to `BOX_RTMP_BASE`. With no destinations at all the show is still encoded
(published to `BOX_RTMP_BASE`, or `PUBLISH_RTMP_BASE`, or nowhere). Jobs without `outputs` work exactly as before.

## Run

```
pnpm --filter @7xen/studio-worker start
```

Leave it running. In Studio the worker shows as **online**; pick it when you start a show. Ctrl+C stops it (and any show it runs).

Checks without the website: `pnpm --filter @7xen/studio-worker smoke` (renders a test page into `smoke-out/test.flv`
and prints fps, CPU and ffprobe), `... e2e` (fake website + local RTMP), `... test` (unit tests).

## Run it as a service (starts with the computer)

### Linux (systemd)

`/etc/systemd/system/7xen-studio-worker.service`:

```ini
[Unit]
Description=7XEN Studio worker
After=network-online.target
Wants=network-online.target

[Service]
User=ec2-user
WorkingDirectory=/opt/7xen/services/studio-worker
ExecStart=/usr/bin/node --env-file-if-exists=.env --import tsx src/index.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```
sudo systemctl daemon-reload && sudo systemctl enable --now 7xen-studio-worker
journalctl -u 7xen-studio-worker -f
```

Amazon Linux 2023: install Chrome with `sudo dnf install -y https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm`
and a static ffmpeg build (CPU-only on a c7i; it uses `libx264`).

### Windows

Easiest: [NSSM](https://nssm.cc) — in an admin prompt:

```
nssm install 7xenStudioWorker "C:\Program Files\nodejs\node.exe" "--env-file-if-exists=.env --import tsx src/index.ts"
nssm set 7xenStudioWorker AppDirectory C:\7xen\services\studio-worker
nssm start 7xenStudioWorker
```

Or Task Scheduler: new task → "At log on" → action `node.exe` with the same arguments and "Start in" set to the
folder → tick "Restart if the task fails".

### macOS (launchd)

`~/Library/LaunchAgents/com.7xen.studio-worker.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.7xen.studio-worker</string>
  <key>WorkingDirectory</key><string>/Users/you/7xen/services/studio-worker</string>
  <key>ProgramArguments</key><array>
    <string>/opt/homebrew/bin/node</string><string>--env-file-if-exists=.env</string>
    <string>--import</string><string>tsx</string><string>src/index.ts</string>
  </array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/7xen-studio-worker.log</string>
  <key>StandardErrorPath</key><string>/tmp/7xen-studio-worker.log</string>
</dict></plist>
```

`launchctl load ~/Library/LaunchAgents/com.7xen.studio-worker.plist`

## How it behaves

- No show → idle. Show started → Chrome + ffmpeg start; "live" once video reaches the site.
- No video from the page for 10 s, or Chrome/ffmpeg dies → both restart together; repeated failures wait 2, 4, 8 … 30 s.
- Website unreachable → the show keeps going; after 60 s without the website it stops.
- "Unknown worker key" → the key is wrong or the worker was deleted; copy a new one from Studio → Studio workers.
