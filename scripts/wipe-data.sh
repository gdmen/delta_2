#!/usr/bin/env bash
#
# Delta wipe — destructively delete all user data from the production
# Postgres database while preserving the schema and OAuth tokens.
#
# Usage:
#   DATABASE_URL=postgresql://... ./scripts/wipe-data.sh
#
# Run from inside the cloned repo. Doesn't require sudo, and doesn't
# require stopping the app — Postgres handles the concurrent writes.
#
# What it does:
#   1. TRUNCATE every user-data table with RESTART IDENTITY CASCADE so
#      identity sequences reset to 1 and FK ordering is handled by
#      Postgres itself.
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

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "error: DATABASE_URL must be set" >&2
  exit 1
fi

# --- confirm ----------------------------------------------------------------
echo
echo "About to DELETE ALL USER DATA from the Postgres database at:"
echo "  ${DATABASE_URL//:[^:@]*@/:***@}"
echo
echo "This wipes: import_sources, metrics, events, sports, exercises,"
echo "merge_log, focuses, goals, dashboards, daily_summaries, reconcile_log."
echo
echo "Preserved: ingest_configs (OAuth tokens), app_settings, schema."
echo
read -r -p 'Type WIPE to confirm: ' CONFIRM
if [[ "$CONFIRM" != "WIPE" ]]; then
  echo "aborted (you typed: $CONFIRM)" >&2
  exit 1
fi

# --- wipe -------------------------------------------------------------------
echo
echo "===> TRUNCATE-ing user-data tables (with CASCADE so FK order doesn't matter)"
psql "$DATABASE_URL" <<'SQL'
TRUNCATE TABLE
  workout_sets,
  event_metrics,
  goal_journal_entries,
  coach_calls,
  focuses,
  goals,
  events,
  metrics,
  metric_type_aliases,
  metric_types,
  sports,
  daily_summaries,
  reconcile_log,
  merge_log,
  source_settings,
  import_sources,
  dashboard_widgets,
  dashboards
RESTART IDENTITY CASCADE;
SQL

echo
echo "Done. ingest_configs and app_settings preserved."
