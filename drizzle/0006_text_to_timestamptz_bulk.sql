-- Bulk text→timestamptz / text→date migration (issue #25, follow-up to 0005).
--
-- 0005 proved the isoTimestamptz custom column type on a single column
-- (app_settings.updated_at). This migration scales to the remaining 35
-- timestamp columns + 4 date-only columns across the schema.
--
-- Pre-check: every column being converted must hold valid ISO-8601
-- timestamps (or YYYY-MM-DD for date columns). Empty strings would
-- abort with `invalid input syntax`. The codebase never writes empty
-- strings to these columns (all writes go through `new Date().toISOString()`
-- or are NULL-guarded), so this is safe for production data.
--
-- Lock cost: per-column ACCESS EXCLUSIVE lock, plus index rebuilds on
-- columns that have one (`metrics.recorded_at`, `events.started_at`,
-- `coach_calls.ts`, `merge_log.created_at`, `reconcile_log.at`,
-- `daily_summaries.date`, plus the composite indexes that include
-- timestamp columns). On a typical self-hosted dataset (~38K rows in
-- `metrics`) total lock time is single-digit seconds.
--
-- Once this lands, the workarounds in `findDuplicateCandidates`
-- (`::timestamptz` casts) and the `substr(<col>, 1, 10)` patterns in
-- `computed-metrics.ts`, `data/page.tsx`, `ingest-service.ts`, and
-- `merge-log/applier.ts` are no longer needed — they're replaced in
-- the same commit.

-- =============================================================================
-- timestamptz columns
-- =============================================================================

-- users
ALTER TABLE "users" ALTER COLUMN "created_at" SET DATA TYPE timestamptz USING "created_at"::timestamptz;
--> statement-breakpoint

-- invite_codes
ALTER TABLE "invite_codes" ALTER COLUMN "expires_at" SET DATA TYPE timestamptz USING "expires_at"::timestamptz;
--> statement-breakpoint
ALTER TABLE "invite_codes" ALTER COLUMN "used_at" SET DATA TYPE timestamptz USING "used_at"::timestamptz;
--> statement-breakpoint
ALTER TABLE "invite_codes" ALTER COLUMN "created_at" SET DATA TYPE timestamptz USING "created_at"::timestamptz;
--> statement-breakpoint

-- oauth_states
ALTER TABLE "oauth_states" ALTER COLUMN "expires_at" SET DATA TYPE timestamptz USING "expires_at"::timestamptz;
--> statement-breakpoint

-- session_denylist
ALTER TABLE "session_denylist" ALTER COLUMN "revoked_at" SET DATA TYPE timestamptz USING "revoked_at"::timestamptz;
--> statement-breakpoint

-- dashboard_share_tokens
ALTER TABLE "dashboard_share_tokens" ALTER COLUMN "created_at" SET DATA TYPE timestamptz USING "created_at"::timestamptz;
--> statement-breakpoint
ALTER TABLE "dashboard_share_tokens" ALTER COLUMN "revoked_at" SET DATA TYPE timestamptz USING "revoked_at"::timestamptz;
--> statement-breakpoint

-- sports
ALTER TABLE "sports" ALTER COLUMN "created_at" SET DATA TYPE timestamptz USING "created_at"::timestamptz;
--> statement-breakpoint

-- metric_types
ALTER TABLE "metric_types" ALTER COLUMN "created_at" SET DATA TYPE timestamptz USING "created_at"::timestamptz;
--> statement-breakpoint

-- metric_type_aliases
ALTER TABLE "metric_type_aliases" ALTER COLUMN "created_at" SET DATA TYPE timestamptz USING "created_at"::timestamptz;
--> statement-breakpoint

-- metrics (hot table — recorded_at is indexed)
ALTER TABLE "metrics" ALTER COLUMN "recorded_at" SET DATA TYPE timestamptz USING "recorded_at"::timestamptz;
--> statement-breakpoint
ALTER TABLE "metrics" ALTER COLUMN "created_at" SET DATA TYPE timestamptz USING "created_at"::timestamptz;
--> statement-breakpoint

-- events (hot table — started_at is indexed via idx_events_sport_started)
ALTER TABLE "events" ALTER COLUMN "started_at" SET DATA TYPE timestamptz USING "started_at"::timestamptz;
--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "created_at" SET DATA TYPE timestamptz USING "created_at"::timestamptz;
--> statement-breakpoint

-- event_duplicate_denylist
ALTER TABLE "event_duplicate_denylist" ALTER COLUMN "created_at" SET DATA TYPE timestamptz USING "created_at"::timestamptz;
--> statement-breakpoint

-- (workout_sets has no created_at/updated_at)

-- goals (deadline migrates to date; created_at to timestamptz)
ALTER TABLE "goals" ALTER COLUMN "created_at" SET DATA TYPE timestamptz USING "created_at"::timestamptz;
--> statement-breakpoint

-- focuses
ALTER TABLE "focuses" ALTER COLUMN "dismissed_at" SET DATA TYPE timestamptz USING "dismissed_at"::timestamptz;
--> statement-breakpoint
ALTER TABLE "focuses" ALTER COLUMN "created_at" SET DATA TYPE timestamptz USING "created_at"::timestamptz;
--> statement-breakpoint

-- goal_journal_entries
ALTER TABLE "goal_journal_entries" ALTER COLUMN "created_at" SET DATA TYPE timestamptz USING "created_at"::timestamptz;
--> statement-breakpoint

-- coach_calls (ts is indexed)
ALTER TABLE "coach_calls" ALTER COLUMN "ts" SET DATA TYPE timestamptz USING "ts"::timestamptz;
--> statement-breakpoint

-- ingest_configs
ALTER TABLE "ingest_configs" ALTER COLUMN "last_sync_at" SET DATA TYPE timestamptz USING "last_sync_at"::timestamptz;
--> statement-breakpoint

-- import_sources
ALTER TABLE "import_sources" ALTER COLUMN "created_at" SET DATA TYPE timestamptz USING "created_at"::timestamptz;
--> statement-breakpoint

-- merge_log (created_at is indexed)
ALTER TABLE "merge_log" ALTER COLUMN "created_at" SET DATA TYPE timestamptz USING "created_at"::timestamptz;
--> statement-breakpoint
ALTER TABLE "merge_log" ALTER COLUMN "undone_at" SET DATA TYPE timestamptz USING "undone_at"::timestamptz;
--> statement-breakpoint

-- source_settings
ALTER TABLE "source_settings" ALTER COLUMN "updated_at" SET DATA TYPE timestamptz USING "updated_at"::timestamptz;
--> statement-breakpoint

-- reconcile_log (at is indexed; range_start / range_end are full timestamps)
ALTER TABLE "reconcile_log" ALTER COLUMN "range_start" SET DATA TYPE timestamptz USING "range_start"::timestamptz;
--> statement-breakpoint
ALTER TABLE "reconcile_log" ALTER COLUMN "range_end" SET DATA TYPE timestamptz USING "range_end"::timestamptz;
--> statement-breakpoint
ALTER TABLE "reconcile_log" ALTER COLUMN "at" SET DATA TYPE timestamptz USING "at"::timestamptz;
--> statement-breakpoint

-- daily_summaries (date migrates to date; last_ingest_at to timestamptz)
ALTER TABLE "daily_summaries" ALTER COLUMN "last_ingest_at" SET DATA TYPE timestamptz USING "last_ingest_at"::timestamptz;
--> statement-breakpoint

-- dashboards
ALTER TABLE "dashboards" ALTER COLUMN "created_at" SET DATA TYPE timestamptz USING "created_at"::timestamptz;
--> statement-breakpoint
ALTER TABLE "dashboards" ALTER COLUMN "updated_at" SET DATA TYPE timestamptz USING "updated_at"::timestamptz;
--> statement-breakpoint

-- (dashboard_widgets has no created_at/updated_at)

-- =============================================================================
-- date columns (YYYY-MM-DD, no time component)
-- =============================================================================

-- goals.deadline (indexed via idx_goals_deadline composite — index rebuilds)
ALTER TABLE "goals" ALTER COLUMN "deadline" SET DATA TYPE date USING "deadline"::date;
--> statement-breakpoint

-- focuses
ALTER TABLE "focuses" ALTER COLUMN "start_date" SET DATA TYPE date USING "start_date"::date;
--> statement-breakpoint
ALTER TABLE "focuses" ALTER COLUMN "end_date" SET DATA TYPE date USING "end_date"::date;
--> statement-breakpoint

-- daily_summaries.date (indexed via the unique (user_id, date, metric_type_id))
ALTER TABLE "daily_summaries" ALTER COLUMN "date" SET DATA TYPE date USING "date"::date;
