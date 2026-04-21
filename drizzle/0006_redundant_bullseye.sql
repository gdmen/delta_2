CREATE TABLE `metric_type_aliases` (
	`alias` text PRIMARY KEY NOT NULL,
	`canonical_metric_type_id` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`canonical_metric_type_id`) REFERENCES `metric_types`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_metric_type_aliases_canonical` ON `metric_type_aliases` (`canonical_metric_type_id`);--> statement-breakpoint
-- Seed Delta's canonical metric_types so every DB has them regardless of
-- whether `src/db/seed.ts` was run. Mirrors METRIC_TYPES in seed.ts.
INSERT OR IGNORE INTO `metric_types` (`name`, `unit`, `frequency_hint`) VALUES
  ('bench_1rm', 'lb', 'weekly'),
  ('squat_1rm', 'lb', 'weekly'),
  ('deadlift_1rm', 'lb', 'weekly'),
  ('bodyweight', 'lb', 'daily'),
  ('body_fat_pct', '%', 'occasional'),
  ('lean_mass', 'lb', 'occasional'),
  ('fat_mass', 'lb', 'occasional'),
  ('bone_mineral_density', 'g/cm²', 'occasional'),
  ('visceral_fat_mass', 'lb', 'occasional'),
  ('sleep_hours', 'h', 'daily'),
  ('sleep_deep_hours', 'h', 'daily'),
  ('sleep_rem_hours', 'h', 'daily'),
  ('hrv_ms', 'ms', 'daily'),
  ('resting_hr', 'bpm', 'daily'),
  ('protein_g', 'g', 'daily'),
  ('water_oz', 'oz', 'daily'),
  ('fiber_g', 'g', 'daily'),
  ('active_energy_kcal', 'kcal', 'daily'),
  ('steps', 'steps', 'daily'),
  ('vo2_max', 'mL/kg/min', 'weekly');--> statement-breakpoint
-- Backfill aliases from the former hardcoded Apple Health METRIC_NAME_MAP.
-- Insert both the raw HAE key and the source-prefixed orphan form so past
-- ingests that fell through to the `apple_health:<raw>` path still route to
-- canonical on the next run.
INSERT OR IGNORE INTO `metric_type_aliases` (`alias`, `canonical_metric_type_id`)
SELECT raw.alias, mt.id
FROM (
  SELECT 'step_count' AS rawName, 'steps' AS canonical, 'step_count' AS alias UNION ALL
  SELECT 'step_count', 'steps', 'apple_health:step_count' UNION ALL
  SELECT 'heart_rate', 'resting_hr', 'heart_rate' UNION ALL
  SELECT 'heart_rate', 'resting_hr', 'apple_health:heart_rate' UNION ALL
  SELECT 'resting_heart_rate', 'resting_hr', 'resting_heart_rate' UNION ALL
  SELECT 'resting_heart_rate', 'resting_hr', 'apple_health:resting_heart_rate' UNION ALL
  SELECT 'heart_rate_variability', 'hrv_ms', 'heart_rate_variability' UNION ALL
  SELECT 'heart_rate_variability', 'hrv_ms', 'apple_health:heart_rate_variability' UNION ALL
  SELECT 'active_energy', 'active_energy_kcal', 'active_energy' UNION ALL
  SELECT 'active_energy', 'active_energy_kcal', 'apple_health:active_energy' UNION ALL
  SELECT 'weight_body_mass', 'bodyweight', 'weight_body_mass' UNION ALL
  SELECT 'weight_body_mass', 'bodyweight', 'apple_health:weight_body_mass' UNION ALL
  SELECT 'body_mass', 'bodyweight', 'body_mass' UNION ALL
  SELECT 'body_mass', 'bodyweight', 'apple_health:body_mass' UNION ALL
  SELECT 'body_fat_percentage', 'body_fat_pct', 'body_fat_percentage' UNION ALL
  SELECT 'body_fat_percentage', 'body_fat_pct', 'apple_health:body_fat_percentage' UNION ALL
  SELECT 'lean_body_mass', 'lean_mass', 'lean_body_mass' UNION ALL
  SELECT 'lean_body_mass', 'lean_mass', 'apple_health:lean_body_mass' UNION ALL
  SELECT 'vo2_max', 'vo2_max', 'apple_health:vo2_max' UNION ALL
  SELECT 'protein', 'protein_g', 'protein' UNION ALL
  SELECT 'protein', 'protein_g', 'apple_health:protein' UNION ALL
  SELECT 'dietary_protein', 'protein_g', 'dietary_protein' UNION ALL
  SELECT 'dietary_protein', 'protein_g', 'apple_health:dietary_protein' UNION ALL
  SELECT 'dietary_water', 'water_oz', 'dietary_water' UNION ALL
  SELECT 'dietary_water', 'water_oz', 'apple_health:dietary_water' UNION ALL
  SELECT 'water', 'water_oz', 'water' UNION ALL
  SELECT 'water', 'water_oz', 'apple_health:water'
) AS raw
JOIN `metric_types` mt ON mt.name = raw.canonical;