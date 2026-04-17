import { NextRequest, NextResponse } from "next/server";
import { unzipSync, strFromU8 } from "fflate";
import { db } from "@/db";
import { events, sports } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { parseCsv, headerIndex } from "@/lib/csv";
import {
  buildMetricTypeCache,
  resolveMetricTypeId,
} from "@/lib/ingest/metric-resolver";
import {
  upsertMetric,
  upsertEvent,
  upsertWorkoutSet,
  type MetricInput,
  type EventInput,
  type WorkoutSetInput,
} from "@/lib/ingest-service";

/**
 * POST /api/import
 *
 * Accepts either a ZIP (with any of metrics.csv / events.csv /
 * workout_sets.csv at its root) or a single CSV (filename determines
 * which table it targets) via multipart form field "file".
 *
 * Idempotent:
 *   - metrics rows dedupe on (source, source_id). When source_id is
 *     blank in the CSV we synthesize `csv_import-<metric>-<recorded_at>`
 *     so re-importing the same file is a no-op.
 *   - events rows dedupe the same way with synthetic
 *     `csv_import-<sport>-<type>-<started_at>` when no source_id.
 *   - workout_sets rows upsert on (event_id, exercise_name, set_number).
 *
 * Unknown metric names auto-register via the metric-resolver
 * (stored under `csv_import:<rawName>` so they're visible but don't
 * collide with canonical names).
 */

interface TableResult {
  accepted: number;
  skipped: number;
  updated: number;
  errors: string[];
}

function emptyResult(): TableResult {
  return { accepted: 0, skipped: 0, updated: 0, errors: [] };
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Expected multipart field "file"' }, { status: 400 });
  }

  const buf = new Uint8Array(await file.arrayBuffer());
  const csvs: Record<string, string> = {};

  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".zip")) {
    try {
      const entries = unzipSync(buf);
      for (const [name, bytes] of Object.entries(entries)) {
        const base = name.split("/").pop() ?? name;
        if (base.endsWith(".csv")) csvs[base.toLowerCase()] = strFromU8(bytes);
      }
    } catch (err) {
      return NextResponse.json(
        { error: `Failed to unzip: ${err instanceof Error ? err.message : String(err)}` },
        { status: 400 }
      );
    }
  } else if (lowerName.endsWith(".csv")) {
    const base = lowerName.split("/").pop() ?? lowerName;
    csvs[base] = new TextDecoder("utf-8").decode(buf);
  } else {
    return NextResponse.json(
      { error: "File must be .zip or .csv" },
      { status: 400 }
    );
  }

  const recognized = ["metrics.csv", "events.csv", "workout_sets.csv"];
  const matched = recognized.filter((n) => n in csvs);
  if (matched.length === 0) {
    return NextResponse.json(
      {
        error: `No recognized CSVs found. Expected any of: ${recognized.join(", ")}. Got: ${Object.keys(csvs).join(", ") || "(none)"}`,
      },
      { status: 400 }
    );
  }

  const out: Record<string, TableResult> = {};

  // --- metrics.csv ---------------------------------------------------------
  if (csvs["metrics.csv"]) {
    out.metrics = await importMetrics(csvs["metrics.csv"]);
  }

  // --- events.csv ----------------------------------------------------------
  if (csvs["events.csv"]) {
    out.events = await importEvents(csvs["events.csv"]);
  }

  // --- workout_sets.csv ----------------------------------------------------
  // Must run after events.csv so parent events exist (if the user bundled
  // both). When users import workout_sets.csv alone, we try to find existing
  // events by their natural key; if missing, we error on that row.
  if (csvs["workout_sets.csv"]) {
    out.workout_sets = await importWorkoutSets(csvs["workout_sets.csv"]);
  }

  return NextResponse.json(out);
}

// -----------------------------------------------------------------------------
// metrics.csv
// -----------------------------------------------------------------------------

