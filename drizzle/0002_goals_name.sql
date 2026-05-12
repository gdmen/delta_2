-- Goals get an optional user-facing name. Existing rows stay NULL and
-- display the derived `<metric> <target><unit>` string at every render
-- site — the name is purely additive.
ALTER TABLE "goals" ADD COLUMN "name" text;
