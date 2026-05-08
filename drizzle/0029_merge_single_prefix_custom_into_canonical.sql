-- Cleanup of single-prefix `custom:<name>` orphans whose unprefixed
-- canonical `<name>` exists as a separate metric_type. Same root
-- cause as 0028: round-trip imports through the legacy bulk endpoint
-- (pre-identity-map fix in 6e80490) created `custom:sleep_hours`
-- as an orphan even though `sleep_hours` already existed as the HAE
-- canonical. 0028 only handled the doubly-prefixed shape
-- (`custom:bodyspec_dexa:bodyweight`); this migration mops up the
-- single-prefix collisions that survived.
--
-- Skips `custom:foo` rows where `foo` does NOT exist as a separate
-- metric_type — those are legitimate user-named metrics tagged with
-- the custom-source sentinel and should be left alone.
--
-- Idempotent (UPDATE/DELETE only, all gated on the join existing).

-- Re-point metrics from each orphan to its matching canonical.
-- metrics.source_id is UNIQUE but doesn't include metric_type_id, so
-- this can't violate a constraint.
UPDATE `metrics`
SET `metric_type_id` = (
  SELECT canonical.id FROM `metric_types` AS orphan
  INNER JOIN `metric_types` AS canonical
    ON canonical.name = substr(orphan.name, length('custom:') + 1)
  WHERE orphan.id = `metrics`.`metric_type_id`
)
WHERE `metric_type_id` IN (
  SELECT orphan.id FROM `metric_types` AS orphan
  INNER JOIN `metric_types` AS canonical
    ON canonical.name = substr(orphan.name, length('custom:') + 1)
  WHERE orphan.name LIKE 'custom:%'
);
--> statement-breakpoint

-- event_metrics has UNIQUE(event_id, metric_type_id). Pre-delete
-- orphan rows that would collide.
DELETE FROM `event_metrics`
WHERE rowid IN (
  SELECT em.rowid FROM `event_metrics` AS em
  INNER JOIN `metric_types` AS orphan ON orphan.id = em.metric_type_id
  INNER JOIN `metric_types` AS canonical
    ON canonical.name = substr(orphan.name, length('custom:') + 1)
  WHERE orphan.name LIKE 'custom:%'
    AND EXISTS (
      SELECT 1 FROM `event_metrics` em2
      WHERE em2.event_id = em.event_id
        AND em2.metric_type_id = canonical.id
    )
);
--> statement-breakpoint

-- Re-point event_metrics survivors.
UPDATE `event_metrics`
SET `metric_type_id` = (
  SELECT canonical.id FROM `metric_types` AS orphan
  INNER JOIN `metric_types` AS canonical
    ON canonical.name = substr(orphan.name, length('custom:') + 1)
  WHERE orphan.id = `event_metrics`.`metric_type_id`
)
WHERE `metric_type_id` IN (
  SELECT orphan.id FROM `metric_types` AS orphan
  INNER JOIN `metric_types` AS canonical
    ON canonical.name = substr(orphan.name, length('custom:') + 1)
  WHERE orphan.name LIKE 'custom:%'
);
--> statement-breakpoint

-- workout_sets has no unique constraint that conflicts.
UPDATE `workout_sets`
SET `exercise_metric_type_id` = (
  SELECT canonical.id FROM `metric_types` AS orphan
  INNER JOIN `metric_types` AS canonical
    ON canonical.name = substr(orphan.name, length('custom:') + 1)
  WHERE orphan.id = `workout_sets`.`exercise_metric_type_id`
)
WHERE `exercise_metric_type_id` IN (
  SELECT orphan.id FROM `metric_types` AS orphan
  INNER JOIN `metric_types` AS canonical
    ON canonical.name = substr(orphan.name, length('custom:') + 1)
  WHERE orphan.name LIKE 'custom:%'
);
--> statement-breakpoint

-- Goals (NOT NULL FK).
UPDATE `goals`
SET `metric_type_id` = (
  SELECT canonical.id FROM `metric_types` AS orphan
  INNER JOIN `metric_types` AS canonical
    ON canonical.name = substr(orphan.name, length('custom:') + 1)
  WHERE orphan.id = `goals`.`metric_type_id`
)
WHERE `metric_type_id` IN (
  SELECT orphan.id FROM `metric_types` AS orphan
  INNER JOIN `metric_types` AS canonical
    ON canonical.name = substr(orphan.name, length('custom:') + 1)
  WHERE orphan.name LIKE 'custom:%'
);
--> statement-breakpoint

-- goal_journal_entries.linked_metric_type_id (nullable FK).
UPDATE `goal_journal_entries`
SET `linked_metric_type_id` = (
  SELECT canonical.id FROM `metric_types` AS orphan
  INNER JOIN `metric_types` AS canonical
    ON canonical.name = substr(orphan.name, length('custom:') + 1)
  WHERE orphan.id = `goal_journal_entries`.`linked_metric_type_id`
)
WHERE `linked_metric_type_id` IN (
  SELECT orphan.id FROM `metric_types` AS orphan
  INNER JOIN `metric_types` AS canonical
    ON canonical.name = substr(orphan.name, length('custom:') + 1)
  WHERE orphan.name LIKE 'custom:%'
);
--> statement-breakpoint

-- Aliases pointing AT the orphan (from prior merges) get re-pointed
-- to the canonical so the routing those aliases established stays
-- intact after the orphan is deleted.
UPDATE `metric_type_aliases`
SET `canonical_metric_type_id` = (
  SELECT canonical.id FROM `metric_types` AS orphan
  INNER JOIN `metric_types` AS canonical
    ON canonical.name = substr(orphan.name, length('custom:') + 1)
  WHERE orphan.id = `metric_type_aliases`.`canonical_metric_type_id`
)
WHERE `canonical_metric_type_id` IN (
  SELECT orphan.id FROM `metric_types` AS orphan
  INNER JOIN `metric_types` AS canonical
    ON canonical.name = substr(orphan.name, length('custom:') + 1)
  WHERE orphan.name LIKE 'custom:%'
);
--> statement-breakpoint

-- daily_summaries: drop orphan rows. The canonical's daily_summaries
-- are authoritative and (via 0024+) recompute on next ingest if stale.
DELETE FROM `daily_summaries`
WHERE `metric_type_id` IN (
  SELECT orphan.id FROM `metric_types` AS orphan
  INNER JOIN `metric_types` AS canonical
    ON canonical.name = substr(orphan.name, length('custom:') + 1)
  WHERE orphan.name LIKE 'custom:%'
);
--> statement-breakpoint

-- Drop the orphans. Self-prefix aliases pointing to them
-- (`custom:foo` aliased to itself) cascade-delete via the FK.
DELETE FROM `metric_types`
WHERE `name` LIKE 'custom:%'
  AND EXISTS (
    SELECT 1 FROM `metric_types` AS canonical
    WHERE canonical.name = substr(`metric_types`.name, length('custom:') + 1)
  );
