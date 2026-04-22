import { db } from "./index";
import { sports, metricTypes } from "./schema";

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

  console.log("Seed complete.");
}

seed().catch(console.error);