async function importMetrics(text: string): Promise<TableResult> {
  const result = emptyResult();
  const { headers, rows } = parseCsv(text);
  let idx: Map<string, number>;
  try {
    idx = headerIndex(headers, ["recorded_at", "metric", "value"]);
  } catch (err) {
    result.errors.push(`metrics.csv: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  const typeCache = await buildMetricTypeCache();

  for (const [i, row] of rows.entries()) {
    try {
      const recordedAt = row[idx.get("recorded_at")!];
      const metricName = row[idx.get("metric")!];
      const valueStr = row[idx.get("value")!];
      const unit = idx.has("unit") ? row[idx.get("unit")!] : "";
      const source = (idx.has("source") ? row[idx.get("source")!] : "") || "csv_import";
      let sourceId = idx.has("source_id") ? row[idx.get("source_id")!] : "";

      if (!recordedAt || !metricName || valueStr === "") {
        result.errors.push(`metrics.csv row ${i + 2}: missing required field`);
        continue;
      }
      const value = Number(valueStr);
      if (!Number.isFinite(value)) {
        result.errors.push(`metrics.csv row ${i + 2}: non-numeric value "${valueStr}"`);
        continue;
      }

      if (!sourceId) sourceId = `csv_import-${metricName}-${recordedAt}`;

      const typeId = await resolveMetricTypeId({
        rawName: metricName,
        // Identity map: the CSV already carries canonical names.
        map: { [metricName]: metricName },
        sourceSystem: "csv_import",
        unit: unit || undefined,
        cache: typeCache,
      });

      const input: MetricInput = {
        metricTypeId: typeId,
        value,
        recordedAt,
        source,
        sourceId,
      };

      const status = await upsertMetric(input);
      if (status === "accepted") result.accepted++;
      else result.skipped++;
    } catch (err) {
      result.errors.push(`metrics.csv row ${i + 2}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

// -----------------------------------------------------------------------------
// events.csv
// -----------------------------------------------------------------------------

async function importEvents(text: string): Promise<TableResult> {
  const result = emptyResult();
  const { headers, rows } = parseCsv(text);
  let idx: Map<string, number>;
  try {
    idx = headerIndex(headers, ["started_at", "sport", "type"]);
  } catch (err) {
    result.errors.push(`events.csv: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  const sportCache = await loadSportCache();

  for (const [i, row] of rows.entries()) {
    try {
      const startedAt = row[idx.get("started_at")!];
      const sportName = row[idx.get("sport")!];
      const type = row[idx.get("type")!];
      const durStr = idx.has("duration_minutes") ? row[idx.get("duration_minutes")!] : "";
      const notes = idx.has("notes") ? row[idx.get("notes")!] : "";
      const source = (idx.has("source") ? row[idx.get("source")!] : "") || "csv_import";
      let sourceId = idx.has("source_id") ? row[idx.get("source_id")!] : "";

      if (!startedAt || !sportName || !type) {
        result.errors.push(`events.csv row ${i + 2}: missing required field`);
        continue;
      }
      const sportId = sportCache.get(sportName);
      if (!sportId) {
        result.errors.push(
          `events.csv row ${i + 2}: unknown sport "${sportName}" (known: ${[...sportCache.keys()].join(", ")})`
        );
        continue;
      }
      const duration = durStr === "" ? null : Number(durStr);
      if (duration !== null && !Number.isFinite(duration)) {
        result.errors.push(`events.csv row ${i + 2}: non-numeric duration "${durStr}"`);
        continue;
      }

      if (!sourceId) sourceId = `csv_import-${sportName}-${type}-${startedAt}`;

      // Belt-and-suspenders: if an existing row matches on the natural
      // key (sport, type, started_at) but has no source_id, adopt the
      // synthesized one so this and future imports all dedupe against it.
      const natural = await db
        .select({ id: events.id, sourceId: events.sourceId })
        .from(events)
        .where(
          and(
            eq(events.startedAt, startedAt),
            eq(events.sportId, sportId),
            eq(events.type, type)
          )
        )
        .limit(1);
      if (natural.length > 0 && !natural[0].sourceId) {
        await db.update(events).set({ sourceId }).where(eq(events.id, natural[0].id));
        result.skipped++;
        continue;
      }

      const input: EventInput = {
        sportId,
        type,
        durationMinutes: duration,
        notes: notes || null,
        startedAt,
        source,
        sourceId,
      };

      const { status } = await upsertEvent(input);
      if (status === "accepted") result.accepted++;
      else result.skipped++;
    } catch (err) {
      result.errors.push(`events.csv row ${i + 2}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

// -----------------------------------------------------------------------------
// workout_sets.csv
// -----------------------------------------------------------------------------

async function importWorkoutSets(text: string): Promise<TableResult> {
  const result = emptyResult();
  const { headers, rows } = parseCsv(text);
  let idx: Map<string, number>;
  try {
    idx = headerIndex(headers, [
      "event_started_at",
      "sport",
      "event_type",
      "exercise_name",
      "set_number",
      "reps",
      "weight",
    ]);
  } catch (err) {
    result.errors.push(`workout_sets.csv: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  const sportCache = await loadSportCache();

  for (const [i, row] of rows.entries()) {
    try {
      const startedAt = row[idx.get("event_started_at")!];
      const sportName = row[idx.get("sport")!];
      const eventType = row[idx.get("event_type")!];
      const eventSourceId = idx.has("event_source_id") ? row[idx.get("event_source_id")!] : "";
      const exerciseName = row[idx.get("exercise_name")!];
      const setNumberStr = row[idx.get("set_number")!];
      const repsStr = row[idx.get("reps")!];
      const weightStr = row[idx.get("weight")!];
      const rpeStr = idx.has("rpe") ? row[idx.get("rpe")!] : "";
      const notes = idx.has("notes") ? row[idx.get("notes")!] : "";

      if (!startedAt || !sportName || !eventType || !exerciseName) {
        result.errors.push(`workout_sets.csv row ${i + 2}: missing required field`);
        continue;
      }

      const sportId = sportCache.get(sportName);
      if (!sportId) {
        result.errors.push(`workout_sets.csv row ${i + 2}: unknown sport "${sportName}"`);
        continue;
      }

      // Find parent event. Prefer event_source_id if provided, otherwise
      // match on (started_at, sport_id, type).
      let parentId: number | null = null;
      if (eventSourceId) {
        const existing = await db
          .select({ id: events.id })
          .from(events)
          .where(eq(events.sourceId, eventSourceId))
          .limit(1);
        parentId = existing[0]?.id ?? null;
      }
      if (parentId === null) {
        const existing = await db
          .select({ id: events.id })
          .from(events)
          .where(
            and(
              eq(events.startedAt, startedAt),
              eq(events.sportId, sportId),
              eq(events.type, eventType)
            )
          )
          .limit(1);
        parentId = existing[0]?.id ?? null;
      }

      // No parent found: auto-create a barebones event so the sets have
      // something to hang off of. Use a stable synthetic source_id so a
      // re-import finds it.
      if (parentId === null) {
        const synthId = eventSourceId || `csv_import-${sportName}-${eventType}-${startedAt}`;
        const { eventId } = await upsertEvent({
          sportId,
          type: eventType,
          durationMinutes: null,
          notes: null,
          startedAt,
          source: "csv_import",
          sourceId: synthId,
        });
        parentId = eventId;
      }

      const input: WorkoutSetInput = {
        exerciseName,
        setNumber: Number(setNumberStr),
        reps: Number(repsStr),
        weight: Number(weightStr),
        rpe: rpeStr === "" ? null : Number(rpeStr),
        notes: notes || null,
      };
      if (
        !Number.isFinite(input.setNumber) ||
        !Number.isFinite(input.reps) ||
        !Number.isFinite(input.weight)
      ) {
        result.errors.push(`workout_sets.csv row ${i + 2}: non-numeric set/reps/weight`);
        continue;
      }

      const status = await upsertWorkoutSet(parentId, input);
      if (status === "accepted") result.accepted++;
      else result.updated++;
    } catch (err) {
      result.errors.push(
        `workout_sets.csv row ${i + 2}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return result;
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

async function loadSportCache(): Promise<Map<string, number>> {
  const rows = await db.select({ id: sports.id, name: sports.name }).from(sports);
  return new Map(rows.map((r) => [r.name, r.id]));
}
