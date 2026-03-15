#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-3000}"
HOST="${2:-localhost}"

echo "Checking port ${PORT}..."
PIDS="$(lsof -t -iTCP:${PORT} -sTCP:LISTEN 2>/dev/null || true)"

if [ -n "${PIDS}" ]; then
  echo "Killing process(es) on port ${PORT}: ${PIDS}"
  kill -9 ${PIDS}
  sleep 1
fi

echo "Starting Next.js on http://${HOST}:${PORT}"
exec npx next dev -H "${HOST}" -p "${PORT}"
