-- One-time snapshot reconciliation: drizzle-kit's snapshot stores text-enum
-- defaults as `'active'` (quoted) but SQLite's introspection reports them
-- as `active` (unquoted). Without this migration, every future generate cycle
-- emits the same rebuild ops as drift. The rebuilds are functional no-ops
-- (INSERT FROM SELECT preserves every column verbatim) but settle the drift
-- permanently — subsequent migrations should generate cleanly.
--
-- See PR1 review notes (commit 839d8b8) for the diagnosis.

PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_coach_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` text DEFAULT (datetime('now')) NOT NULL,
	`endpoint` text NOT NULL,
	`goal_id` integer,
	`tokens_in` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`model` text NOT NULL,
	`status` text DEFAULT 'success' NOT NULL,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_coach_calls`("id", "ts", "endpoint", "goal_id", "tokens_in", "tokens_out", "duration_ms", "model", "status") SELECT "id", "ts", "endpoint", "goal_id", "tokens_in", "tokens_out", "duration_ms", "model", "status" FROM `coach_calls`;--> statement-breakpoint
DROP TABLE `coach_calls`;--> statement-breakpoint
ALTER TABLE `__new_coach_calls` RENAME TO `coach_calls`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_coach_calls_ts` ON `coach_calls` (`ts`);--> statement-breakpoint
CREATE INDEX `idx_coach_calls_goal` ON `coach_calls` (`goal_id`);--> statement-breakpoint
CREATE TABLE `__new_focuses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`goal_id` integer NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`status` text DEFAULT 'active' NOT NULL,
	`technical_notes` text,
	`evidence` text,
	`dismissed_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_focuses`("id", "name", "goal_id", "source", "start_date", "end_date", "status", "technical_notes", "evidence", "dismissed_at", "created_at") SELECT "id", "name", "goal_id", "source", "start_date", "end_date", "status", "technical_notes", "evidence", "dismissed_at", "created_at" FROM `focuses`;--> statement-breakpoint
DROP TABLE `focuses`;--> statement-breakpoint
ALTER TABLE `__new_focuses` RENAME TO `focuses`;--> statement-breakpoint
CREATE INDEX `idx_focuses_goal_status` ON `focuses` (`goal_id`,`status`);--> statement-breakpoint
CREATE TABLE `__new_goal_journal_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`goal_id` integer NOT NULL,
	`content` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`verdict_focus_id` integer,
	`linked_metric_type_id` integer,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`verdict_focus_id`) REFERENCES `focuses`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`linked_metric_type_id`) REFERENCES `metric_types`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_goal_journal_entries`("id", "goal_id", "content", "created_at", "verdict_focus_id", "linked_metric_type_id") SELECT "id", "goal_id", "content", "created_at", "verdict_focus_id", "linked_metric_type_id" FROM `goal_journal_entries`;--> statement-breakpoint
DROP TABLE `goal_journal_entries`;--> statement-breakpoint
ALTER TABLE `__new_goal_journal_entries` RENAME TO `goal_journal_entries`;--> statement-breakpoint
CREATE INDEX `idx_goal_journal_goal_created` ON `goal_journal_entries` (`goal_id`,`created_at`);