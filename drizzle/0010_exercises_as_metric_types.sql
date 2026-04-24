-- Promote exercises from text on workout_sets to rows in metric_types.
-- No kind column: a metric_type is just a named thing. The exercises tab
-- is derived from "metric_types that have workout_sets references."
-- Name collisions between an existing sampled metric and an exercise
-- share a row (INSERT OR IGNORE).

INSERT OR IGNORE INTO `metric_types` (`name`, `unit`, `frequency_hint`)
SELECT DISTINCT `exercise_name`, '', 'occasional'
FROM `workout_sets`;
--> statement-breakpoint
CREATE TABLE `workout_sets_new` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `event_id` integer NOT NULL,
  `exercise_metric_type_id` integer NOT NULL,
  `set_number` integer NOT NULL,
  `reps` integer NOT NULL,
  `weight` real NOT NULL,
  `rpe` real,
  `notes` text,
  FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`exercise_metric_type_id`) REFERENCES `metric_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `workout_sets_new` (`id`, `event_id`, `exercise_metric_type_id`, `set_number`, `reps`, `weight`, `rpe`, `notes`)
SELECT ws.`id`, ws.`event_id`, mt.`id`, ws.`set_number`, ws.`reps`, ws.`weight`, ws.`rpe`, ws.`notes`
FROM `workout_sets` ws
JOIN `metric_types` mt ON mt.`name` = ws.`exercise_name`;
--> statement-breakpoint
DROP TABLE `workout_sets`;
--> statement-breakpoint
ALTER TABLE `workout_sets_new` RENAME TO `workout_sets`;
--> statement-breakpoint
CREATE INDEX `idx_workout_sets_event` ON `workout_sets` (`event_id`);
--> statement-breakpoint
CREATE INDEX `idx_workout_sets_exercise_mt` ON `workout_sets` (`exercise_metric_type_id`);
