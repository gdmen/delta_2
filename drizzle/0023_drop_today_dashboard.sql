-- Remove the seeded "Today" dashboard. After this migration:
--   - The dashboards row with slug='today' is gone.
--   - Its dashboard_widgets cascade via FK (ON DELETE CASCADE).
--   - The home page (/) no longer renders Today; it redirects to the
--     first remaining dashboard by position. See src/app/page.tsx.
--
-- Idempotent: re-runs DELETE nothing once the row is gone.

DELETE FROM `dashboards` WHERE `slug` = 'today';
