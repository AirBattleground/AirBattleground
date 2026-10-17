#!/usr/bin/env bash
# Install the 7XEN Station as a systemd --user service (no sudo needed).
#   bash scripts/station-install.sh            install/update + (re)start
#   bash scripts/station-install.sh --uninstall
# Optional (keeps the service running while you're logged out; needs polkit/sudo on some systems):
#   loginctl enable-linger "$USER"
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/7xen-station.service"

if [[ "${1:-}" == "--uninstall" ]]; then
  systemctl --user disable --now 7xen-station.service 2>/dev/null || true
  rm -f "$UNIT"
  systemctl --user daemon-reload
  echo "7xen-station removed (services/station/.env kept)."
  exit 0
fi

NODE="$(command -v node || true)"
[[ -n "$NODE" ]] || { echo "node not found in PATH (Node 24 is required)" >&2; exit 1; }
NODE="$(readlink -f "$NODE")"
"$NODE" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || { echo "Node >= 22 required ($NODE)" >&2; exit 1; }
[[ -f "$REPO/services/station/node_modules/tsx/dist/cli.mjs" ]] || { echo "Run 'pnpm install' in $REPO first" >&2; exit 1; }

# config with a random token on first install; the same token must be in <repo>/.env for docker compose
ENV_FILE="$REPO/services/station/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  TOKEN="$(openssl rand -hex 32)"
  sed "s/^STATION_TOKEN=$/STATION_TOKEN=$TOKEN/" "$REPO/services/station/.env.example" > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Created $ENV_FILE with a new STATION_TOKEN."
fi
TOKEN="$(grep -E '^STATION_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
[[ ${#TOKEN} -ge 16 ]] || { echo "STATION_TOKEN in $ENV_FILE is missing/too short" >&2; exit 1; }
ROOT_ENV="$REPO/.env"
if ! grep -qs "^STATION_TOKEN=$TOKEN\$" "$ROOT_ENV"; then
  touch "$ROOT_ENV"; chmod 600 "$ROOT_ENV"
  grep -v '^STATION_TOKEN=' "$ROOT_ENV" > "$ROOT_ENV.tmp" || true
  echo "STATION_TOKEN=$TOKEN" >> "$ROOT_ENV.tmp"
  mv "$ROOT_ENV.tmp" "$ROOT_ENV"
  echo "Wrote STATION_TOKEN to $ROOT_ENV (docker compose) — recreate the api container to pick it up."
fi

mkdir -p "$UNIT_DIR" "$REPO/storage/live" "$REPO/storage/videos"
sed -e "s#@REPO@#$REPO#g" -e "s#@NODE_DIR@#$(dirname "$NODE")#g" -e "s#@NODE@#$NODE#g" "$REPO/deploy/station/7xen-station.service" > "$UNIT"
systemctl --user daemon-reload
systemctl --user enable 7xen-station.service >/dev/null
systemctl --user restart 7xen-station.service
sleep 2
systemctl --user --no-pager --lines=5 status 7xen-station.service || true
echo
echo "Installed $UNIT"
echo "Logs:   journalctl --user -u 7xen-station -f"
echo "Check:  bash $REPO/scripts/station-status.sh"
if [[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != "yes" ]]; then
  echo "Note: the service runs while you're logged in. To keep it running when logged out: loginctl enable-linger $USER (optional)."
fi
