CREATE TABLE `coach_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`prompt_template_hash` text,
	`context_snapshot` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `daily_summaries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`metric_type_id` integer NOT NULL,
	`avg_value` real,
	`min_value` real,
	`max_value` real,
	`count` integer DEFAULT 0 NOT NULL,
	`last_ingest_at` text,
	FOREIGN KEY (`metric_type_id`) REFERENCES `metric_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_daily_summaries_date_metric` ON `daily_summaries` (`date`,`metric_type_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sport_id` integer NOT NULL,
	`type` text NOT NULL,
	`duration_minutes` integer,
	`notes` text,
	`started_at` text NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`source_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`sport_id`) REFERENCES `sports`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_events_sport_started` ON `events` (`sport_id`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_events_source_id` ON `events` (`source_id`);--> statement-breakpoint
CREATE TABLE `focus_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`focus_id` integer NOT NULL,
	`content` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`focus_id`) REFERENCES `focuses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `focus_metric_links` (
	`focus_id` integer NOT NULL,
	`metric_type_id` integer NOT NULL,
	FOREIGN KEY (`focus_id`) REFERENCES `focuses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`metric_type_id`) REFERENCES `metric_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_focus_metric_links` ON `focus_metric_links` (`focus_id`,`metric_type_id`);--> statement-breakpoint
CREATE TABLE `focuses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`sport_id` integer NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`status` text DEFAULT 'active' NOT NULL,
	`technical_notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`sport_id`) REFERENCES `sports`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `goals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`metric_type_id` integer NOT NULL,
	`sport_id` integer NOT NULL,
	`target_value` real NOT NULL,
	`deadline` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`metric_type_id`) REFERENCES `metric_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sport_id`) REFERENCES `sports`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ingest_configs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`api_key_encrypted` text,
	`last_sync_at` text,
	`enabled` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingest_configs_source_unique` ON `ingest_configs` (`source`);--> statement-breakpoint
CREATE TABLE `metric_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`sport_id` integer,
	`unit` text NOT NULL,
	`frequency_hint` text DEFAULT 'daily' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`sport_id`) REFERENCES `sports`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `metric_types_name_unique` ON `metric_types` (`name`);--> statement-breakpoint
CREATE TABLE `metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`metric_type_id` integer NOT NULL,
	`value` real NOT NULL,
	`recorded_at` text NOT NULL,
	`source` text NOT NULL,
	`source_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`metric_type_id`) REFERENCES `metric_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_metrics_type_recorded` ON `metrics` (`metric_type_id`,`recorded_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_metrics_source_id` ON `metrics` (`source_id`);--> statement-breakpoint
CREATE TABLE `sports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sports_name_unique` ON `sports` (`name`);--> statement-breakpoint
CREATE TABLE `workout_sets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`exercise_name` text NOT NULL,
	`set_number` integer NOT NULL,
	`reps` integer NOT NULL,
	`weight` real NOT NULL,
	`rpe` real,
	`notes` text,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_workout_sets_event` ON `workout_sets` (`event_id`);--> statement-breakpoint
CREATE INDEX `idx_workout_sets_exercise` ON `workout_sets` (`exercise_name`);