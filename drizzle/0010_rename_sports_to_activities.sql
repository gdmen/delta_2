-- Rename `sports` table → `activities` and every `sport_id` FK → `activity_id`.
-- See issue #46. The activity-name values (powerlifting, bjj, run, ...) stay
-- as data; only the schema rename here.

ALTER TABLE "sports" RENAME TO "activities";
ALTER INDEX "sports_user_name_uniq" RENAME TO "activities_user_name_uniq";

ALTER TABLE "metric_types" RENAME COLUMN "sport_id" TO "activity_id";

ALTER TABLE "events" RENAME COLUMN "sport_id" TO "activity_id";
ALTER INDEX "idx_events_sport_started" RENAME TO "idx_events_activity_started";

ALTER TABLE "goals" RENAME COLUMN "sport_id" TO "activity_id";

ALTER TABLE "dashboards" RENAME COLUMN "sport_id" TO "activity_id";

-- The eight saved import_sources mappings store the activity key as
-- `"sport"` in their JSON. Move the value to the renamed key.
UPDATE "import_sources"
   SET "mapping" = ((mapping::jsonb - 'sport')
                    || jsonb_build_object('activity', mapping::jsonb -> 'sport'))::text
 WHERE mapping::jsonb ? 'sport';
