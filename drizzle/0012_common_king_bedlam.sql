-- Configurable dashboards. Two new tables (dashboards, dashboard_widgets) plus
-- seed data for the three system dashboards (Today, Recovery, Body Comp).
--
-- See docs/designs/configurable-dashboards.md for the full spec.
--
-- Drizzle's generator emitted spurious __new_focuses / __new_goal_journal_entries
-- / __new_coach_calls rebuild ops alongside these inserts. Those rebuilds are
-- no-ops (the SQL re-emits the same shape with INSERT FROM SELECT), but on a
-- real DB they're an unnecessary risk. Stripped. The drizzle snapshot still
-- reflects the schema accurately because the schema.ts content matches.

CREATE TABLE `dashboards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`icon` text,
	`sport_id` integer,
	`position` integer DEFAULT 0 NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`seeded_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`sport_id`) REFERENCES `sports`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dashboards_slug_unique` ON `dashboards` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `dashboards_seeded_id_unique` ON `dashboards` (`seeded_id`);--> statement-breakpoint
CREATE INDEX `idx_dashboards_position` ON `dashboards` (`position`);--> statement-breakpoint

CREATE TABLE `dashboard_widgets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dashboard_id` integer NOT NULL,
	`widget_type` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`body` text,
	`grid_x` integer DEFAULT 0 NOT NULL,
	`grid_y` integer DEFAULT 0 NOT NULL,
	`grid_w` integer DEFAULT 12 NOT NULL,
	`grid_h` integer DEFAULT 2 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`dashboard_id`) REFERENCES `dashboards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_dashboard_widgets_dashboard_position` ON `dashboard_widgets` (`dashboard_id`,`position`);--> statement-breakpoint

-- Seed: three system dashboards. INSERT OR IGNORE on seeded_id so the seed
-- is idempotent across renames (renaming "Today" to "Home" doesn't trigger a
-- re-insert).

INSERT OR IGNORE INTO `dashboards` (`slug`, `name`, `position`, `is_system`, `seeded_id`)
VALUES ('today', 'Today', 0, true, 'system:today');
--> statement-breakpoint
INSERT OR IGNORE INTO `dashboards` (`slug`, `name`, `position`, `is_system`, `seeded_id`)
VALUES ('recovery', 'Recovery', 1, true, 'system:recovery');
--> statement-breakpoint
INSERT OR IGNORE INTO `dashboards` (`slug`, `name`, `position`, `is_system`, `seeded_id`)
VALUES ('body-comp', 'Body Comp', 2, true, 'system:body-comp');
--> statement-breakpoint

-- Seed: widgets for the three system dashboards. Each widget references the
-- dashboard via subquery on seeded_id (stable across DBs and renames).
--
-- Today: metric_strip with sleep/weight/protein/sessions/hrv, focus_list,
-- goal_list. Mirrors current src/app/page.tsx layout.

INSERT OR IGNORE INTO `dashboard_widgets`
  (`dashboard_id`, `widget_type`, `config`, `grid_x`, `grid_y`, `grid_w`, `grid_h`, `position`)
SELECT id, 'metric_strip',
       '{"metrics":[{"label":"Sleep","metric":"sleep_hours","mode":"avg7","format":"hours"},{"label":"Weight","metric":"bodyweight","mode":"latest","format":"raw"},{"label":"Protein","metric":"protein_g","mode":"avg7","format":"int","unit":"g"},{"label":"Sessions","metric":"sessions_this_week","mode":"raw","format":"int"},{"label":"HRV","metric":"hrv_ms","mode":"latest","format":"int","unit":"ms","delta":"latest"}]}',
       0, 0, 12, 1, 0
FROM `dashboards` WHERE `seeded_id` = 'system:today';
--> statement-breakpoint
INSERT OR IGNORE INTO `dashboard_widgets`
  (`dashboard_id`, `widget_type`, `config`, `grid_x`, `grid_y`, `grid_w`, `grid_h`, `position`)
SELECT id, 'focus_list', '{"sportFilter":null,"sourceFilter":"manual"}',
       0, 1, 6, 3, 1
FROM `dashboards` WHERE `seeded_id` = 'system:today';
--> statement-breakpoint
INSERT OR IGNORE INTO `dashboard_widgets`
  (`dashboard_id`, `widget_type`, `config`, `grid_x`, `grid_y`, `grid_w`, `grid_h`, `position`)
SELECT id, 'goal_list', '{"sportFilter":null}',
       6, 1, 6, 3, 2
FROM `dashboards` WHERE `seeded_id` = 'system:today';
--> statement-breakpoint

-- Recovery: placeholder seed. Real Recovery layout migrates in PR4 when the
-- recovery widgets ship; for PR1 the page just exists so nav doesn't 404.

INSERT OR IGNORE INTO `dashboard_widgets`
  (`dashboard_id`, `widget_type`, `config`, `grid_x`, `grid_y`, `grid_w`, `grid_h`, `position`)
SELECT id, 'metric_strip',
       '{"metrics":[{"label":"HRV","metric":"hrv_ms","mode":"avg7","format":"int"},{"label":"Sleep","metric":"sleep_hours","mode":"avg7","format":"hours"},{"label":"RHR","metric":"resting_heart_rate","mode":"avg7","format":"int"}]}',
       0, 0, 12, 1, 0
FROM `dashboards` WHERE `seeded_id` = 'system:recovery';
--> statement-breakpoint

-- Body Comp: placeholder seed. Real metrics_grid layout migrates in PR4.

INSERT OR IGNORE INTO `dashboard_widgets`
  (`dashboard_id`, `widget_type`, `config`, `grid_x`, `grid_y`, `grid_w`, `grid_h`, `position`)
SELECT id, 'metric_strip',
       '{"metrics":[{"label":"Weight","metric":"bodyweight","mode":"latest","format":"raw"},{"label":"Body Fat %","metric":"body_fat_pct","mode":"latest","format":"raw"}]}',
       0, 0, 12, 1, 0
FROM `dashboards` WHERE `seeded_id` = 'system:body-comp';
