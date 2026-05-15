-- POC migration for issue #25: convert app_settings.updated_at from
-- text to native timestamptz.
--
-- This is the proof-of-concept column. Once verified end-to-end
-- (custom column type compiles, full test suite passes on both
-- postgres-js + pglite, CSV/JSON round-trips preserve the
-- `new Date().toISOString()` wire format), the remaining 35 text-typed
-- timestamp columns get the same treatment in follow-up migrations.
--
-- The `USING <col>::timestamptz` clause parses existing ISO-8601
-- strings into proper timestamps, handling any offset shape (`Z`,
-- `+00`, `-07:00`, etc.) deterministically. Pre-check before applying:
--   SELECT COUNT(*) FROM app_settings
--   WHERE updated_at = '' OR updated_at !~ '^\d{4}-\d{2}-\d{2}T';
-- Empty strings and malformed values must be cleaned up first; Postgres
-- aborts the cast otherwise.
--
-- Lock cost: app_settings is a low-traffic table (one row per user, no
-- secondary indexes on this column). The ACCESS EXCLUSIVE lock for the
-- type change is sub-second on any realistic dataset.

ALTER TABLE "app_settings"
  ALTER COLUMN "updated_at" SET DATA TYPE timestamptz
  USING "updated_at"::timestamptz;
