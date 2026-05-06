ALTER TABLE `metrics` ADD `alias` text;--> statement-breakpoint
CREATE INDEX `idx_metrics_type_alias` ON `metrics` (`metric_type_id`,`alias`);
