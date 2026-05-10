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
PRE_RESET_HEAD=$(git rev-parse HEAD)
git reset --hard origin/main
POST_RESET_HEAD=$(git rev-parse HEAD)

# Bash loads the running script into memory at parse time and won't pick up
# in-place edits to deploy.sh during its own run (Linux file replace via
# unlink+create leaves us holding the old inode). Re-exec from the new tree
# the moment we know HEAD changed so any deploy.sh fix in this push takes
# effect on the very deploy that pulled it. Guard with DELTA_DEPLOY_REEXECED
# so we don't loop.
if [[ "$PRE_RESET_HEAD" != "$POST_RESET_HEAD" && -z "${DELTA_DEPLOY_REEXECED:-}" ]]; then
  echo "  HEAD moved $PRE_RESET_HEAD -> $POST_RESET_HEAD; re-exec'ing the fresh deploy.sh"
  export DELTA_DEPLOY_REEXECED=1
  exec "$REPO_ROOT/scripts/deploy.sh" "$@"
fi

step "Installing dependencies"
npm ci

# drizzle-kit reads DATABASE_URL from process.env; .env.local is loaded by
# Next.js at runtime but NOT by drizzle-kit (different process, no Next).
# Source it here so the migrate / seed steps below see it.
if [[ -f "$REPO_ROOT/.env.local" ]]; then
  set -a; source "$REPO_ROOT/.env.local"; set +a
fi

# Run migrations while the app is still up — Postgres handles concurrent
# writes (no SQLite WAL-lock contention to worry about). Migrations are
# additive in this project (no destructive schema changes mid-deploy)
# so running against a live app is safe. We DO stop the service later
# for the build to free RAM on small instances.
trap 'echo; echo "!!! deploy aborted — starting delta2 anyway"; sudo systemctl start delta2 || true' ERR

step "Running migrations"
# Timeout cap so a misbehaving migration fails loud rather than hanging
# the deploy. 60s is generous for the schema diffs this project writes;
# bump it if migrations start touching big tables.
timeout 60 npx drizzle-kit migrate

step "Running seed (idempotent)"
timeout 60 npx tsx src/db/seed.ts

step "Stopping delta2 (frees RAM for the build on small instances)"
sudo systemctl stop delta2 || true

step "Clearing stale .next build artifacts"
# Next 15+ generates `.next/types/validator.ts` (typed-routes table) during
# `next dev` / `next build`. Deleted source routes leave stale validator
# entries pointing at missing pages, which the next tsc pass then fails on
# (observed 2026-05-05: removing /input/bjj killed the deploy until the
# validator was nuked). Clearing the whole `.next/` is cheap — the build
# step below regenerates it from scratch.
rm -rf .next

step "Type-checking (gates the build)"
# Diagnostics so the deploy log tells us if a future OOM is "Node didn't
# get the heap flag" vs "kernel can't give that much physical memory".
echo "Total RAM:"; free -h | awk '/^Mem:/ {print "  " $2 " (avail " $7 ")"}'
echo "Node default heap cap (no flag):"
node -e 'console.log("  ~" + Math.round(require("v8").getHeapStatistics().heap_size_limit / 1024 / 1024) + " MB")'
echo "Node heap cap with --max-old-space-size=4096:"
node --max-old-space-size=4096 -e 'console.log("  ~" + Math.round(require("v8").getHeapStatistics().heap_size_limit / 1024 / 1024) + " MB")'

# Next's in-build TS pass runs in worker_threads with a hardcoded ~512MB
# heap cap that OOMs on small instances. We skip it via next.config.ts and
# run tsc here instead. Invoke node directly (not via npx) so we KNOW the
# --max-old-space-size flag reaches the Node process running tsc — npx's
# wrapper has eaten env-var heap bumps in the past.
node --max-old-space-size=4096 ./node_modules/typescript/lib/tsc.js --noEmit

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
