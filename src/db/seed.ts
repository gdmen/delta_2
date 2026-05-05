import { db } from "./index";
import { sports, metricTypes, workoutSets } from "./schema";
import { eq, sql } from "drizzle-orm";
import { slugifyExercise } from "../lib/computed-metrics";

// NOTE: Delta's canonical metric_types are also seeded by migration
// 0006_redundant_bullseye.sql so every DB has them regardless of whether
// this script is run. Keep the two lists in sync when adding canonicals.

const SPORTS = [
  { name: "powerlifting", color: "#2563eb" },
  { name: "bjj", color: "#db2777" },
  { name: "running", color: "#059669" },
  { name: "hiking", color: "#7c3aed" },
  { name: "biking", color: "#d97706" },
];

const METRIC_TYPES = [
  { name: "bench_1rm", unit: "lb", frequencyHint: "weekly" as const },
  { name: "squat_1rm", unit: "lb", frequencyHint: "weekly" as const },
  { name: "deadlift_1rm", unit: "lb", frequencyHint: "weekly" as const },
  { name: "bodyweight", unit: "lb", frequencyHint: "daily" as const },
  { name: "body_fat_pct", unit: "%", frequencyHint: "occasional" as const },
  { name: "lean_mass", unit: "lb", frequencyHint: "occasional" as const },
  { name: "fat_mass", unit: "lb", frequencyHint: "occasional" as const },
  { name: "bone_mineral_density", unit: "g/cm²", frequencyHint: "occasional" as const },
  { name: "visceral_fat_mass", unit: "lb", frequencyHint: "occasional" as const },
  { name: "sleep_hours", unit: "h", frequencyHint: "daily" as const },
  { name: "sleep_deep_hours", unit: "h", frequencyHint: "daily" as const },
  { name: "sleep_rem_hours", unit: "h", frequencyHint: "daily" as const },
  { name: "hrv_ms", unit: "ms", frequencyHint: "daily" as const },
  { name: "resting_hr", unit: "bpm", frequencyHint: "daily" as const },
  { name: "protein_g", unit: "g", frequencyHint: "daily" as const },
  { name: "water_oz", unit: "oz", frequencyHint: "daily" as const },
  { name: "fiber_g", unit: "g", frequencyHint: "daily" as const },
  { name: "active_energy_kcal", unit: "kcal", frequencyHint: "daily" as const },
  { name: "steps", unit: "steps", frequencyHint: "daily" as const },
  { name: "vo2_max", unit: "mL/kg/min", frequencyHint: "weekly" as const },
  { name: "distance_km", unit: "km", frequencyHint: "occasional" as const },
  { name: "elevation_gain_m", unit: "m", frequencyHint: "occasional" as const },
  { name: "avg_hr", unit: "bpm", frequencyHint: "occasional" as const },
  { name: "max_hr", unit: "bpm", frequencyHint: "occasional" as const },
];

async function seed() {
  console.log("Seeding sports...");
  for (const sport of SPORTS) {
    await db.insert(sports).values(sport).onConflictDoNothing();
  }

  console.log("Seeding metric types...");
  for (const mt of METRIC_TYPES) {
    await db.insert(metricTypes).values(mt).onConflictDoNothing();
  }

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
 * unique-name index). Adding a new sport or starting to record a new
 * exercise will pick up its computed entries on the next seed run.
 */
async function seedComputedMetricTypes() {
  console.log("Seeding computed metric types...");

  const sportRows = await db.select({ id: sports.id, name: sports.name }).from(sports);
  for (const s of sportRows) {
    await db
      .insert(metricTypes)
      .values({
        name: `sport_sessions_count_${s.name}`,
        unit: "sessions",
        sportId: s.id,
        frequencyHint: "daily",
      })
      .onConflictDoNothing();
    await db
      .insert(metricTypes)
      .values({
        name: `sport_minutes_${s.name}`,
        unit: "min",
        sportId: s.id,
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

seed().catch(console.error);
