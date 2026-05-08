-- Rename the legacy `csv_import` source-system tag to `custom`. Affects
-- the metric_types orphan prefix (`csv_import:foo` -> `custom:foo`),
-- the metrics.alias column, the metric_type_aliases.alias column, plus
-- the source/source_id columns on metrics + events. Idempotent under
-- INSERT OR IGNORE since we use UPDATE — re-runs are no-ops.
UPDATE `metric_types`
SET `name` = 'custom:' || substr(`name`, length('csv_import:') + 1)
WHERE `name` LIKE 'csv_import:%';
--> statement-breakpoint
UPDATE `metrics`
SET `alias` = 'custom:' || substr(`alias`, length('csv_import:') + 1)
WHERE `alias` LIKE 'csv_import:%';
--> statement-breakpoint
UPDATE `metric_type_aliases`
SET `alias` = 'custom:' || substr(`alias`, length('csv_import:') + 1)
WHERE `alias` LIKE 'csv_import:%';
--> statement-breakpoint
UPDATE `metrics` SET `source` = 'custom' WHERE `source` = 'csv_import';
--> statement-breakpoint
UPDATE `events` SET `source` = 'custom' WHERE `source` = 'csv_import';
--> statement-breakpoint
UPDATE `metrics`
SET `source_id` = 'custom-' || substr(`source_id`, length('csv_import-') + 1)
WHERE `source_id` LIKE 'csv_import-%';
--> statement-breakpoint
UPDATE `events`
SET `source_id` = 'custom-' || substr(`source_id`, length('csv_import-') + 1)
WHERE `source_id` LIKE 'csv_import-%';
