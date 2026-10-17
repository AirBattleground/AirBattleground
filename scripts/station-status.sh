#!/usr/bin/env bash
# Print the 7XEN Station's status (GET /health with the token from services/station/.env).
#   bash scripts/station-status.sh [http://127.0.0.1:4500]
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
URL="${1:-http://127.0.0.1:$(grep -E '^STATION_PORT=' "$REPO/services/station/.env" 2>/dev/null | cut -d= -f2- || echo 4500)}"
TOKEN="$(grep -E '^STATION_TOKEN=' "$REPO/services/station/.env" | head -1 | cut -d= -f2-)"
curl -fsS -H "X-Station-Token: $TOKEN" "$URL/health?fresh=1" | (command -v jq >/dev/null && jq . || cat)
echo
