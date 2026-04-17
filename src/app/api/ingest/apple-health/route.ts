import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/auth";
import { batchUpsertMetrics, upsertEvent, MetricInput } from "@/lib/ingest-service";
import { db } from "@/db";
import { sports } from "@/db/schema";
import { buildMetricTypeCache, resolveMetricTypeId } from "@/lib/ingest/metric-resolver";

/**
 * Ingest endpoint for the Health Auto Export iOS app (REST API export).
 *
 * Expected payload shape (HAE's native format):
 *   {
 *     "data": {
 *       "metrics": [
 *         {
 *           "name": "step_count",
 *           "units": "count",
 *           "data": [{ "date": "2026-04-16 00:00:00 +0000", "qty": 8234 }]
 *         },
 *         {
 *           "name": "sleep_analysis",
 *           "data": [{
 *             "date": "2026-04-16 00:00:00 +0000",
 *             "asleep": 7.2,  // HAE older schema
 *             "totalSleep": 7.2,  // HAE newer schema (we accept either)
 *             "deep": 1.5,
 *             "rem": 1.8,
 *             "inBed": 8.5
 *           }]
 *         }
 *       ],
 *       "workouts": [
 *         {
 *           "name": "Running",
 *           "start": "2026-04-16 07:30:00 +0000",
 *           "end":   "2026-04-16 08:15:00 +0000",
 *           "duration": 45.0
 *         }
 *       ]
 *     }
 *   }
 *
 * Dedup: HAE doesn't emit UUIDs, so we compose source_id from
 * `hae-<metric-or-workout>-<iso-date>` which is stable across re-exports.
 */

// HAE metric `name` → our metric_type.name.
const METRIC_NAME_MAP: Record<string, string> = {
  step_count: "steps",
  heart_rate: "resting_hr",
  resting_heart_rate: "resting_hr",
  heart_rate_variability: "hrv_ms",
  active_energy: "active_energy_kcal",
  weight_body_mass: "bodyweight",
  body_mass: "bodyweight",
  body_fat_percentage: "body_fat_pct",
  lean_body_mass: "lean_mass",
  vo2_max: "vo2_max",
  protein: "protein_g",
  dietary_protein: "protein_g",
  dietary_water: "water_oz",
  water: "water_oz",
};

// HAE workout `name` (matches HKWorkoutActivityType display name) →
// (sport_name, event_type).
const WORKOUT_NAME_MAP: Record<string, { sport: string; type: string }> = {
  "Running": { sport: "running", type: "run" },
  "Cycling": { sport: "biking", type: "ride" },
  "Hiking": { sport: "hiking", type: "hike" },
  "Walking": { sport: "hiking", type: "walk" },
  "Traditional Strength Training": { sport: "powerlifting", type: "strength" },
  "Functional Strength Training": { sport: "powerlifting", type: "strength" },
  "Martial Arts": { sport: "bjj", type: "session" },
};

interface HAEMetricPoint {
  date: string;
  qty?: number;
  // sleep_analysis is special - multiple fields per day.
  asleep?: number;
  totalSleep?: number;
  inBed?: number;
  deep?: number;
  rem?: number;
  core?: number;
  awake?: number;
}

interface HAEMetric {
  name: string;
  units?: string;
  data: HAEMetricPoint[];
}

interface HAEWorkout {
  name: string;
  start: string;
  end: string;
  duration?: number;
}

interface HAEPayload {
  data?: {
    metrics?: HAEMetric[];
    workouts?: HAEWorkout[];
  };
}

// "2026-04-16 07:30:00 +0000" → valid ISO "2026-04-16T07:30:00+00:00".
function normalizeDate(s: string): string {
  // Convert the space between date and time to a 'T' and normalize "+0000" to "+00:00".
  const t = s.replace(" ", "T");
  // "+0000" or "-0500" → "+00:00" / "-05:00"
  return t.replace(/\s*([+-]\d{2})(\d{2})$/, "$1:$2").replace(/\s+/, "");
}

