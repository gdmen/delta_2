-- Two-step cleanup:
--   (a) Merge each `csv_import:<existing-prefix>:<name>` orphan into
--       the existing `<existing-prefix>:<name>` canonical, moving all
--       attached data and dropping the orphan row. These were created
--       by the legacy bulk-import endpoint when it lost its identity
--       map (commit 8793ac7) and round-trip imports of exported
--       bundles re-orphaned every metric_type under a `csv_import:`
--       prefix on top of its existing one.
--   (b) Rename the remaining single-prefix `csv_import:*` rows to
--       `custom:*` so the on-disk sentinel matches the user-facing
--       choice.
--
-- Idempotent: re-running is a no-op once 0028 has applied (no rows
-- match the LIKE filters anymore). Skips rows where the merge would
-- collide with goals/aliases on the orphan (none exist in practice;
-- a simple WHERE NOT EXISTS guards just in case).

-- ============================================================
-- (a) Merge doubly-prefixed orphans into existing canonicals
-- ============================================================

-- Re-point metrics rows from orphan to canonical. metrics.source_id
-- is UNIQUE but doesn't include metric_type_id, so re-pointing
-- can't violate that constraint.
UPDATE `metrics`
SET `metric_type_id` = (
  SELECT canonical.id FROM `metric_types` AS orphan
  INNER JOIN `metric_types` AS canonical
    ON canonical.name = substr(orphan.name, length('csv_import:') + 1)
  WHERE orphan.id = `metrics`.`metric_type_id`
)
WHERE `metric_type_id` IN (
  SELECT id FROM `metric_types` WHERE name LIKE 'csv_import:%:%'
);
--> statement-breakpoint

-- event_metrics has UNIQUE(event_id, metric_type_id). Pre-delete
-- orphan rows that would collide with canonical's existing rows for
-- the same event.
DELETE FROM `event_metrics`
WHERE rowid IN (
  SELECT em.rowid FROM `event_metrics` AS em
  INNER JOIN `metric_types` AS orphan ON orphan.id = em.metric_type_id
  INNER JOIN `metric_types` AS canonical
    ON canonical.name = substr(orphan.name, length('csv_import:') + 1)
  WHERE orphan.name LIKE 'csv_import:%:%'
    AND EXISTS (
      SELECT 1 FROM `event_metrics` em2
      WHERE em2.event_id = em.event_id
        AND em2.metric_type_id = canonical.id
    )
);
--> statement-breakpoint

-- Then re-point the survivors.
UPDATE `event_metrics`
SET `metric_type_id` = (
  SELECT canonical.id FROM `metric_types` AS orphan
  INNER JOIN `metric_types` AS canonical
    ON canonical.name = substr(orphan.name, length('csv_import:') + 1)
  WHERE orphan.id = `event_metrics`.`metric_type_id`
)
WHERE `metric_type_id` IN (
  SELECT id FROM `metric_types` WHERE name LIKE 'csv_import:%:%'
);
--> statement-breakpoint

-- workout_sets has no unique on (event, exercise, set#) so straight retarget.
UPDATE `workout_sets`
SET `exercise_metric_type_id` = (
  SELECT canonical.id FROM `metric_types` AS orphan
  INNER JOIN `metric_types` AS canonical
    ON canonical.name = substr(orphan.name, length('csv_import:') + 1)
  WHERE orphan.id = `workout_sets`.`exercise_metric_type_id`
)
WHERE `exercise_metric_type_id` IN (
  SELECT id FROM `metric_types` WHERE name LIKE 'csv_import:%:%'
);
--> statement-breakpoint

-- goals.metric_type_id (NOT NULL FK). No goals point at orphans in
-- the surveyed data, but be defensive — re-point if any sneak in.
UPDATE `goals`
SET `metric_type_id` = (
  SELECT canonical.id FROM `metric_types` AS orphan
  INNER JOIN `metric_types` AS canonical
    ON canonical.name = substr(orphan.name, length('csv_import:') + 1)
  WHERE orphan.id = `goals`.`metric_type_id`
)
WHERE `metric_type_id` IN (
  SELECT id FROM `metric_types` WHERE name LIKE 'csv_import:%:%'
);
--> statement-breakpoint

-- goal_journal_entries.linked_metric_type_id is nullable; re-point
-- if any pinned to an orphan.
UPDATE `goal_journal_entries`
SET `linked_metric_type_id` = (
  SELECT canonical.id FROM `metric_types` AS orphan
  INNER JOIN `metric_types` AS canonical
    ON canonical.name = substr(orphan.name, length('csv_import:') + 1)
  WHERE orphan.id = `goal_journal_entries`.`linked_metric_type_id`
)
WHERE `linked_metric_type_id` IN (
  SELECT id FROM `metric_types` WHERE name LIKE 'csv_import:%:%'
);
--> statement-breakpoint

-- daily_summaries: drop the orphan rows. The canonical's
-- daily_summaries are authoritative; orphan rows would FK-block
-- the metric_type delete and aren't needed (next ingest into the
-- canonical refreshes them).
DELETE FROM `daily_summaries`
WHERE `metric_type_id` IN (
  SELECT id FROM `metric_types` WHERE name LIKE 'csv_import:%:%'
);
--> statement-breakpoint

-- Drop the orphan metric_types. Self-prefix aliases (anything
-- pointing AT the orphan) cascade-delete via the FK.
DELETE FROM `metric_types` WHERE `name` LIKE 'csv_import:%:%';
--> statement-breakpoint

-- ============================================================
-- (b) Rename the remaining single-prefix csv_import:* → custom:*
-- ============================================================

UPDATE `metric_types`
SET `name` = 'custom:' || substr(`name`, length('csv_import:') + 1)
WHERE `name` LIKE 'csv_import:%';
--> statement-breakpoint

UPDATE `metrics`
SET `alias` = 'custom:' || substr(`alias`, length('csv_import:') + 1)
WHERE `alias` LIKE 'csv_import:%';
--> statement-breakpoint

UPDATE `metric_type_aliases`
SET `alias` = 'custom:' || substr(`alias`, length('csv_import:') + 1)
WHERE `alias` LIKE 'csv_import:%';
--> statement-breakpoint

UPDATE `metrics` SET `source` = 'custom' WHERE `source` = 'csv_import';
--> statement-breakpoint

UPDATE `events` SET `source` = 'custom' WHERE `source` = 'csv_import';
--> statement-breakpoint

UPDATE `metrics`
SET `source_id` = 'custom-' || substr(`source_id`, length('csv_import-') + 1)
WHERE `source_id` LIKE 'csv_import-%';
--> statement-breakpoint

UPDATE `events`
SET `source_id` = 'custom-' || substr(`source_id`, length('csv_import-') + 1)
WHERE `source_id` LIKE 'csv_import-%';
