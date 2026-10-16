#!/bin/sh
# Apply pending migrations (retrying while Postgres starts), then exec the server.
set -e
if [ "${SKIP_MIGRATIONS:-false}" != "true" ]; then
  n=0
  until prisma migrate deploy --schema prisma/schema.prisma; do
    n=$((n + 1))
    if [ "$n" -ge "${MIGRATE_RETRIES:-15}" ]; then
      echo "prisma migrate deploy failed after $n attempts" >&2
      exit 1
    fi
    echo "database not ready, retrying in 2s ($n)..." >&2
    sleep 2
  done
fi
exec "$@"
