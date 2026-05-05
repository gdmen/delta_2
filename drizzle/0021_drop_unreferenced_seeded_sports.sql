-- Drop the canonical seed sports rows from migration 0009 IF they have
-- zero references in events / goals / dashboards / metric_types.
--
-- Why scoped to the original 5 names (powerlifting, bjj, running,
-- hiking, biking): an unscoped "any orphan" delete would also wipe
-- user-customized rows (e.g. user added a `tennis` sport, edited its
-- color to teal, never logged a tennis event yet). Scoping to the seed
-- list ensures we only clean up defaults that came from 0009.
--
-- Idempotent: re-running on a populated DB where the user has events
-- for these sports leaves them intact. On a fresh DB after 0009 just
-- ran (no events yet), all 5 rows get cleaned up so the table starts
-- empty and first-import auto-creation populates it organically.

DELETE FROM `sports`
WHERE `name` IN ('powerlifting', 'bjj', 'running', 'hiking', 'biking')
  AND `id` NOT IN (SELECT `sport_id` FROM `events` WHERE `sport_id` IS NOT NULL)
  AND `id` NOT IN (SELECT `sport_id` FROM `goals` WHERE `sport_id` IS NOT NULL)
  AND `id` NOT IN (SELECT `sport_id` FROM `dashboards` WHERE `sport_id` IS NOT NULL)
  AND `id` NOT IN (SELECT `sport_id` FROM `metric_types` WHERE `sport_id` IS NOT NULL);
