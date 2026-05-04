-- Recovery: switch headlines from "latest" to "avg" so the trailing-7d
-- charts read as "compliance over the week" instead of "what was last
-- night". Same metrics, same window — just a different scoreboard number.

UPDATE `dashboard_widgets`
SET `config` = '{"title":"Last 7 days","columns":2,"metrics":[{"metric":"sleep_hours","title":"Sleep","fallbackUnit":"h","target":8,"windowDays":7,"headline":"avg"},{"metric":"protein_g","title":"Protein","fallbackUnit":"g","target":180,"windowDays":7,"headline":"avg"},{"metric":"water_oz","title":"Water","fallbackUnit":"oz","target":100,"windowDays":7,"headline":"avg"},{"metric":"fiber_g","title":"Fiber","fallbackUnit":"g","target":30,"windowDays":7,"headline":"avg"}]}'
WHERE `dashboard_id` IN (SELECT id FROM `dashboards` WHERE `seeded_id` = 'system:recovery')
  AND `widget_type` = 'metrics_grid';
