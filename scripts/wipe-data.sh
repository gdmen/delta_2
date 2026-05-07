#!/usr/bin/env bash
#
# Delta wipe — destructively delete all user data from delta2.db while
# preserving the schema and OAuth tokens.
#
# Usage:
#   ./scripts/wipe-data.sh
#
# Run from inside the cloned repo as the 'ubuntu' user. Needs passwordless
# sudo for systemctl + cp.
#
# What it does:
#   1. Auto-backup delta2.db -> delta2.db.bak-<UTC-timestamp>
#   2. Stop the delta2 service so the running app releases its WAL write lock
#      (better-sqlite3 holds it; sqlite3 CLI would otherwise hang or get
#      "database is locked")
#   3. DELETE every row from the user-data tables, FKs OFF for the duration
#      so leaf-vs-parent ordering doesn't matter
#   4. Reset sqlite_sequence so re-imported rows start at id=1
#   5. WAL checkpoint so the on-disk file matches what's actually live
#   6. Start the delta2 service back up
#
# NOT touched:
#   - ingest_configs        — OAuth tokens / API keys; wiping them forces
#                             re-auth (Strava, Apple Health). Restore separately
#                             if you also want to wipe credentials.
#   - drizzle migration meta — schema stays put; we're wiping rows, not schema.
#   - app_settings           — preferences (timezone, etc.)
#
# Mirrors the table list in src/app/api/dev/wipe-data/route.ts (the dev-only
# sibling that's blocked in production by NODE_ENV check). Keep both in sync
# when adding new user-data tables.
#
# Refuses to run unless the operator confirms by typing the literal string
# `WIPE`. No --force flag, on purpose.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="$REPO_ROOT/delta2.db"

if [[ ! -f "$DB" ]]; then
  echo "error: $DB does not exist" >&2
  exit 1
fi

# --- confirm ----------------------------------------------------------------
echo
echo "About to DELETE ALL USER DATA from:"
echo "  $DB"
echo
echo "This wipes: import_sources, metrics, events, sports, exercises,"
echo "merge_log, focuses, goals, dashboards, daily_summaries, reconcile_log."
echo
echo "Preserved: ingest_configs (OAuth tokens), app_settings, schema."
echo
echo "A backup will be saved alongside delta2.db before anything is touched."
echo
read -r -p 'Type WIPE to confirm: ' CONFIRM
if [[ "$CONFIRM" != "WIPE" ]]; then
  echo "aborted (you typed: $CONFIRM)" >&2
  exit 1
fi

# --- backup -----------------------------------------------------------------
TS="$(date -u +%Y%m%d-%H%M%S)"
BACKUP="$DB.bak-$TS"
echo
echo "===> Backing up to $BACKUP"
sudo cp "$DB" "$BACKUP"

# --- stop service so SQLite isn't locked ------------------------------------
echo
echo "===> Stopping delta2 (releases SQLite WAL write lock)"
sudo systemctl stop delta2 || true

# Bring the service back up regardless of whether the wipe succeeds.
trap 'echo; echo "!!! wipe aborted — starting delta2 anyway"; sudo systemctl start delta2 || true' ERR

# --- wipe -------------------------------------------------------------------
echo
echo "===> Deleting rows"
sqlite3 "$DB" <<'SQL'
PRAGMA foreign_keys = OFF;
BEGIN;

-- Children before parents (matters only if FKs flip back on mid-script).
DELETE FROM workout_sets;
DELETE FROM event_metrics;
DELETE FROM goal_journal_entries;
DELETE FROM coach_calls;
DELETE FROM focuses;
DELETE FROM goals;
DELETE FROM events;
DELETE FROM metrics;
DELETE FROM metric_type_aliases;
DELETE FROM metric_types;
DELETE FROM sports;
DELETE FROM daily_summaries;
DELETE FROM reconcile_log;
-- merge_log has no FK to other user-data tables (canonical_id is by-value
-- not by-FK), so a deleted metric_type doesn't cascade-delete the audit row.
-- We wipe it explicitly to clear the history.
DELETE FROM merge_log;
DELETE FROM source_settings;
DELETE FROM import_sources;
-- Dashboards: widgets first so the FK from dashboard_widgets -> dashboards
-- doesn't fight us if FKs flip back on mid-wipe.
DELETE FROM dashboard_widgets;
DELETE FROM dashboards;

-- Reset autoincrement counters so re-imported rows land at id=1 cleanly.
DELETE FROM sqlite_sequence;

COMMIT;
PRAGMA foreign_keys = ON;

-- Move WAL contents into the main file + truncate WAL/SHM, so the on-disk
-- delta2.db matches the post-wipe state and a subsequent backup catches
-- everything. Without this, the wiped rows can linger in the WAL file.
PRAGMA wal_checkpoint(TRUNCATE);
SQL

# --- restart ----------------------------------------------------------------
echo
echo "===> Starting delta2"
sudo systemctl start delta2

echo
echo "Done. Backup at $BACKUP"
echo "If the canonical seed metric_types/sports are needed, re-run:"
echo "  for f in drizzle/0006_*.sql drizzle/0007_*.sql drizzle/0008_*.sql drizzle/0009_*.sql; do"
echo "    sqlite3 \"$DB\" < \"\$f\""
echo "  done"
