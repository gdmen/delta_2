import { NextResponse } from "next/server";
import { zipSync, strToU8 } from "fflate";
import { db } from "@/db";
import { metrics, events, eventMetrics, workoutSets, metricTypes, sports } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { serializeCsv } from "@/lib/csv";

/**
 * GET /api/export
 *
 * Returns a ZIP of all measured/quantified data:
 *   - metrics.csv        - timestamped numeric streams
 *   - events.csv         - sessions (runs, rides, strength days, BJJ, etc.)
 *   - event_metrics.csv  - per-event numeric dimensions (distance, elevation,
 *                          calories, avg HR, ...), child rows of events
 *   - workout_sets.csv   - per-set lifting details, child rows of strength events
 *
 * Everything uses human-readable names (metric, sport, exercise_name) instead
 * of DB IDs so the CSVs are self-describing and round-trip through the
 * matching import endpoint (or any other SQL/spreadsheet tool).
 *
 * event_metrics + workout_sets both reference their parent event by
 * (event_started_at, sport, event_type, event_source_id); the importer uses
 * event_source_id when present, else the started_at+sport+type tuple.
 */
export async function GET() {
  // --- metrics.csv ---------------------------------------------------------
  const metricRows = await db
    .select({
      recordedAt: metrics.recordedAt,
      metric: metricTypes.name,
      unit: metricTypes.unit,
      value: metrics.value,
      source: metrics.source,
      sourceId: metrics.sourceId,
    })
    .from(metrics)
    .innerJoin(metricTypes, eq(metrics.metricTypeId, metricTypes.id))
    .orderBy(asc(metrics.recordedAt));

  const metricsCsv = serializeCsv(
    ["recorded_at", "metric", "unit", "value", "source", "source_id"],
    metricRows.map((r) => [
      r.recordedAt,
      r.metric,
      r.unit,
      r.value,
      r.source,
      // Synthesize a stable id for rows that don't have one so the import
      // endpoint can dedupe on re-upload. Matches the same formula the
      // importer uses when source_id is blank.
      r.sourceId ?? `csv_import-${r.metric}-${r.recordedAt}`,
    ]),
  );

  // --- events.csv ----------------------------------------------------------
  const eventRows = await db
    .select({
      id: events.id,
      startedAt: events.startedAt,
      sport: sports.name,
      type: events.type,
      durationMinutes: events.durationMinutes,
      notes: events.notes,
      source: events.source,
      sourceId: events.sourceId,
    })
    .from(events)
    .innerJoin(sports, eq(events.sportId, sports.id))
    .orderBy(asc(events.startedAt));

  const eventsCsv = serializeCsv(
    ["started_at", "sport", "type", "duration_minutes", "notes", "source", "source_id"],
    eventRows.map((r) => [
      r.startedAt,
      r.sport,
      r.type,
      r.durationMinutes ?? "",
      r.notes ?? "",
      r.source,
      r.sourceId ?? `csv_import-${r.sport}-${r.type}-${r.startedAt}`,
    ]),
  );

  // --- event_metrics.csv ---------------------------------------------------
  // Per-event numeric dimensions attached to events. Join all the way out
  // so each row carries the parent event's natural key AND the canonical
  // metric name, matching what the importer expects.
  const emRows = await db
    .select({
      eventStartedAt: events.startedAt,
      sport: sports.name,
      eventType: events.type,
      eventSourceId: events.sourceId,
      metric: metricTypes.name,
      unit: metricTypes.unit,
      value: eventMetrics.value,
    })
    .from(eventMetrics)
    .innerJoin(events, eq(eventMetrics.eventId, events.id))
    .innerJoin(sports, eq(events.sportId, sports.id))
    .innerJoin(metricTypes, eq(eventMetrics.metricTypeId, metricTypes.id))
    .orderBy(asc(events.startedAt), asc(metricTypes.name));

  const eventMetricsCsv = serializeCsv(
    [
      "event_started_at",
      "sport",
      "event_type",
      "event_source_id",
      "metric",
      "unit",
      "value",
    ],
    emRows.map((r) => [
      r.eventStartedAt,
      r.sport,
      r.eventType,
      r.eventSourceId ?? "",
      r.metric,
      r.unit,
      r.value,
    ]),
  );

  // --- workout_sets.csv ----------------------------------------------------
  // Join to events + sports so each set carries its parent's natural key.
  const setRows = await db
    .select({
      eventStartedAt: events.startedAt,
      sport: sports.name,
      eventType: events.type,
      eventSourceId: events.sourceId,
      exerciseName: workoutSets.exerciseName,
      setNumber: workoutSets.setNumber,
      reps: workoutSets.reps,
      weight: workoutSets.weight,
      rpe: workoutSets.rpe,
      notes: workoutSets.notes,
    })
    .from(workoutSets)
    .innerJoin(events, eq(workoutSets.eventId, events.id))
    .innerJoin(sports, eq(events.sportId, sports.id))
    .orderBy(asc(events.startedAt), asc(workoutSets.exerciseName), asc(workoutSets.setNumber));

  const workoutSetsCsv = serializeCsv(
    [
      "event_started_at",
      "sport",
      "event_type",
      "event_source_id",
      "exercise_name",
      "set_number",
      "reps",
      "weight",
      "rpe",
      "notes",
    ],
    setRows.map((r) => [
      r.eventStartedAt,
      r.sport,
      r.eventType,
      r.eventSourceId ?? "",
      r.exerciseName,
      r.setNumber,
      r.reps,
      r.weight,
      r.rpe ?? "",
      r.notes ?? "",
    ]),
  );

  // --- bundle ---------------------------------------------------------------
  const zipped = zipSync({
    "metrics.csv": strToU8(metricsCsv),
    "events.csv": strToU8(eventsCsv),
    "event_metrics.csv": strToU8(eventMetricsCsv),
    "workout_sets.csv": strToU8(workoutSetsCsv),
  });

  const stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const body = new Uint8Array(zipped);

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="delta-export-${stamp}.zip"`,
    },
  });
}
