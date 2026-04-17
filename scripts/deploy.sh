#!/usr/bin/env bash
#
# Delta deploy — pull latest, migrate, seed, build, restart.
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

step "Running migrations"
npx drizzle-kit migrate

step "Running seed (idempotent)"
npx tsx src/db/seed.ts

step "Building Next.js"
npm run build

step "Restarting delta2 service"
sudo systemctl restart delta2

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
curl -sS -I http://localhost:3000/ | head -1

step "Done."
echo "  Logs: sudo journalctl -u delta2 -f"
