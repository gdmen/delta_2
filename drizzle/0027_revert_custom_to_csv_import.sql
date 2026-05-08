-- Revert 0026's `custom` rename: the `csv_import` sentinel is the
-- one the codebase has used since the original CSV import endpoint
-- shipped (commit 0c6db51, 2026-04-17). The earlier rename was an
-- aesthetic call that turned out to be unwanted; this migration
-- flips the data back. Idempotent (UPDATE-only).
UPDATE `metric_types`
SET `name` = 'csv_import:' || substr(`name`, length('custom:') + 1)
WHERE `name` LIKE 'custom:%';
--> statement-breakpoint
UPDATE `metrics`
SET `alias` = 'csv_import:' || substr(`alias`, length('custom:') + 1)
WHERE `alias` LIKE 'custom:%';
--> statement-breakpoint
UPDATE `metric_type_aliases`
SET `alias` = 'csv_import:' || substr(`alias`, length('custom:') + 1)
WHERE `alias` LIKE 'custom:%';
--> statement-breakpoint
UPDATE `metrics` SET `source` = 'csv_import' WHERE `source` = 'custom';
--> statement-breakpoint
UPDATE `events` SET `source` = 'csv_import' WHERE `source` = 'custom';
--> statement-breakpoint
UPDATE `metrics`
SET `source_id` = 'csv_import-' || substr(`source_id`, length('custom-') + 1)
WHERE `source_id` LIKE 'custom-%';
--> statement-breakpoint
UPDATE `events`
SET `source_id` = 'csv_import-' || substr(`source_id`, length('custom-') + 1)
WHERE `source_id` LIKE 'custom-%';
