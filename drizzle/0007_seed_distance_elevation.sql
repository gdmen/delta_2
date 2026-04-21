-- Seed canonical metric_types for cardio activity metrics. Stored in SI
-- units — km for distance, m for elevation — matching what Strava (and
-- most fitness APIs) emit natively. Display-layer code converts to
-- imperial when needed.
INSERT OR IGNORE INTO `metric_types` (`name`, `unit`, `frequency_hint`) VALUES
  ('distance_km', 'km', 'occasional'),
  ('elevation_gain_m', 'm', 'occasional');
-- If the resolver auto-created these as `daily` (its default), fix them:
-- they're per-event, never a daily aggregate.
UPDATE `metric_types`
  SET frequency_hint = 'occasional'
  WHERE name IN ('distance_km', 'elevation_gain_m')
    AND frequency_hint = 'daily';
