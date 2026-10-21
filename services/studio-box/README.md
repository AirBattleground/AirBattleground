# 7XEN Studio Box

A PC at the venue that runs the whole show locally: the phones stream to it over the venue Wi-Fi, managers open the
Studio from it, and it sends the finished show straight to YouTube / stream keys. The AirBattleground website (AWS)
still keeps logins, matches, scores, branding, stream keys and the YouTube channel. Contract: `packages/shared/src/studioBox.ts`.

```
phones ──Wi-Fi──► BOX PC
                   ├─ MediaMTX (docker)          RTMP :1935 (LAN) · HLS 127.0.0.1:8888 · API 127.0.0.1:9997
                   ├─ studio-box (this package)  http://<lan-ip>:4300
                   │    /api/device/*   phone API (same as the website's phase-6 API)
                   │    /box/*          Studio API: phones, their HLS (same origin), media auth hook
                   │    /api/*          proxied to the website (cookies rewritten for the box)
                   │    /*              the web app build (apps/web/dist)
                   └─ studio-worker                headless Chrome renders the show from the box, ffmpeg sends it
                        └──► YouTube / stream keys / (optional) AWS for the Live page
```

The box **is** a Studio worker: one key from the website (Studio → Studio boxes) is used by both processes. Only the
worker talks to `/api/studio-worker/poll` — the box must not poll with the same key. Instead the worker (with
`BOX_URL` set) reads `GET /box/worker-info` from the box before every poll and sends it as `box`, which is how the
website knows the box's LAN address and phone counts.

## You need

- Node 24 + pnpm (this repo checked out), Google Chrome, ffmpeg 5.1+ (see `../studio-worker/README.md`)
- Docker (for MediaMTX)
- The PC on the venue network with a fixed LAN IP (DHCP reservation on the router), TCP 1935 and 4300 open in its firewall

## Set up

1. On the website: **Studio → Studio boxes → Add**, copy the key (shown once).
2. `cp services/studio-box/.env.example services/studio-box/.env` → `BOX_KEY=<key>`, `BOX_NAME=<what phones show>`.
3. `services/studio-worker/.env`:
   ```
   WORKER_KEY=<same key>
   BOX_URL=http://127.0.0.1:4300
   BOX_RTMP_BASE=rtmp://127.0.0.1:1935/live
   ```
   Leave `PUBLISH_RTMP_BASE` unset on a box (the copy for the Live page then goes straight to the website).
4. `pnpm install --filter @7xen/studio-box... --filter @7xen/studio-worker...`
5. Build the web app the box serves: `pnpm --filter @7xen/web build` (again after every update).
6. Media server: `docker compose -f services/studio-box/docker-compose.yml up -d`

## Run

```
pnpm --filter @7xen/studio-box start
pnpm --filter @7xen/studio-worker start
```

As services (systemd --user, starts at boot with `loginctl enable-linger $USER`):

```
cp services/studio-box/deploy/*.service ~/.config/systemd/user/   # fix paths inside if the repo isn't at ~/7xen
systemctl --user daemon-reload
systemctl --user enable --now 7xen-studio-box-media 7xen-studio-box 7xen-studio-box-worker
journalctl --user -u 7xen-studio-box -f
```

Open **http://&lt;lan-ip&gt;:4300** on any computer on the venue network and sign in as the manager (username +
password — Google sign-in only works on the website's own address). Add phones in the box's Devices screen: each one
gets a QR (`7xen://pair?host=http://<lan-ip>:4300&key=…&name=<box name>`) to scan in the 7XEN Stream app.

## Settings (.env)

