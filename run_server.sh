#!/usr/bin/env bash
# Reflected Linux version of run_server.bat — starts the full stack.
set -e
cd "$(dirname "$0")"

echo "Starting Bridge Server..."
node server/index.js &
BRIDGE_PID=$!

echo "Starting Web Client Dev Server..."
(cd web-client && npm run dev) &
CLIENT_PID=$!

cleanup() {
  echo
  echo "Stopping servers..."
  kill "$BRIDGE_PID" "$CLIENT_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

echo "Both servers are running!"
echo "Bridge: http://127.0.0.1:24141  Client: http://localhost:3000"
echo "Press Ctrl+C to stop both."
wait
