import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { importSources, events } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { parseCsv } from "@/lib/csv";
import { applyMapping, type ImportMapping, type OutRow } from "@/lib/import-mapping";
import {
  buildMetricTypeCache,
  resolveMetricTypeId,
} from "@/lib/ingest/metric-resolver";
import {
  buildSportCache,
  resolveSportId,
  type SportCache,
} from "@/lib/ingest/sport-resolver";
import { ReconcileTracker } from "@/lib/reconcile";
import {
  upsertMetric,
  upsertEvent,
  upsertEventMetric,
  upsertWorkoutSet,
  type MetricInput,
  type EventInput,
} from "@/lib/ingest-service";

/**
 * POST /api/import-sources/[id]/import
 * multipart/form-data:
 *   file: CSV file
 *
 * Runs the saved mapping against the uploaded CSV, upserting records per
 * kind. Idempotent:
 *   - metrics / events: upsert by (source, source_id). The mapping's
 *     source_id column is used if mapped; otherwise a stable key is
 *     synthesized from the natural fields (same strategy as the generic
 *     /api/import route).
 *   - workout_sets: parent event resolved by event_source_id when
 *     mapped, else by (sport, event_type, started_at). Sets upsert on
 *     (event_id, exercise_metric_type_id, set_number). The raw
 *     exercise_name is resolved through the metric_types alias table
 *     (same path as metric names) so merges and aliases cover exercises.
 */

