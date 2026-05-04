-- Tighten seeded grid_h for Recovery + Body Comp.
--
-- PR4 (0014) seeded metric_blocks at grid_h=3 and a metrics_grid at
-- grid_h=9, but the chart inside MetricBlock is rem-fixed and shorter
-- than 3 × 8rem row tracks, leaving large bands of whitespace below
-- each chart. Shrink to grid_h=2 (metric_block) and grid_h=6
-- (metrics_grid) so the cell hugs the content. Same chart, no waste.
--
-- Recovery still occupies rows 0-1 and 2-3 (two 2-row layouts side by
-- side). Body Comp's metrics_grid still has plenty of room for 6 charts
-- in 2 columns × 3 rows of inner content.

UPDATE `dashboard_widgets`
SET `grid_h` = 2,
    `grid_y` = CASE WHEN `grid_y` = 0 THEN 0 ELSE 2 END
WHERE `dashboard_id` IN (SELECT id FROM `dashboards` WHERE `seeded_id` = 'system:recovery')
  AND `widget_type` = 'metric_block';
--> statement-breakpoint

UPDATE `dashboard_widgets`
SET `grid_h` = 6
WHERE `dashboard_id` IN (SELECT id FROM `dashboards` WHERE `seeded_id` = 'system:body-comp')
  AND `widget_type` = 'metrics_grid';
