-- PR4: rewrite Recovery + Body Comp seeds with real widgets.
--
-- PR1 shipped placeholder metric_strips so the dashboards rendered without
-- 404'ing. PR4 added the proper widget set (metric_block, metrics_grid),
-- so we replace the placeholders with the layouts the deleted hand-coded
-- pages used to render. Today dashboard is unchanged — its layout already
-- matches the original /page.tsx.
--
-- The DELETE is the idempotency mechanism: clear all widgets for the two
-- system dashboards, then re-insert the new layout. We accept that this
-- overwrites any user customizations to Recovery/Body Comp made between
-- PR3 (editor shipped) and this migration. Today dashboard is untouched.
-- Drizzle's journal prevents accidental re-application; running this SQL
-- by hand a second time would duplicate the inserts.

DELETE FROM `dashboard_widgets`
WHERE `dashboard_id` IN (
  SELECT id FROM `dashboards` WHERE `seeded_id` IN ('system:recovery', 'system:body-comp')
);
--> statement-breakpoint

-- Recovery: 4 metric_blocks at 30-day window with targets. Mirrors the
-- deleted src/app/recovery/page.tsx. 2-up grid (w=6 each) on desktop.

INSERT INTO `dashboard_widgets`
  (`dashboard_id`, `widget_type`, `config`, `grid_x`, `grid_y`, `grid_w`, `grid_h`, `position`)
SELECT id, 'metric_block',
       '{"metric":"sleep_hours","title":"Sleep","fallbackUnit":"h","target":8,"windowDays":30}',
       0, 0, 6, 3, 0
FROM `dashboards` WHERE `seeded_id` = 'system:recovery';
--> statement-breakpoint
INSERT INTO `dashboard_widgets`
  (`dashboard_id`, `widget_type`, `config`, `grid_x`, `grid_y`, `grid_w`, `grid_h`, `position`)
SELECT id, 'metric_block',
       '{"metric":"protein_g","title":"Protein","fallbackUnit":"g","target":180,"windowDays":30}',
       6, 0, 6, 3, 1
FROM `dashboards` WHERE `seeded_id` = 'system:recovery';
--> statement-breakpoint
INSERT INTO `dashboard_widgets`
  (`dashboard_id`, `widget_type`, `config`, `grid_x`, `grid_y`, `grid_w`, `grid_h`, `position`)
SELECT id, 'metric_block',
       '{"metric":"water_oz","title":"Water","fallbackUnit":"oz","target":100,"windowDays":30}',
       0, 3, 6, 3, 2
FROM `dashboards` WHERE `seeded_id` = 'system:recovery';
--> statement-breakpoint
INSERT INTO `dashboard_widgets`
  (`dashboard_id`, `widget_type`, `config`, `grid_x`, `grid_y`, `grid_w`, `grid_h`, `position`)
SELECT id, 'metric_block',
       '{"metric":"fiber_g","title":"Fiber","fallbackUnit":"g","target":30,"windowDays":30}',
       6, 3, 6, 3, 3
FROM `dashboards` WHERE `seeded_id` = 'system:recovery';
--> statement-breakpoint

-- Body Comp: single metrics_grid with 6 charts sharing one time axis.
-- The shared-axis behavior is exactly why metrics_grid exists — it's
-- what made the deleted body-comp page useful (read inflections across
-- weight + body fat + lean mass at the same vertical line).

INSERT INTO `dashboard_widgets`
  (`dashboard_id`, `widget_type`, `config`, `grid_x`, `grid_y`, `grid_w`, `grid_h`, `position`)
SELECT id, 'metrics_grid',
       '{"title":"Body Composition","columns":2,"metrics":[{"metric":"bodyweight","title":"Weight","fallbackUnit":"lb"},{"metric":"body_fat_pct","title":"Body Fat %","fallbackUnit":"%"},{"metric":"lean_mass","title":"Lean Mass","fallbackUnit":"lb"},{"metric":"fat_mass","title":"Fat Mass","fallbackUnit":"lb"},{"metric":"bone_mineral_density","title":"Bone Mineral Density","fallbackUnit":"g/cm²"},{"metric":"visceral_fat_mass","title":"Visceral Fat","fallbackUnit":"lb"}]}',
       0, 0, 12, 9, 0
FROM `dashboards` WHERE `seeded_id` = 'system:body-comp';
