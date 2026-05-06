-- App-wide preferences (single row, id = 1). Inserted unconditionally
-- so RSC reads stay branchless. The `timezone` IANA name controls how
-- daily-aggregate metric filters compute "today" — without a value the
-- runtime falls back to the JS resolved TZ, which on a UTC server isn't
-- the user's local day.
--
-- Pre-seeded with `America/Los_Angeles` because that's the production
-- single-user's TZ as of 2026-05-05; any other deployer flips it on
-- first visit to /preferences. INSERT OR IGNORE makes re-runs idempotent.

CREATE TABLE `app_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`timezone` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO `app_settings` (`id`, `timezone`) VALUES (1, 'America/Los_Angeles');
