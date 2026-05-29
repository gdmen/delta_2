import { db } from "./index";
import { metricTypes, activities, workoutSets } from "./schema";
import { eq, sql } from "drizzle-orm";
import { slugifyExercise } from "../lib/computed-metrics";

// Built-in metric_types are no longer seeded. Importers (Strava, Apple
// Health, BodySpec, CSV) all auto-create source-prefixed orphans on
// first ingest (`apple_health:sleep_hours`, `strava:distance_km`,
// `bodyspec_dexa:bodyweight`, etc.). The user merges them into their
// preferred canonical names via /data/metrics. This keeps the catalog
// driven entirely by what the user actually uses, instead of starting
// every DB with 21 rows that may or may not match the user's intent.
//
// Activities follow the same model: they auto-create on first import via
// src/lib/ingest/activity-resolver.ts as `<source>:<rawName>`; user merges
// into canonical names via /data/activities.
//
// Computed metric_types are still seeded — those are synthesized at
// read time from workout_sets and need a metric_types row to exist for
// the picker UI + goal FKs to work.

async function seed() {
  await seedComputedMetricTypes();

  console.log("Seed complete.");
}

/**
 * Auto-seed metric_types entries for the auto-computed metric families.
 * They have no underlying metrics rows — the resolver in computed-metrics.ts
 * synthesizes their values at read time. The metric_types row exists so:
 *   - the metric-picker shows them
 *   - goals can FK to them
 *   - target / higher-is-better edits via /data/metrics/<name> work
 *
 * Idempotent: re-running the seed is safe (INSERT OR IGNORE on the
 * unique-name index). Adding a new activity or starting to record a new
 * exercise will pick up its computed entries on the next seed run.
 */
async function seedComputedMetricTypes() {
  console.log("Seeding computed metric types...");

  const activityRows = await db.select({ id: activities.id, name: activities.name }).from(activities);
  for (const s of activityRows) {
    await db
      .insert(metricTypes)
      .values({
        name: `sport_sessions_count_${s.name}`,
        unit: "sessions",
        activityId: s.id,
        frequencyHint: "daily",
      })
      .onConflictDoNothing();
    await db
      .insert(metricTypes)
      .values({
        name: `sport_minutes_${s.name}`,
        unit: "min",
        activityId: s.id,
        frequencyHint: "daily",
      })
      .onConflictDoNothing();
  }

  // Distinct exercises: any metric_types row referenced by at least one
  // workout_set. New exercises picked up automatically on the next seed.
  const exerciseRows = await db
    .select({ id: metricTypes.id, name: metricTypes.name })
    .from(metricTypes)
    .innerJoin(workoutSets, eq(workoutSets.exerciseMetricTypeId, metricTypes.id))
    .groupBy(metricTypes.id, metricTypes.name)
    .having(sql`count(${workoutSets.id}) > 0`);

  const seenSlugs = new Set<string>();
  for (const ex of exerciseRows) {
    const slug = slugifyExercise(ex.name);
    if (!slug || seenSlugs.has(slug)) {
      // Empty slug or collision (different display names slugifying the
      // same way). Skip rather than risk a wrong association — the unique
      // index would reject anyway.
      continue;
    }
    seenSlugs.add(slug);
    for (const suffix of ["_max", "_max_12mo", "_e1rm", "_volume_per_day"]) {
      await db
        .insert(metricTypes)
        .values({
          name: `${slug}${suffix}`,
          unit: "lb",
          frequencyHint: "weekly",
        })
        .onConflictDoNothing();
    }
  }
}

// postgres-js keeps an open TCP pool that holds the event loop after
// the seed promise resolves. Force-exit so the script terminates and
// `timeout 60 npx tsx src/db/seed.ts` in scripts/deploy.sh doesn't get
// killed with exit 124.
seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