interface TableResult {
  accepted: number;
  skipped: number;
  updated: number;
  errors: string[];
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const sourceRows = await db
    .select()
    .from(importSources)
    .where(eq(importSources.id, id))
    .limit(1);
  if (sourceRows.length === 0) {
    return NextResponse.json({ error: "Import source not found" }, { status: 404 });
  }
  const source = sourceRows[0];
  const mapping = JSON.parse(source.mapping) as ImportMapping;

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Expected multipart field "file"' }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".csv")) {
    return NextResponse.json({ error: "File must be .csv" }, { status: 400 });
  }

  const text = await file.text();
  const { headers, rows } = parseCsv(text);

  // Normalize the source tag written to metrics/events: lowercase, spaces
  // -> underscores. So "TeamBuildr" -> "teambuildr" in the `source` column.
  const sourceTag = source.name.toLowerCase().replace(/\s+/g, "_");

  const result: TableResult = { accepted: 0, skipped: 0, updated: 0, errors: [] };

  const typeCache = await buildMetricTypeCache();
  const sportCache = await buildSportCache();
  const tracker = new ReconcileTracker();

  for (let i = 0; i < rows.length; i++) {
    const { out, error } = applyMapping(mapping, headers, rows[i], i);
    if (error) {
      result.errors.push(`row ${i + 2}: ${error}`);
      continue;
    }
    for (const item of out) {
      try {
        await writeOutRow(item, sourceTag, typeCache, sportCache, result, i, tracker);
      } catch (err) {
        result.errors.push(
          `row ${i + 2}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  // Truncate long error lists so the response stays small on huge imports.
  if (result.errors.length > 20) {
    result.errors = [...result.errors.slice(0, 20), `... +${result.errors.length - 20} more`];
  }

  const reconcile = await tracker.apply(sourceTag);

  return NextResponse.json({ kind: mapping.kind, result, reconcile });
}

async function writeOutRow(
  item: OutRow,
  sourceTag: string,
  typeCache: Awaited<ReturnType<typeof buildMetricTypeCache>>,
  sportCache: SportCache,
  result: TableResult,
  rowIdx: number,
  tracker: ReconcileTracker
): Promise<void> {
  if (item.kind === "metric") {
    const typeId = await resolveMetricTypeId({
      rawName: item.metric,
      map: { [item.metric]: item.metric },
      sourceSystem: sourceTag,
      unit: item.unit ?? undefined,
      cache: typeCache,
    });
    const sourceId =
      item.sourceId ?? `${sourceTag}-${item.metric}-${item.recordedAt}`;
    const input: MetricInput = {
      metricTypeId: typeId,
      value: item.value,
      recordedAt: item.recordedAt,
      source: sourceTag,
      sourceId,
    };
    const status = await upsertMetric(input);
    tracker.recordMetric(typeId, sourceId, item.recordedAt);
    if (status === "accepted") result.accepted++;
    else result.skipped++;
    return;
  }

  if (item.kind === "event") {
    const sportId = await resolveSportId({
      rawName: item.sport,
      sourceSystem: sourceTag,
      cache: sportCache,
    });
    // When the mapping doesn't supply a source_id, include the row index
    // so multiple rows that share a date/sport/type (e.g. three Stationary
    // Bike sets on the same day) each become their own event and each
    // keeps its own attached metrics. If the caller wants per-row
    // collapsing (one event per day), they should map source_id to a
    // natural column.
    const sourceId =
      item.sourceId ?? `${sourceTag}-${item.sport}-${item.type}-${item.startedAt}-${rowIdx}`;
    const input: EventInput = {
      sportId,
      type: item.type,
      durationMinutes: item.durationMinutes ?? null,
      notes: item.notes ?? null,
      startedAt: item.startedAt,
      source: sourceTag,
      sourceId,
    };
    const { status, eventId } = await upsertEvent(input);
    tracker.recordEvent(sourceId, item.startedAt);
    if (status === "accepted") result.accepted++;
    else result.skipped++;

    // Attach per-event dimensions (distance, calories, avg HR, etc.).
    for (const m of item.metrics ?? []) {
      const typeId = await resolveMetricTypeId({
        rawName: m.metric,
        map: { [m.metric]: m.metric },
        sourceSystem: sourceTag,
        unit: m.unit ?? undefined,
        cache: typeCache,
      });
      await upsertEventMetric(eventId, typeId, m.value);
    }
    return;
  }

  if (item.kind === "workout_set") {
    const sportId = await resolveSportId({
      rawName: item.sport,
      sourceSystem: sourceTag,
      cache: sportCache,
    });

    // Resolve parent event. Whatever the parent's source_id ends up being,
    // record it in the tracker so reconcile preserves the parent (cascades
    // remove orphaned children).
    let parentId: number | null = null;
    let parentSourceId: string | null = null;
    if (item.eventSourceId) {
      const synth = `${sourceTag}-workout-${item.eventSourceId}`;
      parentSourceId = synth;
      const existing = await db
        .select({ id: events.id })
        .from(events)
        .where(eq(events.sourceId, synth))
        .limit(1);
      parentId = existing[0]?.id ?? null;
      if (parentId === null) {
        const { eventId } = await upsertEvent({
          sportId,
          type: item.eventType,
          durationMinutes: null,
          notes: null,
          startedAt: item.startedAt,
          source: sourceTag,
          sourceId: synth,
        });
        parentId = eventId;
      }
    } else {
      const existing = await db
        .select({ id: events.id, sourceId: events.sourceId })
        .from(events)
        .where(
          and(
            eq(events.startedAt, item.startedAt),
            eq(events.sportId, sportId),
            eq(events.type, item.eventType)
          )
        )
        .limit(1);
      parentId = existing[0]?.id ?? null;
      parentSourceId = existing[0]?.sourceId ?? null;
      if (parentId === null) {
        const synth = `${sourceTag}-${item.sport}-${item.eventType}-${item.startedAt}`;
        parentSourceId = synth;
        const { eventId } = await upsertEvent({
          sportId,
          type: item.eventType,
          durationMinutes: null,
          notes: null,
          startedAt: item.startedAt,
          source: sourceTag,
          sourceId: synth,
        });
        parentId = eventId;
      }
    }
    if (parentSourceId) tracker.recordEvent(parentSourceId, item.startedAt);

    // Identity map routes the raw name to an existing canonical when one
    // exists, before falling through to the source-prefixed orphan path.
    const exerciseMetricTypeId = await resolveMetricTypeId({
      rawName: item.exerciseName,
      map: { [item.exerciseName]: item.exerciseName },
      sourceSystem: sourceTag,
      cache: typeCache,
    });
    const status = await upsertWorkoutSet(parentId, {
      exerciseMetricTypeId,
      setNumber: item.setNumber,
      reps: item.reps,
      weight: item.weight,
      rpe: item.rpe ?? null,
      notes: item.notes ?? null,
    });
    if (status === "accepted") result.accepted++;
    else result.updated++;
    return;
  }
}

