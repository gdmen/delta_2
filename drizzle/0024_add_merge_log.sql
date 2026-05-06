CREATE TABLE `merge_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`canonical_id` integer NOT NULL,
	`canonical_name` text NOT NULL,
	`merged_names` text NOT NULL,
	`payload` text NOT NULL,
	`undone_at` text,
	`user_id` integer
);
--> statement-breakpoint
CREATE INDEX `idx_merge_log_created_at` ON `merge_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_merge_log_user_id_created_at` ON `merge_log` (`user_id`,`created_at`);