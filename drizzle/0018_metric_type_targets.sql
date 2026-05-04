-- Move `target` from per-widget config onto metric_types as a single
-- source of truth. `higher_is_better` joins it (drives color coding).
-- Widgets read from here; the per-widget override is dropped in code.

ALTER TABLE `metric_types` ADD `target` real;--> statement-breakpoint
ALTER TABLE `metric_types` ADD `higher_is_better` integer DEFAULT true NOT NULL;--> statement-breakpoint

-- Backfill from the Recovery dashboard's prior per-widget targets. Other
-- metrics keep target=NULL (no compliance dashboard for them yet); the
-- user sets values via the metric detail page.

UPDATE `metric_types` SET `target` = 8, `higher_is_better` = 1 WHERE `name` = 'sleep_hours';--> statement-breakpoint
UPDATE `metric_types` SET `target` = 180, `higher_is_better` = 1 WHERE `name` = 'protein_g';--> statement-breakpoint
UPDATE `metric_types` SET `target` = 100, `higher_is_better` = 1 WHERE `name` = 'water_oz';--> statement-breakpoint
UPDATE `metric_types` SET `target` = 30, `higher_is_better` = 1 WHERE `name` = 'fiber_g';