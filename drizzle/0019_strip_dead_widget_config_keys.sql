-- Cleanup: strip the now-dead `fallbackUnit` key from seeded widget
-- configs. Older migrations (0014/0016/0017) baked it in before the
-- schema dropped it. Zod strips it on parse so the app didn't care,
-- but the JSON in the DB stayed dirty — confusing when inspecting,
-- and a footgun if a future export round-trip re-imports it.
--
-- Idempotent: rewrites both seeded configs to the canonical
-- post-cleanup shape. Re-running this migration on already-clean rows
-- is a no-op.

UPDATE `dashboard_widgets`
SET `config` = '{"title":"Body Composition","columns":2,"metrics":[{"metric":"bodyweight","title":"Weight"},{"metric":"body_fat_pct","title":"Body Fat %"},{"metric":"lean_mass","title":"Lean Mass"},{"metric":"fat_mass","title":"Fat Mass"},{"metric":"bone_mineral_density","title":"Bone Mineral Density"},{"metric":"visceral_fat_mass","title":"Visceral Fat"}]}'
WHERE `dashboard_id` IN (SELECT id FROM `dashboards` WHERE `seeded_id` = 'system:body-comp')
  AND `widget_type` = 'metrics_grid';
--> statement-breakpoint

UPDATE `dashboard_widgets`
SET `config` = '{"title":"Last 7 days","columns":2,"metrics":[{"metric":"sleep_hours","title":"Sleep","windowDays":7,"headline":"avg"},{"metric":"protein_g","title":"Protein","windowDays":7,"headline":"avg"},{"metric":"water_oz","title":"Water","windowDays":7,"headline":"avg"},{"metric":"fiber_g","title":"Fiber","windowDays":7,"headline":"avg"}]}'
WHERE `dashboard_id` IN (SELECT id FROM `dashboards` WHERE `seeded_id` = 'system:recovery')
  AND `widget_type` = 'metrics_grid';
