-- Dedupe dashboard_widgets rows that share (dashboard_id, widget_type,
-- position). Caused by re-importing an export bundle on top of a
-- populated DB before the importer was made idempotent. Each dashboard
-- ended up rendering every widget twice.
--
-- Keep the lowest id per group (the original) and drop the rest.
-- Idempotent: re-running is a no-op once the table is clean.
DELETE FROM `dashboard_widgets`
WHERE `id` NOT IN (
  SELECT MIN(`id`) FROM `dashboard_widgets`
  GROUP BY `dashboard_id`, `widget_type`, `position`
);
