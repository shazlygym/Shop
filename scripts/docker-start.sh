#!/usr/bin/env bash
set -euo pipefail

export USER_API_PORT="${PORT:-${USER_API_PORT:-3001}}"
export USER_WORKER_PORT="${USER_WORKER_PORT:-3002}"

npx prisma db push --schema=api/prisma/schema.prisma --skip-generate

node worker/dist/index.js &
worker_pid=$!

node api/dist/index.js &
api_pid=$!

shutting_down=0

stop() {
  shutting_down=1
  kill -TERM "$worker_pid" "$api_pid" 2>/dev/null || true
  wait "$worker_pid" "$api_pid" 2>/dev/null || true
}

trap stop TERM INT

while kill -0 "$api_pid" 2>/dev/null && kill -0 "$worker_pid" 2>/dev/null; do
  sleep 1
done

if [ "$shutting_down" -eq 1 ]; then
  exit 0
fi

stop
exit 1
