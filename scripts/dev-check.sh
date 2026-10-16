#!/usr/bin/env bash
# 7xen local environment check: toolchain, database container, .env, migrations, running services.
# Usage: pnpm check   (or bash scripts/dev-check.sh)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  G=$'\e[32m'; R=$'\e[31m'; Y=$'\e[33m'; D=$'\e[2m'; N=$'\e[0m'
else
  G=""; R=""; Y=""; D=""; N=""
fi
FAIL=0
ok()   { printf '%s✓%s %s\n' "$G" "$N" "$*"; }
warn() { printf '%s!%s %s\n' "$Y" "$N" "$*"; }
bad()  { printf '%s✗%s %s\n' "$R" "$N" "$*"; FAIL=1; }
hint() { printf '    %s%s%s\n' "$D" "$*" "$N"; }

ver_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]; }

echo "7xen dev check ($ROOT)"
echo

# ---- toolchain -------------------------------------------------------------
if command -v node >/dev/null; then
  NODE_V="$(node -v | sed 's/^v//')"
  if ver_ge "$NODE_V" "24.0.0"; then ok "node $NODE_V"; else bad "node $NODE_V (need >= 24)"; hint "nvm install 24"; fi
else
  bad "node not found"; hint "install Node 24: https://nodejs.org"
fi

WANT_PNPM="$(node -p "require('./package.json').packageManager.split('@')[1]" 2>/dev/null || echo 11)"
if command -v pnpm >/dev/null; then
  PNPM_V="$(pnpm -v 2>/dev/null)"
  if [ "${PNPM_V%%.*}" = "${WANT_PNPM%%.*}" ]; then ok "pnpm $PNPM_V"; else warn "pnpm $PNPM_V (repo pins $WANT_PNPM)"; hint "corepack enable && corepack prepare pnpm@$WANT_PNPM --activate"; fi
else
  bad "pnpm not found"; hint "corepack enable && corepack prepare pnpm@$WANT_PNPM --activate"
fi

if [ -d node_modules ] && [ -d apps/api/node_modules ]; then ok "dependencies installed"; else bad "dependencies missing"; hint "pnpm install"; fi

COMPOSE=""
if command -v docker >/dev/null; then
  if docker info >/dev/null 2>&1; then ok "docker $(docker version --format '{{.Server.Version}}' 2>/dev/null)"; else bad "docker daemon not reachable"; hint "start docker / add your user to the docker group"; fi
  if command -v docker-compose >/dev/null; then COMPOSE="docker-compose"; elif docker compose version >/dev/null 2>&1; then COMPOSE="docker compose"; fi
  if [ -n "$COMPOSE" ]; then ok "compose: $($COMPOSE version --short 2>/dev/null || echo "$COMPOSE")"; else bad "docker-compose not found"; fi
else
  bad "docker not found"; hint "install Docker to run Postgres (or point DATABASE_URL at your own Postgres 16)"
fi

# ---- database container ----------------------------------------------------
echo
if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
  STATE="$(docker inspect -f '{{.State.Status}}' 7xen-db 2>/dev/null || true)"
  if [ "$STATE" = "running" ]; then
    if docker exec 7xen-db pg_isready -U sevenxen -d sevenxen >/dev/null 2>&1; then
      ok "db container 7xen-db running and accepting connections (localhost:5433)"
    else
      bad "db container 7xen-db running but not ready"; hint "docker logs 7xen-db"
    fi
  elif [ -n "$STATE" ]; then
    bad "db container 7xen-db is $STATE"; hint "pnpm db:up"
  else
    bad "db container 7xen-db not found"; hint "pnpm db:up"
  fi
fi

# ---- api .env --------------------------------------------------------------
ENV_FILE="apps/api/.env"
if [ -f "$ENV_FILE" ]; then
  ok "$ENV_FILE present"
  for key in $(grep -E '^[A-Z_]+=' apps/api/.env.example | cut -d= -f1); do
    grep -qE "^$key=" "$ENV_FILE" || { warn "$ENV_FILE is missing $key (see .env.example)"; }
  done
  if grep -qE '^JWT_SECRET=change-me' "$ENV_FILE"; then warn "JWT_SECRET is still the example value (fine locally, never in production)"; fi
else
  bad "$ENV_FILE missing"; hint "cp apps/api/.env.example apps/api/.env"
fi

# ---- migrations ------------------------------------------------------------
if [ -f "$ENV_FILE" ] && [ -d apps/api/node_modules/prisma ]; then
  OUT="$(cd apps/api && node --env-file=.env node_modules/prisma/build/index.js migrate status 2>&1)"
  if echo "$OUT" | grep -q "Database schema is up to date"; then
    ok "migrations up to date ($(ls -d apps/api/prisma/migrations/*/ 2>/dev/null | wc -l | tr -d ' ') applied)"
  elif echo "$OUT" | grep -qiE "not yet been applied|following migration"; then
    bad "pending migrations"; hint "pnpm db:migrate"
  elif echo "$OUT" | grep -qiE "can't reach|P1001|ECONNREFUSED"; then
    bad "cannot reach the database from DATABASE_URL"; hint "pnpm db:up, then check DATABASE_URL in $ENV_FILE"
  else
    bad "prisma migrate status failed"; echo "$OUT" | tail -n 5 | sed 's/^/    /'
  fi
fi

# ---- running services (informational) --------------------------------------
echo
probe() { curl -fsS -m 2 -o /dev/null "$1" 2>/dev/null; }
if command -v curl >/dev/null; then
  probe http://localhost:4000/api/health && ok "api   http://localhost:4000 (healthy)"  || printf '%s-%s api   http://localhost:4000 not running %s(pnpm dev)%s\n' "$D" "$N" "$D" "$N"
  probe http://localhost:5173           && ok "web   http://localhost:5173"            || printf '%s-%s web   http://localhost:5173 not running\n' "$D" "$N"
  probe http://localhost:5173/admin-ui && ok "admin http://localhost:5173/admin-ui" || printf "%s-%s admin /admin-ui not running\n" "$D" "$N"
fi

echo
if [ "$FAIL" = 0 ]; then printf '%sAll required checks passed.%s\n' "$G" "$N"; else printf '%sSome checks failed — see hints above.%s\n' "$R" "$N"; fi
exit "$FAIL"
