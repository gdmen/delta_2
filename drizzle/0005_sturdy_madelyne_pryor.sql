CREATE TABLE `reconcile_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`kind` text NOT NULL,
	`metric_type_id` integer,
	`deleted_count` integer NOT NULL,
	`range_start` text NOT NULL,
	`range_end` text NOT NULL,
	`at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_reconcile_log_source_at` ON `reconcile_log` (`source`,`at`);--> statement-breakpoint
CREATE TABLE `source_settings` (
	`source` text PRIMARY KEY NOT NULL,
	`reconcile_enabled` integer DEFAULT false NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
