-- Re-route data from the 7 surviving bare canonicals
-- (sleep_hours, sleep_deep_hours, sleep_rem_hours, avg_hr,
-- distance_km, elevation_gain_m, max_hr) to source-prefixed
-- metric_types that match the new orphan-first ingest behavior. Once
-- this lands the bare canonicals are unreferenced and the user can
-- delete them via the bulk-delete UI on /data.
--
-- Mapping:
--   sleep_hours / sleep_deep_hours / sleep_rem_hours -> apple_health:*
--   avg_hr / distance_km / elevation_gain_m / max_hr -> strava:*
--
-- For each pair: ensure the source-prefixed metric_type exists,
-- re-point references (event_metrics with dedupe, metrics, etc.),
-- update metrics.alias to reflect the new resolution. Idempotent —
-- UPDATEs with WHERE clauses gated on the bare-id, so re-running
-- finds nothing left to move.

-- ============================================================
-- 1. Ensure source-prefixed metric_types exist (carry units across)
-- ============================================================

INSERT OR IGNORE INTO `metric_types` (`name`, `unit`, `frequency_hint`)
SELECT 'apple_health:' || `name`, `unit`, `frequency_hint`
FROM `metric_types`
WHERE `name` IN ('sleep_hours', 'sleep_deep_hours', 'sleep_rem_hours');
--> statement-breakpoint

INSERT OR IGNORE INTO `metric_types` (`name`, `unit`, `frequency_hint`)
SELECT 'strava:' || `name`, `unit`, `frequency_hint`
FROM `metric_types`
WHERE `name` IN ('avg_hr', 'distance_km', 'elevation_gain_m', 'max_hr');
--> statement-breakpoint

-- ============================================================
-- 2. event_metrics (Strava metrics — UNIQUE(event_id, metric_type_id))
--    Pre-delete colliding rows where the strava:* version already
--    has a row for the same event, then re-point survivors.
-- ============================================================

DELETE FROM `event_metrics`
WHERE rowid IN (
  SELECT em.rowid FROM `event_metrics` em
  INNER JOIN `metric_types` bare ON bare.id = em.metric_type_id
  INNER JOIN `metric_types` prefixed ON prefixed.name = 'strava:' || bare.name
  WHERE bare.name IN ('avg_hr', 'distance_km', 'elevation_gain_m', 'max_hr')
    AND EXISTS (
      SELECT 1 FROM `event_metrics` em2
      WHERE em2.event_id = em.event_id
        AND em2.metric_type_id = prefixed.id
    )
);
--> statement-breakpoint

UPDATE `event_metrics`
SET `metric_type_id` = (
  SELECT prefixed.id FROM `metric_types` bare
  INNER JOIN `metric_types` prefixed ON prefixed.name = 'strava:' || bare.name
  WHERE bare.id = `event_metrics`.`metric_type_id`
)
WHERE `metric_type_id` IN (
  SELECT id FROM `metric_types` WHERE name IN ('avg_hr', 'distance_km', 'elevation_gain_m', 'max_hr')
);
--> statement-breakpoint

-- ============================================================
-- 3. metrics (HAE sleep — UNIQUE(source_id) only, no collision risk)
-- ============================================================

UPDATE `metrics`
SET `metric_type_id` = (
  SELECT prefixed.id FROM `metric_types` bare
  INNER JOIN `metric_types` prefixed ON prefixed.name = 'apple_health:' || bare.name
  WHERE bare.id = `metrics`.`metric_type_id`
),
`alias` = (
  SELECT 'apple_health:' || bare.name FROM `metric_types` bare
  WHERE bare.id = `metrics`.`metric_type_id`
)
WHERE `metric_type_id` IN (
  SELECT id FROM `metric_types`
  WHERE name IN ('sleep_hours', 'sleep_deep_hours', 'sleep_rem_hours')
);
--> statement-breakpoint

-- ============================================================
-- 4. daily_summaries (drop the bare's; canonical's daily_summaries
--    on the prefixed type recompute on next ingest)
-- ============================================================

DELETE FROM `daily_summaries`
WHERE `metric_type_id` IN (
  SELECT id FROM `metric_types`
  WHERE name IN (
    'sleep_hours', 'sleep_deep_hours', 'sleep_rem_hours',
    'avg_hr', 'distance_km', 'elevation_gain_m', 'max_hr'
  )
);
