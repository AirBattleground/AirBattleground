# Media server + Studio worker on the studio PC

The website, API and database stay on AWS. Phone streams, the media server and all Studio video work run on this PC;
AWS only forwards media traffic through an SSH tunnel.

```text
iPhone ─RTMP:1935─► AWS forwarder ═tunnel═► PC media server (:1937) ◄── Studio worker (publishes locally)
viewers ─► AWS API ─HLS :8888 forwarder ═tunnel═► PC media server (:8890)
AWS relays (YouTube / keys) ◄═tunnel═ PC media server
PC media server auth hook ─► 127.0.0.1:14000 ═tunnel═► AWS API (127.0.0.1:4000)
```

## On the PC

1. Media server: `docker-compose -p 7xen-pcmedia -f deploy/pcmedia/docker-compose.yml up -d`
2. Tunnel (auto-restarts): see the header of `7xen-tunnel.service`.
3. Worker: in `services/studio-worker/.env` set `WORKER_KEY` (Studio → Studio workers → Add worker),
   `API_URL=https://airbattleground.com` and `PUBLISH_RTMP_BASE=rtmp://127.0.0.1:1937/live`, then run it
   (`pnpm --filter @7xen/studio-worker start`, or as a service — see services/studio-worker/README.md).

## On AWS (switch-over)

Stop the AWS media server and put three forwarders on its ports, pointing at the tunnel's loopback ends:

```bash
sudo docker compose -f docker-compose.yml -f docker-compose.prod.yml stop media
for p in "1935 21935" "8888 28888" "9997 29997"; do set -- $p
  sudo docker run -d --name 7xen-fwd-$1 --restart unless-stopped --network host alpine/socat:1.8.0.0 \
    TCP-LISTEN:$1,fork,reuseaddr TCP:127.0.0.1:$2
done
```

Roll back (media back on AWS): `sudo docker rm -f 7xen-fwd-1935 7xen-fwd-8888 7xen-fwd-9997` then
`sudo docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d media`.

Note: a later `docker compose ... up -d` on AWS would start the AWS media server again and clash with the forwarders —
deploy with `up -d --build api web` (as usual), not a bare `up -d`.
