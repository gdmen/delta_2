import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/auth";
import { batchUpsertMetrics, upsertEvent, MetricInput } from "@/lib/ingest-service";
import { buildMetricTypeCache, resolveMetricTypeId } from "@/lib/ingest/metric-resolver";
import { buildSportCache, resolveSportId } from "@/lib/ingest/sport-resolver";
import { ReconcileTracker } from "@/lib/reconcile";

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

// HAE metric-name routing lives in the `metric_type_aliases` DB table.
// Users edit it via the merge UI on /data and the per-alias remove
// button on each metric detail page. Resolver checks aliases before
// auto-creating `apple_health:<rawName>` orphans.
//
// HAE workout names (matches HKWorkoutActivityType display name) used to
// translate to canonical sports + event types via a hardcoded map.
// As of 2026-05-05 they auto-create `apple_health:<workoutName>` sport
// rows the same way metric_types do; the user merges them into clean
// canonicals (e.g. "Running" → existing or new `running`) via /data/sports.
// events.type stores the raw workout name verbatim.

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
  const sportCache = await buildSportCache();

  const inputs: MetricInput[] = [];

  for (const m of metricsIn) {
    // Special-case sleep_analysis: HAE ships one object per night with
    // totalSleep/deep/rem/... fields. Explode into multiple rows, one
    // per facet. Each facet routes through the orphan-first resolver
    // like every other ingest path — first run lands them as
    // `apple_health:sleep_hours`, `apple_health:sleep_deep_hours`,
    // `apple_health:sleep_rem_hours`. The user merges them into their
    // preferred canonical names via /data/metrics if they want.
    if (m.name === "sleep_analysis") {
      for (const p of m.data) {
        const iso = normalizeDate(p.date);
        const total = p.asleep ?? p.totalSleep;

        const pushSleep = async (rawName: string, value: number | undefined) => {
          if (typeof value !== "number") return;
          const { id: typeId, alias: typeAlias } = await resolveMetricTypeId({
            rawName,
            map: {},
            sourceSystem: "apple_health",
            unit: "h",
            cache: typeCache,
          });
          inputs.push({
            metricTypeId: typeId,
            value,
            recordedAt: iso,
            source: "apple_health",
            sourceId: `hae-${rawName}-${iso}`,
            alias: typeAlias,
          });
        };

        await pushSleep("sleep_hours", total);
        await pushSleep("sleep_deep_hours", p.deep);
        await pushSleep("sleep_rem_hours", p.rem);
      }
      continue;
    }

    // Standard path: resolver consults the alias table and falls back to
    // `apple_health:<rawName>` for anything still unmapped.
    const { id: typeId, alias: typeAlias } = await resolveMetricTypeId({
      rawName: m.name,
      map: {},
      sourceSystem: "apple_health",
      unit: m.units,
      cache: typeCache,
    });

    // Source ID stem is the RAW HAE metric name. Stable across user
    // merges — if the user merges `apple_health:carbohydrates` into
    // `carbs`, the resolved typeId changes (now points at `carbs` via
    // the alias) but the source_id stays `hae-carbohydrates-${iso}`,
    // so the next ingest UPDATEs the existing row instead of inserting
    // a duplicate. Earlier code stemmed on the resolved canonical name
    // and got bitten by that exact merge case.
    for (const p of m.data) {
      if (typeof p.qty !== "number") continue;
      const iso = normalizeDate(p.date);
      inputs.push({
        metricTypeId: typeId,
        value: p.qty,
        recordedAt: iso,
        source: "apple_health",
        sourceId: `hae-${m.name}-${iso}`,
        alias: typeAlias,
      });
    }
  }

  const metricResult = await batchUpsertMetrics(inputs);

  // Record upserts into the reconcile tracker so reconcile (if enabled for
  // apple_health) knows the batch's per-type date range + source_ids.
  const tracker = new ReconcileTracker();
  for (const input of inputs) {
    tracker.recordMetric(input.metricTypeId, input.sourceId, input.recordedAt);
  }

  let workoutsAccepted = 0;
  let workoutsSkipped = 0;
  const workoutErrors: string[] = [];

  for (const w of workoutsIn) {
    if (!w.name) {
      workoutsSkipped++;
      continue;
    }

    // Auto-create the sport on first encounter. Raw HAE name (e.g.
    // "Running", "Martial Arts") becomes `apple_health:<name>` until
    // the user merges it into a canonical sport via /data/sports.
    const sportId = await resolveSportId({
      rawName: w.name,
      sourceSystem: "apple_health",
      cache: sportCache,
    });

    const startIso = normalizeDate(w.start);
    const durationMin =
      typeof w.duration === "number"
        ? Math.round(w.duration)
        : Math.round((Date.parse(normalizeDate(w.end)) - Date.parse(startIso)) / 60000);

    try {
      const sourceId = `hae-workout-${w.name}-${startIso}`;
      const { status } = await upsertEvent({
        sportId,
        // events.type holds the raw HAE workout name verbatim. No
        // canonical translation — user can rename via the event editor.
        type: w.name,
        durationMinutes: durationMin,
        notes: null,
        startedAt: startIso,
        source: "apple_health",
        sourceId,
      });
      tracker.recordEvent(sourceId, startIso);
      if (status === "accepted") workoutsAccepted++;
      else workoutsSkipped++;
    } catch (err) {
      workoutErrors.push(`${w.name} @ ${startIso}: ${err}`);
    }
  }

  const reconcile = await tracker.apply("apple_health");

  return NextResponse.json({
    metrics: metricResult,
    workouts: {
      accepted: workoutsAccepted,
      skipped: workoutsSkipped,
      errors: workoutErrors,
    },
    reconcile,
  });
}
