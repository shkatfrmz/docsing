#!/usr/bin/env bash
# Starts the API and the Vite dev server together. Ctrl+C stops both.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ -d "$ROOT/backend/node_modules" ] || (cd "$ROOT/backend" && npm install)
[ -d "$ROOT/frontend/node_modules" ] || (cd "$ROOT/frontend" && npm install)

(cd "$ROOT/backend" && node server.js) &
API_PID=$!
trap 'kill "$API_PID" 2>/dev/null || true' EXIT INT TERM

cd "$ROOT/frontend" && npm run dev
