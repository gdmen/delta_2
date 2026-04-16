import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/auth";
import { batchUpsertMetrics, upsertEvent, MetricInput } from "@/lib/ingest-service";
import { db } from "@/db";
import { metricTypes, sports } from "@/db/schema";
import { eq } from "drizzle-orm";

// Maps Apple Health sample type keys to our metric_type names.
const METRIC_TYPE_MAP: Record<string, string> = {
  sleep_analysis_total: "sleep_hours",
  sleep_deep: "sleep_deep_hours",
  sleep_rem: "sleep_rem_hours",
  heart_rate: "resting_hr",
  resting_heart_rate: "resting_hr",
  heart_rate_variability: "hrv_ms",
  active_energy: "active_energy_kcal",
  step_count: "steps",
  body_mass: "bodyweight",
  body_fat_percentage: "body_fat_pct",
  lean_body_mass: "lean_mass",
  vo2_max: "vo2_max",
  dietary_protein: "protein_g",
  dietary_water: "water_oz",
};

// Maps Apple Health workout types to (sport_name, event_type).
const WORKOUT_MAP: Record<string, { sport: string; type: string }> = {
  traditional_strength_training: { sport: "powerlifting", type: "strength" },
  functional_strength_training: { sport: "powerlifting", type: "strength" },
  running: { sport: "running", type: "run" },
  hiking: { sport: "hiking", type: "hike" },
  cycling: { sport: "biking", type: "ride" },
  martial_arts: { sport: "bjj", type: "session" },
};

interface AppleHealthSample {
  type: string;
  value: number;
  unit?: string;
  startDate: string;
  endDate?: string;
  uuid?: string;
}

interface AppleHealthWorkout {
  type: string;
  startDate: string;
  endDate: string;
  durationMinutes: number;
  uuid?: string;
  notes?: string;
}

interface AppleHealthPayload {
  samples?: AppleHealthSample[];
  workouts?: AppleHealthWorkout[];
}

export async function POST(request: NextRequest) {
  const authError = validateApiKey(request);
  if (authError) return authError;

  let payload: AppleHealthPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const samples = payload.samples ?? [];
  const workouts = payload.workouts ?? [];

  const allMetricTypes = await db.select().from(metricTypes);
  const metricTypeByName = new Map(allMetricTypes.map((m) => [m.name, m.id]));

  const allSports = await db.select().from(sports);
  const sportByName = new Map(allSports.map((s) => [s.name, s.id]));

  const metricInputs: MetricInput[] = [];
  const unknownTypes: string[] = [];

  for (const s of samples) {
    const metricName = METRIC_TYPE_MAP[s.type];
    if (!metricName) {
      if (!unknownTypes.includes(s.type)) unknownTypes.push(s.type);
      continue;
    }
    const typeId = metricTypeByName.get(metricName);
    if (!typeId) continue;

    metricInputs.push({
      metricTypeId: typeId,
      value: s.value,
      recordedAt: s.startDate,
      source: "apple_health",
      sourceId: s.uuid ?? null,
    });
  }

  const metricResult = await batchUpsertMetrics(metricInputs);

  let workoutsAccepted = 0;
  let workoutsSkipped = 0;
  const workoutErrors: string[] = [];

  for (const w of workouts) {
    const mapping = WORKOUT_MAP[w.type];
    if (!mapping) {
      workoutErrors.push(`Unknown workout type: ${w.type}`);
      continue;
    }
    const sportId = sportByName.get(mapping.sport);
    if (!sportId) continue;

    try {
      const { status } = await upsertEvent({
        sportId,
        type: mapping.type,
        durationMinutes: Math.round(w.durationMinutes),
        notes: w.notes ?? null,
        startedAt: w.startDate,
        source: "apple_health",
        sourceId: w.uuid ?? null,
      });
      if (status === "accepted") workoutsAccepted++;
      else workoutsSkipped++;
    } catch (err) {
      workoutErrors.push(`Workout ${w.uuid}: ${err}`);
    }
  }

  return NextResponse.json({
    metrics: metricResult,
    workouts: { accepted: workoutsAccepted, skipped: workoutsSkipped, errors: workoutErrors },
    unknownSampleTypes: unknownTypes,
  });
}
