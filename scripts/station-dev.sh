#!/usr/bin/env bash
# Run the 7XEN Station in the foreground (development). Config: services/station/.env.
#   bash scripts/station-dev.sh        (Ctrl+C finishes an active recording, then exits)
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO/services/station"
exec node --import tsx src/index.ts
