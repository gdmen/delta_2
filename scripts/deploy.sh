#!/usr/bin/env bash
#
# Delta deploy — pull latest, stop service, migrate, seed, build, start.
#
# Usage:
#   ./scripts/deploy.sh
#
# Run from inside /opt/delta2 (or wherever you cloned it) as ubuntu.
# Assumes bootstrap.sh has already been run successfully.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

step() {
  echo
  echo "===> $1"
}

cd "$REPO_ROOT"

step "Fetching + hard-resetting to origin/main"
# The server is a deploy target, not a dev machine: any local edits here are
# accidents. Hard reset avoids ff-only failures when someone tweaked a file
# in-place (common during debugging) and guarantees the tree matches origin.
git fetch origin
git reset --hard origin/main

step "Installing dependencies"
npm ci

# Stop the app before touching SQLite. The running better-sqlite3 connection
# holds a WAL write lock which makes drizzle-kit migrate hang silently —
# observed in prod (2026-04-21) where a pending migration sat unapplied
# across multiple deploys because of this. Restarting at the end brings
# it back up regardless of whether it was running before.
step "Stopping delta2 (releases SQLite write lock)"
sudo systemctl stop delta2 || true

# If any DB step fails or hangs below, still bring the service back up.
trap 'echo; echo "!!! deploy aborted — starting delta2 anyway"; sudo systemctl start delta2 || true' ERR

step "Running migrations"
# Timeout guards against the same silent hang reappearing under some other
# lock holder. 60s is generous for the tiny SQL-only migrations this project
# writes; bump it if schema diffs grow.
timeout 60 npx drizzle-kit migrate

step "Running seed (idempotent)"
timeout 60 npx tsx src/db/seed.ts

step "Building Next.js"
npm run build

trap - ERR

step "Starting delta2"
sudo systemctl start delta2

sleep 2
if systemctl is-active --quiet delta2; then
  echo
  echo "Service is active."
else
  echo
  echo "Service failed to start. Last 50 log lines:"
  sudo journalctl -u delta2 -n 50 --no-pager
  exit 1
fi

step "Smoke test"
# 401 is healthy when SITE_PASSWORD is set — the Basic Auth gate in
# src/proxy.ts proves the app is up and responding. Fail only on real
# outages (5xx, connection refused, etc.).
status=$(curl -sS -o /dev/null -w '%{http_code}' http://localhost:3000/ || echo "000")
case "$status" in
  200|401) echo "  HTTP $status (healthy)" ;;
  *) echo "  HTTP $status (unexpected)"; exit 1 ;;
esac

step "Done."
echo "  Logs: sudo journalctl -u delta2 -f"
