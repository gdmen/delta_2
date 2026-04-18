CREATE TABLE `event_metrics` (
	`event_id` integer NOT NULL,
	`metric_type_id` integer NOT NULL,
	`value` real NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`metric_type_id`) REFERENCES `metric_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_event_metrics_event_type` ON `event_metrics` (`event_id`,`metric_type_id`);