-- Recovery: switch from 4 individual metric_blocks to one metrics_grid
-- on a 7-day trailing window. Same 4 metrics (sleep, protein, water,
-- fiber) but the shared time axis lets you scan compliance across all
-- four at once, and the 7d window hugs the JTBD ("how was last week").

DELETE FROM `dashboard_widgets`
WHERE `dashboard_id` IN (SELECT id FROM `dashboards` WHERE `seeded_id` = 'system:recovery');
--> statement-breakpoint

INSERT INTO `dashboard_widgets`
  (`dashboard_id`, `widget_type`, `config`, `grid_x`, `grid_y`, `grid_w`, `grid_h`, `position`)
SELECT id, 'metrics_grid',
       '{"title":"Last 7 days","columns":2,"metrics":[{"metric":"sleep_hours","title":"Sleep","fallbackUnit":"h","target":8,"windowDays":7},{"metric":"protein_g","title":"Protein","fallbackUnit":"g","target":180,"windowDays":7},{"metric":"water_oz","title":"Water","fallbackUnit":"oz","target":100,"windowDays":7},{"metric":"fiber_g","title":"Fiber","fallbackUnit":"g","target":30,"windowDays":7}]}',
       0, 0, 12, 4, 0
FROM `dashboards` WHERE `seeded_id` = 'system:recovery';
