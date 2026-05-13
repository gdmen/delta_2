-- One-shot rebuild of daily_summaries from the underlying metrics rows.
--
-- Why: prior to this migration, the ingest path's
-- `invalidateDailySummary` only bumped `last_ingest_at` and left
-- `count=0`, `avg/min/max=NULL` on the row. PATCH and DELETE handlers
-- on `/api/metrics/:id` didn't touch daily_summaries at all. Result:
-- every cell except those touched by a metric_type merge held stale
-- placeholder values.
--
-- Fix landed in the same migration's accompanying TS changes:
-- `recomputeDailySummary` now runs after every metric insert / update /
-- delete. This SQL fills in the historical garbage in one pass.
--
-- TRUNCATE + reinsert is safe because the existing rows are known to
-- be wrong. There's no useful state to preserve.

TRUNCATE daily_summaries;

INSERT INTO daily_summaries (user_id, date, metric_type_id, avg_value, min_value, max_value, count, last_ingest_at)
SELECT
  user_id,
  substr(recorded_at, 1, 10) AS date,
  metric_type_id,
  AVG(value),
  MIN(value),
  MAX(value),
  COUNT(*)::int,
  MAX(recorded_at)
FROM metrics
GROUP BY user_id, substr(recorded_at, 1, 10), metric_type_id;
