-- Drop the bench_1rm / squat_1rm / deadlift_1rm primitive metric_types.
-- Their semantic role (track 1RM strength over time) is now covered by
-- the auto-seeded computed metrics in src/lib/computed-metrics.ts:
--
--   bench_1rm    → flat_barbell_bench_press_e1rm  (per-day max e1RM)
--                  flat_barbell_bench_press_max   (lifetime PR step graph)
--   squat_1rm    → barbell_back_squat_e1rm
--                  barbell_back_squat_max
--   deadlift_1rm → barbell_deadlift_e1rm
--                  barbell_deadlift_max
--
-- The computed metrics carry strictly more information (no manual data
-- entry, derived from the actual sets you logged). This migration:
--   1. Re-points any goal that targeted a _1rm at the corresponding
--      _e1rm replacement (only when the replacement exists).
--   2. Deletes the _1rm rows. The DELETE is gated on having no remaining
--      FK references — if the user's goal didn't get re-pointed (because
--      the replacement metric_type didn't exist in their DB), the row
--      stays put and the migration is effectively a no-op for them. They
--      can re-run after re-pointing manually.
--
-- Idempotent: re-running on a DB that already cleared these rows is a
-- no-op.

UPDATE `goals`
SET `metric_type_id` = (SELECT id FROM `metric_types` WHERE name = 'flat_barbell_bench_press_e1rm')
WHERE `metric_type_id` = (SELECT id FROM `metric_types` WHERE name = 'bench_1rm')
  AND EXISTS (SELECT 1 FROM `metric_types` WHERE name = 'flat_barbell_bench_press_e1rm');
--> statement-breakpoint

UPDATE `goals`
SET `metric_type_id` = (SELECT id FROM `metric_types` WHERE name = 'barbell_back_squat_e1rm')
WHERE `metric_type_id` = (SELECT id FROM `metric_types` WHERE name = 'squat_1rm')
  AND EXISTS (SELECT 1 FROM `metric_types` WHERE name = 'barbell_back_squat_e1rm');
--> statement-breakpoint

UPDATE `goals`
SET `metric_type_id` = (SELECT id FROM `metric_types` WHERE name = 'barbell_deadlift_e1rm')
WHERE `metric_type_id` = (SELECT id FROM `metric_types` WHERE name = 'deadlift_1rm')
  AND EXISTS (SELECT 1 FROM `metric_types` WHERE name = 'barbell_deadlift_e1rm');
--> statement-breakpoint

-- Belt-and-suspenders: only delete if no FK still references. metrics +
-- workout_sets + event_metrics are restrict-style, goals was just
-- re-pointed above. Aliases cascade so they don't block.
DELETE FROM `metric_types`
WHERE name IN ('bench_1rm', 'squat_1rm', 'deadlift_1rm')
  AND id NOT IN (SELECT metric_type_id FROM `goals`)
  AND id NOT IN (SELECT metric_type_id FROM `metrics`)
  AND id NOT IN (SELECT exercise_metric_type_id FROM `workout_sets`)
  AND id NOT IN (SELECT metric_type_id FROM `event_metrics`);
