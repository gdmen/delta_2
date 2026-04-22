-- Seed canonical per-event heart-rate metric types. Populated by the
-- Strava sync (average_heartrate + max_heartrate fields) and attached
-- to events via event_metrics. Names follow the `resting_hr` precedent
-- (implicit bpm, no unit in the name).
INSERT OR IGNORE INTO `metric_types` (`name`, `unit`, `frequency_hint`) VALUES
  ('avg_hr', 'bpm', 'occasional'),
  ('max_hr', 'bpm', 'occasional');
-- If the resolver auto-created these as `daily` (its default), fix them:
-- they're per-event, never a daily aggregate.
UPDATE `metric_types`
  SET frequency_hint = 'occasional'
  WHERE name IN ('avg_hr', 'max_hr')
    AND frequency_hint = 'daily';
