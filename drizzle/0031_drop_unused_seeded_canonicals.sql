-- Drop the 21 hardcoded seeded canonical metric_types that no longer
-- get re-inserted by src/db/seed.ts. Built-in importers (Strava,
-- Apple Health, BodySpec) now follow the same orphan-first procedure
-- as CSV imports, so future ingest creates `apple_health:sleep_hours`,
-- `strava:distance_km`, `bodyspec_dexa:bodyweight`, etc.
--
-- Only deletes seeded names that are completely unreferenced. If a
-- name still has data on it (the user has been ingesting through it,
-- or merged something into it, or pinned a goal to it), it stays —
-- the user can clean it up manually if they want.
--
-- daily_summaries gets dropped first to avoid FK blocks. In practice
-- a metric_type with no metrics rows shouldn't have summaries either,
-- but the explicit delete makes the migration robust.

DELETE FROM `daily_summaries`
WHERE `metric_type_id` IN (
  SELECT `id` FROM `metric_types`
  WHERE `name` IN (
    'bodyweight', 'body_fat_pct', 'lean_mass', 'fat_mass',
    'bone_mineral_density', 'visceral_fat_mass',
    'sleep_hours', 'sleep_deep_hours', 'sleep_rem_hours',
    'hrv_ms', 'resting_hr', 'protein_g', 'water_oz', 'fiber_g',
    'active_energy_kcal', 'steps', 'vo2_max',
    'distance_km', 'elevation_gain_m', 'avg_hr', 'max_hr'
  )
  AND NOT EXISTS (SELECT 1 FROM `metrics` WHERE `metric_type_id` = `metric_types`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `event_metrics` WHERE `metric_type_id` = `metric_types`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `workout_sets` WHERE `exercise_metric_type_id` = `metric_types`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `goals` WHERE `metric_type_id` = `metric_types`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `metric_type_aliases` WHERE `canonical_metric_type_id` = `metric_types`.`id`)
);
--> statement-breakpoint

DELETE FROM `metric_types`
WHERE `name` IN (
  'bodyweight', 'body_fat_pct', 'lean_mass', 'fat_mass',
  'bone_mineral_density', 'visceral_fat_mass',
  'sleep_hours', 'sleep_deep_hours', 'sleep_rem_hours',
  'hrv_ms', 'resting_hr', 'protein_g', 'water_oz', 'fiber_g',
  'active_energy_kcal', 'steps', 'vo2_max',
  'distance_km', 'elevation_gain_m', 'avg_hr', 'max_hr'
)
AND NOT EXISTS (SELECT 1 FROM `metrics` WHERE `metric_type_id` = `metric_types`.`id`)
AND NOT EXISTS (SELECT 1 FROM `event_metrics` WHERE `metric_type_id` = `metric_types`.`id`)
AND NOT EXISTS (SELECT 1 FROM `workout_sets` WHERE `exercise_metric_type_id` = `metric_types`.`id`)
AND NOT EXISTS (SELECT 1 FROM `goals` WHERE `metric_type_id` = `metric_types`.`id`)
AND NOT EXISTS (SELECT 1 FROM `metric_type_aliases` WHERE `canonical_metric_type_id` = `metric_types`.`id`);
