-- Medication scheduling: auto-log a dose row daily per metric_type
-- where `auto_log_dose` is set, plus a skip-tombstone table so deleted
-- auto-rows don't resurrect on the next materializer pass.
--
-- See issue #30 for the full design rationale. Single column on
-- metric_types is the schedule; the skip table is a (metric_type_id,
-- local_date) tombstone keyed by the day in the user's local timezone.
--
-- Lazy materialization runs from the request path; this migration only
-- adds the storage. No backfill — schedules start with `auto_log_dose
-- = NULL` for every existing metric_type.

ALTER TABLE metric_types
  ADD COLUMN auto_log_dose DOUBLE PRECISION;
--> statement-breakpoint

CREATE TABLE metric_schedule_skips (
  metric_type_id INTEGER NOT NULL REFERENCES metric_types(id) ON DELETE CASCADE,
  skipped_date DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (metric_type_id, skipped_date)
);