| Variable | Default | What |
|---|---|---|
| `API_URL` | `https://airbattleground.com` | the website |
| `BOX_KEY` | | the box key (kept for website calls; the worker uses the same key) |
| `BOX_NAME` | host name | shown on the phones and in the Studio |
| `PORT` | `4300` | the box's HTTP port |
| `LAN_HOST` | first private IPv4 | address phones use for HTTP and RTMP |
| `LAN_URL` | `http://<LAN_HOST>:<PORT>` | full override, e.g. `http://studio-box.local:4300` |
| `MEDIA_RTMP_PORT` | `1935` | RTMP port given to the phones |
| `MEDIA_HLS_URL` | `http://127.0.0.1:8888` | MediaMTX HLS |
| `MEDIA_API_URL` | `http://127.0.0.1:9997` | MediaMTX control API |
| `WEB_DIST` | `../../apps/web/dist` | web app build |
| `DATA_DIR` | `./data` | `devices.json` (paired phones, key hashes only) + `secret` (generated once) |
| `MDNS` | on | `0` = don't advertise Bonjour |
| `BOX_DEV_NO_AUTH` | | `1` = skip the manager check on `/box/*`. **Development only** — ignored when `NODE_ENV=production` (the systemd unit sets it) |

On a dev machine the default media ports are taken by the dev media server: run MediaMTX with
`MEDIA_RTMP_PORT=1938 MEDIA_HLS_PORT=8891 MEDIA_API_PORT=9996 PORT=4301 docker compose -p 7xen-box-test -f services/studio-box/docker-compose.yml up -d`
and put the same ports in `.env`.

## How security works

- **Phones**: `X-Device-Key` (stored as sha256 in `devices.json`). `stream/start` hands out a 10-minute publish token
  (`dev_<id>?token=<exp>.<hmac>`) signed with a key derived from `data/secret` and tied to the phone's key hash, so
  removing a phone voids its tokens (and kicks its stream).
- **MediaMTX** asks `POST /box/media/auth` (accepted from 127.0.0.1 only) for every publish/read: phones publish
  `live/dev_<id>` with their token; `live/show_<id>` may be published only from this PC (the worker's preview copy);
  reads only from this PC or with the box's internal user/pass (derived from the secret).
- **Studio API** (`/box/devices…`, `/box/shows…`): the browser's cookies are sent to the website's
  `GET /api/auth/me`; only a MANAGER passes. The answer is cached per cookie for 60 s.
- `/box/info` is public (name, LAN URL, counts — the web app uses it to detect it's running on a box);
  `/box/worker-info` is 127.0.0.1 only.
- Session cookies from the website are rewritten for the box (no `Domain`, no `Secure`) because the box is plain
  http on the LAN. Keep the box on a trusted network.

## Box HTTP API

| | |
|---|---|
| `GET /box/info` | `BoxInfo` `{ name, lanUrl, devices, streaming }` |
| `GET /box/devices` | `{ items: BoxDevice[] }` |
| `POST /box/devices {name}` | 201 `{ device, key, pairUrl }` (key shown once) |
| `GET /box/devices/:id` · `PATCH {name}` · `DELETE` | `BoxDevice` · `BoxDevice` · 204 |
| `GET /box/devices/:id/live/<file>` | the phone's HLS (`index.m3u8` + files beside it), 404 when not streaming |
| `GET /box/devices/:id/snapshot.png` | (additive) full-quality screenshot from the phone, 504 if it doesn't answer in 5 s |
| `GET /box/shows/:showId/live/<file>` | (additive) the worker's local copy of the show (needs `BOX_RTMP_BASE`) |
| `GET /box/worker-info` | `BoxPollInfo` (127.0.0.1 only, for the worker) |
| `POST /box/media/auth` | MediaMTX auth hook (127.0.0.1 only) |

## Bonjour

The box advertises `_7xen-studio._tcp` (TXT `name=`, `api=`) using the OS tool: `avahi-publish-service`
(Linux, `sudo apt install avahi-utils`) or `dns-sd` (macOS, Windows with Bonjour). Without it phones pair by QR.

## Tests

`pnpm --filter @7xen/studio-box typecheck` · `pnpm --filter @7xen/studio-box test`
