-- Promote focuses to live INSIDE goals; replace focus_entries with a per-goal
-- markdown journal; drop the dormant coach chat table; track LLM call metadata
-- in coach_calls. See ~/.gstack/projects/delta_2/ceo-plans/2026-04-28-goals-omnibus.md
-- for the full spec.
--
-- Order matters: child tables drop first (they FK into focuses), then we copy
-- focus_entries content into goal_journal_entries (still need focuses.goal_id
-- for that copy), then drop focus_entries / focus_metric_links / coach_messages,
-- then rebuild focuses with sport_id removed and goal_id NOT NULL, then create
-- the new tables (goal_journal_entries, coach_calls).

-- Step 1: create goal_journal_entries (target table for focus_entries copy)
CREATE TABLE `goal_journal_entries` (
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
CREATE INDEX `idx_goal_journal_goal_created` ON `goal_journal_entries` (`goal_id`, `created_at` DESC);
--> statement-breakpoint

-- Step 2: copy focus_entries content into goal_journal_entries via the focus's goal_id.
-- Entries on focuses with NULL goal_id (orphans) are dropped. Current data: 0 orphans,
-- so this is a clean copy.
INSERT INTO `goal_journal_entries` (`goal_id`, `content`, `created_at`)
SELECT f.`goal_id`, fe.`content`, fe.`created_at`
FROM `focus_entries` fe
JOIN `focuses` f ON f.`id` = fe.`focus_id`
WHERE f.`goal_id` IS NOT NULL;
--> statement-breakpoint

-- Step 3: drop dead and dependent tables.
-- coach_messages: dormant since coach chat removal (commit f709eb1).
-- focus_entries / focus_metric_links: replaced by per-goal journal + LLM evidence trail.
DROP TABLE `coach_messages`;
--> statement-breakpoint
DROP TABLE `focus_entries`;
--> statement-breakpoint
DROP TABLE `focus_metric_links`;
--> statement-breakpoint

-- Step 4: rebuild focuses. Drop sport_id (reachable via goal), make goal_id NOT NULL,
-- add source ('manual' | 'llm') + evidence (json) + dismissed_at. technical_notes stays
-- as a free-text optional field for manual focuses.
CREATE TABLE `focuses_new` (
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
  FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE cascade,
  CHECK (`source` IN ('manual', 'llm')),
  CHECK (`status` IN ('active', 'completed', 'abandoned'))
);
--> statement-breakpoint
INSERT INTO `focuses_new` (`id`, `name`, `goal_id`, `source`, `start_date`, `end_date`, `status`, `technical_notes`, `created_at`)
SELECT `id`, `name`, `goal_id`, 'manual', `start_date`, `end_date`, `status`, `technical_notes`, `created_at`
FROM `focuses`
WHERE `goal_id` IS NOT NULL;
--> statement-breakpoint
DROP TABLE `focuses`;
--> statement-breakpoint
ALTER TABLE `focuses_new` RENAME TO `focuses`;
--> statement-breakpoint
CREATE INDEX `idx_focuses_goal_status` ON `focuses` (`goal_id`, `status`);
--> statement-breakpoint

-- Step 5: coach_calls: per-LLM-call metadata for cost tracking + debugging.
-- goal_id is nullable because some endpoints (e.g. cross-goal summaries later)
-- aren't tied to a single goal. status records whether the call succeeded.
CREATE TABLE `coach_calls` (
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
CREATE INDEX `idx_coach_calls_ts` ON `coach_calls` (`ts` DESC);
--> statement-breakpoint
CREATE INDEX `idx_coach_calls_goal` ON `coach_calls` (`goal_id`);