export async function POST(request: NextRequest) {
  const authError = validateApiKey(request);
  if (authError) return authError;

  let payload: HAEPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const metricsIn = payload.data?.metrics ?? [];
  const workoutsIn = payload.data?.workouts ?? [];

  const typeCache = await buildMetricTypeCache();

  const allSports = await db.select().from(sports);
  const sportByName = new Map(allSports.map((s) => [s.name, s.id]));

  const inputs: MetricInput[] = [];

  for (const m of metricsIn) {
    // Special-case sleep_analysis: HAE ships one object per night with
    // totalSleep/deep/rem/... fields. Explode into multiple canonical rows.
    if (m.name === "sleep_analysis") {
      for (const p of m.data) {
        const iso = normalizeDate(p.date);
        const total = p.asleep ?? p.totalSleep;

        const pushSleep = async (canonicalName: string, value: number | undefined) => {
          if (typeof value !== "number") return;
          const typeId = await resolveMetricTypeId({
            rawName: canonicalName,
            map: { [canonicalName]: canonicalName },
            sourceSystem: "apple_health",
            unit: "h",
            cache: typeCache,
          });
          inputs.push({
            metricTypeId: typeId,
            value,
            recordedAt: iso,
            source: "apple_health",
            sourceId: `hae-${canonicalName}-${iso}`,
          });
        };

        await pushSleep("sleep_hours", total);
        await pushSleep("sleep_deep_hours", p.deep);
        await pushSleep("sleep_rem_hours", p.rem);
      }
      continue;
    }

    // Standard path: resolve via the map, falling back to auto-created
    // `apple_health:<rawName>` rows for anything unmapped.
    const typeId = await resolveMetricTypeId({
      rawName: m.name,
      map: METRIC_NAME_MAP,
      sourceSystem: "apple_health",
      unit: m.units,
      cache: typeCache,
    });

    for (const p of m.data) {
      if (typeof p.qty !== "number") continue;
      const iso = normalizeDate(p.date);
      const canonical = METRIC_NAME_MAP[m.name] ?? `apple_health:${m.name}`;
      inputs.push({
        metricTypeId: typeId,
        value: p.qty,
        recordedAt: iso,
        source: "apple_health",
        sourceId: `hae-${canonical}-${iso}`,
      });
    }
  }

  const metricResult = await batchUpsertMetrics(inputs);

  let workoutsAccepted = 0;
  let workoutsSkipped = 0;
  const unknownWorkoutNames: string[] = [];
  const workoutErrors: string[] = [];

  for (const w of workoutsIn) {
    const mapping = WORKOUT_NAME_MAP[w.name];
    if (!mapping) {
      if (!unknownWorkoutNames.includes(w.name)) unknownWorkoutNames.push(w.name);
      continue;
    }
    const sportId = sportByName.get(mapping.sport);
    if (!sportId) continue;

    const startIso = normalizeDate(w.start);
    const durationMin =
      typeof w.duration === "number"
        ? Math.round(w.duration)
        : Math.round((Date.parse(normalizeDate(w.end)) - Date.parse(startIso)) / 60000);

    try {
      const { status } = await upsertEvent({
        sportId,
        type: mapping.type,
        durationMinutes: durationMin,
        notes: null,
        startedAt: startIso,
        source: "apple_health",
        sourceId: `hae-workout-${w.name}-${startIso}`,
      });
      if (status === "accepted") workoutsAccepted++;
      else workoutsSkipped++;
    } catch (err) {
      workoutErrors.push(`${w.name} @ ${startIso}: ${err}`);
    }
  }

  return NextResponse.json({
    metrics: metricResult,
    workouts: {
      accepted: workoutsAccepted,
      skipped: workoutsSkipped,
      errors: workoutErrors,
    },
    unknownWorkoutNames,
  });
}
