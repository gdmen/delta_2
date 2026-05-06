import { db } from "./index";
import { metricTypes, sports, workoutSets } from "./schema";
import { eq, sql } from "drizzle-orm";
import { slugifyExercise } from "../lib/computed-metrics";

// NOTE: Delta's canonical metric_types are also seeded by migration
// 0006_redundant_bullseye.sql so every DB has them regardless of whether
// this script is run. Keep the two lists in sync when adding canonicals.
//
// Sports are NOT seeded. They auto-create on first import via
// src/lib/ingest/sport-resolver.ts as `<source>:<rawName>` (e.g.
// `strava:Ride`, `apple_health:Hiking`); the user merges them into
// canonical names via /data/sports. Migration 0021 deletes any
// previously-seeded canonicals that no rows reference.

const METRIC_TYPES = [
  // Note: bench_1rm / squat_1rm / deadlift_1rm were seeded primitives in
  // earlier versions. Removed 2026-05-04 — equivalent computed metrics
  // (e.g. flat_barbell_bench_press_e1rm, barbell_back_squat_max) are
  // auto-seeded from workout_sets in seedComputedMetricTypes() and carry
  // strictly more information (per-day max e1RM, lifetime PR step graph,
  // etc.). Migration 0020 deletes them from existing DBs and re-points
  // any goal that targeted them.
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

  // BodySpec DEXA: 53 fields under the `body_spec:` prefix. Mirrors the
  // <source>:<rawName> pattern used for sports auto-import. The user can
  // alias-merge these into shared canonicals (`bodyweight`, etc.) via the
  // existing merge UI when other DEXA sources show up. See
  // src/lib/bodyspec/parse.ts for the extraction shape.

  // -- Group A: total composition + supplemental (13)
  { name: "body_spec:bodyweight", unit: "lb", frequencyHint: "occasional" as const },
  { name: "body_spec:body_fat_pct", unit: "%", frequencyHint: "occasional" as const },
  { name: "body_spec:lean_mass", unit: "lb", frequencyHint: "occasional" as const },
  { name: "body_spec:fat_mass", unit: "lb", frequencyHint: "occasional" as const },
  { name: "body_spec:bone_mineral_density", unit: "g/cm²", frequencyHint: "occasional" as const },
  { name: "body_spec:visceral_fat_mass", unit: "lb", frequencyHint: "occasional" as const },
  { name: "body_spec:bone_mineral_content", unit: "lb", frequencyHint: "occasional" as const },
  { name: "body_spec:vat_volume", unit: "in³", frequencyHint: "occasional" as const },
  { name: "body_spec:t_score", unit: "", frequencyHint: "occasional" as const },
  { name: "body_spec:z_score", unit: "", frequencyHint: "occasional" as const },
  { name: "body_spec:rmr_kcal", unit: "kcal/day", frequencyHint: "occasional" as const },
  { name: "body_spec:ag_ratio", unit: "", frequencyHint: "occasional" as const },
  { name: "body_spec:height", unit: "in", frequencyHint: "occasional" as const },

  // -- Group B: per-region body comp (5 regions × 5 measures = 25)
  { name: "body_spec:arms_fat_pct", unit: "%", frequencyHint: "occasional" as const },
  { name: "body_spec:arms_total_mass", unit: "lb", frequencyHint: "occasional" as const },
  { name: "body_spec:arms_fat_mass", unit: "lb", frequencyHint: "occasional" as const },
  { name: "body_spec:arms_lean_mass", unit: "lb", frequencyHint: "occasional" as const },
  { name: "body_spec:arms_bmc", unit: "lb", frequencyHint: "occasional" as const },
  { name: "body_spec:legs_fat_pct", unit: "%", frequencyHint: "occasional" as const },
  { name: "body_spec:legs_total_mass", unit: "lb", frequencyHint: "occasional" as const },
  { name: "body_spec:legs_fat_mass", unit: "lb", frequencyHint: "occasional" as const },
  { name: "body_spec:legs_lean_mass", unit: "lb", frequencyHint: "occasional" as const },
  { name: "body_spec:legs_bmc", unit: "lb", frequencyHint: "occasional" as const },
  { name: "body_spec:trunk_fat_pct", unit: "%", frequencyHint: "occasional" as const },
  { name: "body_spec:trunk_total_mass", unit: "lb", frequencyHint: "occasional" as const },
  { name: "body_spec:trunk_fat_mass", unit: "lb", frequencyHint: "occasional" as const },
  { name: "body_spec:trunk_lean_mass", unit: "lb", frequencyHint: "occasional" as const },
  { name: "body_spec:trunk_bmc", unit: "lb", frequencyHint: "occasional" as const },
  { name: "body_spec:android_fat_pct", unit: "%", frequencyHint: "occasional" as const },
  { name: "body_spec:android_total_mass", unit: "lb", frequencyHint: "occasional" as const },
  { name: "body_spec:android_fat_mass", unit: "lb", frequencyHint: "occasional" as const },
  { name: "body_spec:android_lean_mass", unit: "lb", frequencyHint: "occasional" as const },
  { name: "body_spec:android_bmc", unit: "lb", frequencyHint: "occasional" as const },
  { name: "body_spec:gynoid_fat_pct", unit: "%", frequencyHint: "occasional" as const },
  { name: "body_spec:gynoid_total_mass", unit: "lb", frequencyHint: "occasional" as const },
  { name: "body_spec:gynoid_fat_mass", unit: "lb", frequencyHint: "occasional" as const },
  { name: "body_spec:gynoid_lean_mass", unit: "lb", frequencyHint: "occasional" as const },
  { name: "body_spec:gynoid_bmc", unit: "lb", frequencyHint: "occasional" as const },

  // -- Group C: per-region BMD (7)
  { name: "body_spec:head_bmd", unit: "g/cm²", frequencyHint: "occasional" as const },
  { name: "body_spec:arms_bmd", unit: "g/cm²", frequencyHint: "occasional" as const },
  { name: "body_spec:legs_bmd", unit: "g/cm²", frequencyHint: "occasional" as const },
  { name: "body_spec:trunk_bmd", unit: "g/cm²", frequencyHint: "occasional" as const },
  { name: "body_spec:ribs_bmd", unit: "g/cm²", frequencyHint: "occasional" as const },
  { name: "body_spec:spine_bmd", unit: "g/cm²", frequencyHint: "occasional" as const },
  { name: "body_spec:pelvis_bmd", unit: "g/cm²", frequencyHint: "occasional" as const },

  // -- Group D: muscle balance per side (8)
  { name: "body_spec:right_arm_lean_mass", unit: "lb", frequencyHint: "occasional" as const },
  { name: "body_spec:right_arm_fat_mass", unit: "lb", frequencyHint: "occasional" as const },
  { name: "body_spec:left_arm_lean_mass", unit: "lb", frequencyHint: "occasional" as const },
  { name: "body_spec:left_arm_fat_mass", unit: "lb", frequencyHint: "occasional" as const },
  { name: "body_spec:right_leg_lean_mass", unit: "lb", frequencyHint: "occasional" as const },
  { name: "body_spec:right_leg_fat_mass", unit: "lb", frequencyHint: "occasional" as const },
  { name: "body_spec:left_leg_lean_mass", unit: "lb", frequencyHint: "occasional" as const },
  { name: "body_spec:left_leg_fat_mass", unit: "lb", frequencyHint: "occasional" as const },
];

async function seed() {
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
