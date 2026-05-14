import { NextRequest, NextResponse } from "next/server";
import { unzipSync, strFromU8 } from "fflate";
import { db } from "@/db";
import {
  events,
  sports,
  metricTypes,
  metricTypeAliases,
  importSources,
  sourceSettings,
  goals,
  focuses,
  goalJournalEntries,
  dashboards,
  dashboardWidgets,
  coachCalls,
  reconcileLog,
  mergeLog,
  eventDuplicateDenylist,
} from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { parseCsv, headerIndex } from "@/lib/csv";
import {
  buildMetricTypeCache,
  resolveMetricTypeId,
} from "@/lib/ingest/metric-resolver";
import {
  upsertMetric,
  upsertEvent,
  upsertEventMetric,
  upsertWorkoutSet,
  resolveEventId,
  bulkImportStorage,
  flushBulkImportRecomputes,
  type BulkImportContext,
  type WorkoutSetInput,
} from "@/lib/ingest-service";
import { isStatus } from "@/lib/enums";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";
import { makeSseStream, sseHeaders } from "@/lib/sse-stream";
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  ImportDoneFrame,
  ImportFrameEvent,
  ImportPhaseFrame,
  ImportPhaseProgressFrame,
  ImportStartFrame,
  ImportTable,
} from "@/lib/import/sse-frames";

/**
 * POST /api/import
 *
 * Accepts either a ZIP or a single CSV via multipart form field "file".
 * The ZIP may contain any subset of the following; filename-in-zip
 * determines which handler runs.
 *
 * Foundational catalog (applied first, in dependency order):
 *   - sports.csv                 - INSERT OR IGNORE by name
 *   - metric_types.csv           - INSERT OR IGNORE by name (optional sport FK by name)
 *   - metric_type_aliases.csv    - INSERT OR IGNORE by alias; canonical by name
 *   - import_sources.csv         - INSERT OR IGNORE by name
 *   - source_settings.csv        - upsert on source PK
 *
 * User targets (reference sports + metric_types):
 *   - goals.csv                  - dedupe by (sport, metric, deadline)
 *   - focuses.csv                - dedupe by (goal, name, start_date); goal resolved
 *                                  by (goal_sport, goal_metric, goal_deadline)
 *   - goal_journal_entries.csv   - dedupe by (goal, content, created_at)
 *
 * Measured data (existing behaviour):
 *   - metrics.csv                - dedupe on (source, source_id)
 *   - events.csv                 - dedupe on (source, source_id) or natural key
 *   - event_metrics.csv          - upsert on (event_id, metric_type_id)
 *   - workout_sets.csv           - upsert on (event_id, exercise_metric_type_id, set_number);
 *                                    raw exercise_name resolves via metric_types aliases
 *
 * All handlers are idempotent: re-importing the same file is a no-op.
 * Unknown metric names auto-register via the metric-resolver under
 * `custom:<rawName>` so they're visible but don't collide with canonicals.
 *
 * Per-user: every CSV is imported into the requesting user's tenant. All
 * catalog/data writes carry user_id; all dedupe lookups are user-scoped.
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
  const { user, error } = await requireUserOr401();
  if (error) return error;
  const userId = user.id;

  // Per-user lifecycle. New POST supersedes the previous in-flight
  // import for this user (refresh + retry "just works"). The old one
  // unwinds at its next signal check inside processCsv. We also bridge
  // request.signal → our controller so a client disconnect (browser
  // refresh/close) trips the same path.
  const prev = activeImports.get(userId);
  if (prev) prev.abort(new Error("Superseded by a newer import"));
  const controller = new AbortController();
  activeImports.set(userId, controller);
  if (request.signal.aborted) {
    controller.abort(request.signal.reason);
  } else {
    request.signal.addEventListener("abort", () => {
      controller.abort(new Error("Client disconnected"));
    });
  }

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

  // Recognized filenames + their importers + their canonical execution
  // order all come from one source of truth: PIPELINE_ORDER. Adding a
  // new table = one new tuple, nothing else.
  const recognized = PIPELINE_ORDER.map(([csvKey]) => csvKey);
  const matched = recognized.filter((n) => n in csvs);
  if (matched.length === 0) {
    return NextResponse.json(
      {
        error: `No recognized CSVs found. Expected any of: ${recognized.join(", ")}. Got: ${Object.keys(csvs).join(", ") || "(none)"}`,
      },
      { status: 400 }
    );
  }

  // Build the import pipeline. Order matters: foundational catalog first
  // (so FKs resolve), then user targets (goals/focuses reference the
  // catalog), then measured data (events reference sports;
  // event_metrics/workout_sets reference events), then audit/cache rows
  // last. The pipeline only includes phases for CSVs actually present
  // in the upload, so a single-CSV import emits exactly one phase.
  // buildPipeline pre-computes row counts per phase (countCsvRows) so
  // the SSE frames carry a real denominator for the progress bar.
  // Cheap — line count, no validation. parseCsv-level errors still
  // surface in TableResult.errors per row at run time.
  const pipeline = buildPipeline(csvs, userId);

  const stream = makeSseStream<ImportFrameEvent>(async (emit) => {
    try {
      await signalStorage.run(controller.signal, async () => {
        await runPipeline(pipeline, emit);
      });
    } finally {
      // Only clear if we're still the active import — a successor may
      // have already replaced us and we shouldn't yank their slot.
      if (activeImports.get(userId) === controller) {
        activeImports.delete(userId);
      }
    }
  });

  return new NextResponse(stream, { headers: sseHeaders() });
}

async function runPipeline(
  pipeline: PipelinePhase[],
  emit: (event: ImportFrameEvent, data: unknown) => void,
): Promise<void> {
  const totalRows = pipeline.reduce((sum, p) => sum + p.rowTotal, 0);
  emit("start", {
    totalPhases: pipeline.length,
    totalRows,
    phases: pipeline.map((p) => ({ table: p.table, rowTotal: p.rowTotal })),
  } satisfies ImportStartFrame);
  const out: Partial<Record<ImportTable, TableResult>> = {};
  for (let i = 0; i < pipeline.length; i++) {
    const phase = pipeline[i];
    emit("phase", {
      index: i,
      total: pipeline.length,
      table: phase.table,
      rowTotal: phase.rowTotal,
      done: false,
    } satisfies ImportPhaseFrame);
    // AsyncLocalStorage carries the tick callback to processCsv;
    // importers themselves don't need to know about it.
    const tick = (rowsDone: number) => {
      emit("phase-progress", {
        index: i,
        total: pipeline.length,
        table: phase.table,
        rowsDone,
        rowTotal: phase.rowTotal,
      } satisfies ImportPhaseProgressFrame);
    };
    const result = await progressStorage.run(tick, () => phase.run());
    out[phase.table] = result;
    emit("phase", {
      index: i,
      total: pipeline.length,
      table: phase.table,
      rowTotal: phase.rowTotal,
      done: true,
      result,
    } satisfies ImportPhaseFrame);
  }
  emit("done", { result: out } satisfies ImportDoneFrame);
}

interface PipelinePhase {
  table: ImportTable;
  csv: string;
  /** Pre-computed via countCsvRows so the SSE frames carry a real denominator. */
  rowTotal: number;
  run: () => Promise<TableResult>;
}

/**
 * Filter PIPELINE_ORDER down to what's actually in the upload,
 * preserving the canonical import order. Each phase carries a closure
 * over the right importer + the user_id so the SSE pipeline can run
 * them uniformly.
 */
function buildPipeline(
  csvs: Record<string, string>,
  userId: number,
): PipelinePhase[] {
  const phases: PipelinePhase[] = [];
  for (const [csvKey, table, importer] of PIPELINE_ORDER) {
    const csv = csvs[csvKey];
    if (csv) {
      phases.push({
        table,
        csv,
        rowTotal: countCsvRows(csv),
        run: () => importer(csv, userId),
      });
    }
  }
  return phases;
}

/**
 * The single source of truth for the import pipeline: (csv filename,
 * table key, importer function) tuples in execution order. Order
 * matters — foundational catalog first (so FKs resolve), then user
 * targets (goals/focuses reference the catalog), then measured data
 * (events reference sports; event_metrics/workout_sets reference
 * events), then audit/cache rows last.
 *
 * Adding a new table = one new tuple here. `recognized`, the SSE
 * pipeline, and (via `ImportTable` in src/lib/import/sse-frames.ts)
 * the client result panel all derive from it.
 */
const PIPELINE_ORDER: ReadonlyArray<
  [string, ImportTable, (csv: string, userId: number) => Promise<TableResult>]
> = [
  ["sports.csv", "sports", importSportsTable],
  ["metric_types.csv", "metric_types", importMetricTypes],
  ["metric_type_aliases.csv", "metric_type_aliases", importMetricTypeAliases],
  ["import_sources.csv", "import_sources", importImportSources],
  ["source_settings.csv", "source_settings", importSourceSettings],
  ["goals.csv", "goals", importGoals],
  ["focuses.csv", "focuses", importFocuses],
  ["goal_journal_entries.csv", "goal_journal_entries", importGoalJournalEntries],
  ["dashboards.csv", "dashboards", importDashboards],
  ["dashboard_widgets.csv", "dashboard_widgets", importDashboardWidgets],
  ["metrics.csv", "metrics", importMetrics],
  ["events.csv", "events", importEvents],
  ["event_metrics.csv", "event_metrics", importEventMetrics],
  ["workout_sets.csv", "workout_sets", importWorkoutSets],
  ["event_duplicate_denylist.csv", "event_duplicate_denylist", importEventDuplicateDenylist],
  ["coach_calls.csv", "coach_calls", importCoachCalls],
  ["reconcile_log.csv", "reconcile_log", importReconcileLog],
  // daily_summaries.csv intentionally absent — it's a derived cache,
  // recomputed authoritatively by the metrics phase's
  // flushBulkImportRecomputes. Old export ZIPs that still include
  // daily_summaries.csv land in `csvs` but skip the pipeline because
  // they don't match any phase.
  ["merge_log.csv", "merge_log", importMergeLog],
];

/**
 * Cheap CSV row count: lines minus the header, ignoring any trailing
 * blank line. Doesn't parse — quoted-newline edge cases will produce a
 * slight overestimate, which is fine for a progress denominator.
 */
function countCsvRows(text: string): number {
  let lines = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) lines++;
  }
  // No trailing newline? The last unterminated line is still a row.
  if (text.length > 0 && text.charCodeAt(text.length - 1) !== 10) lines++;
  return Math.max(0, lines - 1);
}

// -----------------------------------------------------------------------------
// metrics.csv
// -----------------------------------------------------------------------------

async function importMetrics(text: string, userId: number): Promise<TableResult> {
  const typeCache = await buildMetricTypeCache(userId);
  // Defer daily-summary recomputes: collect touched (metricTypeId, date)
  // buckets during the row loop, then recompute each one ONCE at the
  // end. Without this, upsertMetric recomputes the same daily bucket
  // for every row in that bucket — making the metrics phase
  // O(rows × avg_bucket_size). With this, it's O(rows + distinct_buckets).
  const ctx: BulkImportContext = { touchedBuckets: new Set() };
  const result = await bulkImportStorage.run(ctx, () =>
    processCsv(
      "metrics.csv",
      text,
      ["recorded_at", "metric", "value"],
      async (row, idx) => {
      const recordedAt = row[idx.get("recorded_at")!];
      const metricName = row[idx.get("metric")!];
      const valueStr = row[idx.get("value")!];
      const unit = idx.has("unit") ? row[idx.get("unit")!] : "";
      const source = (idx.has("source") ? row[idx.get("source")!] : "") || "custom";
      let sourceId = idx.has("source_id") ? row[idx.get("source_id")!] : "";

      if (!recordedAt || !metricName || valueStr === "") {
        throw new Error("missing required field");
      }
      const value = Number(valueStr);
      if (!Number.isFinite(value)) throw new Error(`non-numeric value "${valueStr}"`);

      if (!sourceId) sourceId = `custom-${metricName}-${recordedAt}`;

      // Identity map: this endpoint is the round-trip restore path —
      // names in metrics.csv are exactly the canonical metric_type
      // names that came out of /api/export. We WANT them to look up
      // by name and hit the existing canonical (or, if missing in a
      // partial restore, auto-create under that exact name). Without
      // the identity map, a column like `bodyspec_dexa:bodyweight`
      // falls through to the orphan path and gets re-created as
      // `custom:bodyspec_dexa:bodyweight` — doubly-prefixed garbage.
      // The per-source wizard route is different: it uses orphan-first
      // because the user is mapping arbitrary column names there.
      const { id: metricTypeId, alias: metricAlias } = await resolveMetricTypeId({
        rawName: metricName,
        map: { [metricName]: metricName },
        sourceSystem: "custom",
        unit: unit || undefined,
        cache: typeCache,
      });

      const status = await upsertMetric({
        userId,
        metricTypeId,
        value,
        recordedAt,
        source,
        sourceId,
        alias: metricAlias,
      });
      return status === "accepted" ? "accepted" : "skipped";
    },
  ),
  );
  // Flush deferred recomputes: one per distinct (metricTypeId, date)
  // bucket touched during the import, no matter how many rows hit it.
  await flushBulkImportRecomputes(userId, ctx);
  return result;
}

// -----------------------------------------------------------------------------
// events.csv
// -----------------------------------------------------------------------------

async function importEvents(text: string, userId: number): Promise<TableResult> {
  const sportCache = await loadSportCache(userId);
  // Buffer composite-membership rows so the second pass can resolve
  // member source_ids → ids after all events are inserted. Without
  // this, a composite row might reference members that haven't been
  // upserted yet (especially the composite-first ordering case).
  const compositeRows: Array<{
    compositeSourceId: string;
    memberSourceIds: string[];
  }> = [];

  const result = await processCsv(
    "events.csv",
    text,
    ["started_at", "sport", "type"],
    async (row, idx) => {
      const startedAt = row[idx.get("started_at")!];
      const sportName = row[idx.get("sport")!];
      const type = row[idx.get("type")!];
      const durStr = idx.has("duration_minutes") ? row[idx.get("duration_minutes")!] : "";
      const notes = idx.has("notes") ? row[idx.get("notes")!] : "";
      const source = (idx.has("source") ? row[idx.get("source")!] : "") || "custom";
      let sourceId = idx.has("source_id") ? row[idx.get("source_id")!] : "";
      // Composite-event columns (optional; pre-composites exports won't
      // have them, defaults are safe).
      const statusCol = idx.has("status") ? row[idx.get("status")!] : "";
      const compositeMembersCol = idx.has("composite_members")
        ? row[idx.get("composite_members")!]
        : "";

      if (!startedAt || !sportName || !type) throw new Error("missing required field");
      const sportId = sportCache.get(sportName);
      if (!sportId) {
        throw new Error(
          `unknown sport "${sportName}" (known: ${[...sportCache.keys()].join(", ")})`,
        );
      }
      const duration = durStr === "" ? null : Number(durStr);
      if (duration !== null && !Number.isFinite(duration)) {
        throw new Error(`non-numeric duration "${durStr}"`);
      }

      if (!sourceId) sourceId = `custom-${sportName}-${type}-${startedAt}`;

      // Defer composite-member linking to the second pass.
      if (statusCol === "composite" && compositeMembersCol) {
        compositeRows.push({
          compositeSourceId: sourceId,
          memberSourceIds: compositeMembersCol.split("|").filter(Boolean),
        });
      }

      // If an existing row matches on the natural key but has no source_id,
      // adopt the synthesized one so future imports all dedupe against it.
      const natural = await db
        .select({ id: events.id, sourceId: events.sourceId })
        .from(events)
        .where(
          and(
            userScope(userId).events,
            eq(events.startedAt, startedAt),
            eq(events.sportId, sportId),
            eq(events.type, type),
          ),
        )
        .limit(1);
      if (natural.length > 0 && !natural[0].sourceId) {
        await db
          .update(events)
          .set({ sourceId })
          .where(and(userScope(userId).events, eq(events.id, natural[0].id)));
        return "skipped";
      }

      const { status } = await upsertEvent({
        userId,
        sportId,
        type,
        durationMinutes: duration,
        notes: notes || null,
        startedAt,
        source,
        sourceId,
      });
      return status === "accepted" ? "accepted" : "skipped";
    },
  );

  // Second pass: link composite events to their members and flip member
  // status to 'hidden_by_composite'. Uses source_id lookups so the
  // round-trip works even when the exporting DB's autoincrement ids
  // don't match the importer's.
  //
  // No processCsv here means no automatic signal check; bail explicitly
  // so a refresh during this block doesn't keep writing.
  if (compositeRows.length > 0) {
    throwIfAborted();
    const allMentioned = new Set<string>();
    for (const c of compositeRows) {
      allMentioned.add(c.compositeSourceId);
      for (const m of c.memberSourceIds) allMentioned.add(m);
    }
    const eventBySourceId = new Map<string, number>();
    const rows = await db
      .select({ id: events.id, sourceId: events.sourceId })
      .from(events)
      .where(
        and(
          userScope(userId).events,
          inArray(events.sourceId, [...allMentioned]),
        ),
      );
    for (const r of rows) {
      if (r.sourceId) eventBySourceId.set(r.sourceId, r.id);
    }

    for (const c of compositeRows) {
      throwIfAborted();
      const compositeId = eventBySourceId.get(c.compositeSourceId);
      if (compositeId === undefined) {
        result.errors.push(
          `events.csv composite: source_id "${c.compositeSourceId}" not found after import`,
        );
        continue;
      }
      const memberIds: number[] = [];
      const missing: string[] = [];
      for (const m of c.memberSourceIds) {
        const mid = eventBySourceId.get(m);
        if (mid === undefined) missing.push(m);
        else memberIds.push(mid);
      }
      if (missing.length > 0) {
        result.errors.push(
          `events.csv composite "${c.compositeSourceId}": missing members ${missing.join(", ")}`,
        );
      }
      if (memberIds.length === 0) continue;
      memberIds.sort((a, b) => a - b);
      await db
        .update(events)
        .set({ status: "composite", compositeMemberIds: memberIds })
        .where(and(userScope(userId).events, eq(events.id, compositeId)));
      await db
        .update(events)
        .set({ status: "hidden_by_composite" })
        .where(and(userScope(userId).events, inArray(events.id, memberIds)));
    }
  }

  return result;
}

// -----------------------------------------------------------------------------
// event_metrics.csv
// -----------------------------------------------------------------------------

async function importEventMetrics(text: string, userId: number): Promise<TableResult> {
  const sportCache = await loadSportCache(userId);
  const typeCache = await buildMetricTypeCache(userId);
  return processCsv(
    "event_metrics.csv",
    text,
    ["event_started_at", "sport", "event_type", "metric", "value"],
    async (row, idx) => {
      const startedAt = row[idx.get("event_started_at")!];
      const sportName = row[idx.get("sport")!];
      const eventType = row[idx.get("event_type")!];
      const eventSourceId = idx.has("event_source_id") ? row[idx.get("event_source_id")!] : "";
      const metricName = row[idx.get("metric")!];
      const unit = idx.has("unit") ? row[idx.get("unit")!] : "";
      const valueStr = row[idx.get("value")!];

      if (!startedAt || !sportName || !eventType || !metricName || valueStr === "") {
        throw new Error("missing required field");
      }
      const value = Number(valueStr);
      if (!Number.isFinite(value)) throw new Error(`non-numeric value "${valueStr}"`);
      const sportId = sportCache.get(sportName);
      if (!sportId) throw new Error(`unknown sport "${sportName}"`);

      let parentId = await resolveEventId({
        userId,
        sourceId: eventSourceId,
        startedAt,
        sportId,
        type: eventType,
      });
      if (parentId === null) {
        const synthId = eventSourceId || `custom-${sportName}-${eventType}-${startedAt}`;
        const { eventId } = await upsertEvent({
          userId,
          sportId,
          type: eventType,
          durationMinutes: null,
          notes: null,
          startedAt,
          source: "custom",
          sourceId: synthId,
        });
        parentId = eventId;
      }

      // Identity map for round-trip restore — see the comment on the
      // matching block in importMetrics() above for why this differs
      // from the per-source wizard route.
      const { id: metricTypeId } = await resolveMetricTypeId({
        rawName: metricName,
        map: { [metricName]: metricName },
        sourceSystem: "custom",
        unit: unit || undefined,
        cache: typeCache,
      });

      const status = await upsertEventMetric(parentId, metricTypeId, value);
      return status === "accepted" ? "accepted" : "updated";
    },
  );
}

// -----------------------------------------------------------------------------
// workout_sets.csv
// -----------------------------------------------------------------------------

async function importWorkoutSets(text: string, userId: number): Promise<TableResult> {
  const sportCache = await loadSportCache(userId);
  const typeCache = await buildMetricTypeCache(userId);
  return processCsv(
    "workout_sets.csv",
    text,
    ["event_started_at", "sport", "event_type", "exercise_name", "set_number", "reps", "weight"],
    async (row, idx) => {
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
        throw new Error("missing required field");
      }
      const sportId = sportCache.get(sportName);
      if (!sportId) throw new Error(`unknown sport "${sportName}"`);

      let parentId = await resolveEventId({
        userId,
        sourceId: eventSourceId,
        startedAt,
        sportId,
        type: eventType,
      });
      if (parentId === null) {
        const synthId = eventSourceId || `custom-${sportName}-${eventType}-${startedAt}`;
        const { eventId } = await upsertEvent({
          userId,
          sportId,
          type: eventType,
          durationMinutes: null,
          notes: null,
          startedAt,
          source: "custom",
          sourceId: synthId,
        });
        parentId = eventId;
      }

      // Identity map for round-trip restore — see comment on
      // importMetrics() above. workout_sets.csv carries the canonical
      // exercise name (e.g. "Barbell Deadlift" or "teambuildr:21s")
      // and we want it to find the existing metric_type or auto-create
      // under that exact name, not orphan-prefix on top.
      const { id: exerciseMetricTypeId } = await resolveMetricTypeId({
        rawName: exerciseName,
        map: { [exerciseName]: exerciseName },
        sourceSystem: "custom",
        cache: typeCache,
      });

      const input: WorkoutSetInput = {
        exerciseMetricTypeId,
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
        throw new Error("non-numeric set/reps/weight");
      }

      const status = await upsertWorkoutSet(parentId, input);
      return status === "accepted" ? "accepted" : "updated";
    },
  );
}

// -----------------------------------------------------------------------------
// event_duplicate_denylist.csv
// -----------------------------------------------------------------------------

/**
 * Round-trips the "don't re-suggest this pair as a duplicate" memory.
 * Both endpoints are referenced by source_id (the only stable id across
 * re-import). Dedupes on (event_a_id, event_b_id) after resolution —
 * matches the unique constraint on the table.
 */
async function importEventDuplicateDenylist(
  text: string,
  userId: number,
): Promise<TableResult> {
  return processCsv(
    "event_duplicate_denylist.csv",
    text,
    ["event_a_source_id", "event_b_source_id"],
    async (row, idx) => {
      const aSourceId = row[idx.get("event_a_source_id")!];
      const bSourceId = row[idx.get("event_b_source_id")!];
      const createdAt = idx.has("created_at") ? row[idx.get("created_at")!] : "";

      if (!aSourceId || !bSourceId) throw new Error("missing source_id");
      if (aSourceId === bSourceId) throw new Error("a == b not allowed");

      // Resolve both endpoints to local ids by source_id (user-scoped).
      const resolved = await db
        .select({ id: events.id, sourceId: events.sourceId })
        .from(events)
        .where(
          and(
            userScope(userId).events,
            inArray(events.sourceId, [aSourceId, bSourceId]),
          ),
        );
      const bySource = new Map<string, number>();
      for (const r of resolved) {
        if (r.sourceId) bySource.set(r.sourceId, r.id);
      }
      const aId = bySource.get(aSourceId);
      const bId = bySource.get(bSourceId);
      if (aId === undefined || bId === undefined) {
        throw new Error(
          `unresolved member(s): ${[
            aId === undefined ? aSourceId : null,
            bId === undefined ? bSourceId : null,
          ]
            .filter(Boolean)
            .join(", ")}`,
        );
      }
      // The CHECK constraint requires event_a_id < event_b_id. Sort
      // before insert.
      const [lo, hi] = aId < bId ? [aId, bId] : [bId, aId];
      const inserted = await db
        .insert(eventDuplicateDenylist)
        .values({
          userId,
          eventAId: lo,
          eventBId: hi,
          createdAt: createdAt || new Date().toISOString(),
        })
        .onConflictDoNothing()
        .returning({ id: eventDuplicateDenylist.id });
      return inserted.length > 0 ? "accepted" : "skipped";
    },
  );
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

async function loadSportCache(userId: number): Promise<Map<string, number>> {
  const rows = await db
    .select({ id: sports.id, name: sports.name })
    .from(sports)
    .where(userScope(userId).sports);
  return new Map(rows.map((r) => [r.name, r.id]));
}

/**
 * Run a CSV import for a single table. Handles the repeated boilerplate:
 * header validation, per-row try/catch, row-N error formatting, result
 * counting. The per-row handler throws an Error for soft validation
 * failures ("missing required field", "unknown sport", etc.) and returns
 * "accepted" | "skipped" | "updated" for successful outcomes. Errors
 * thrown inside the handler are caught and formatted as
 * `<filename> row <N>: <message>` (N is 1-indexed + 1 for the header row).
 *
 * Row-level progress: when called inside `progressStorage.run()`, the
 * stored callback fires every PROGRESS_TICK_EVERY rows + once at the
 * end. Per-request scope via AsyncLocalStorage so concurrent imports
 * don't cross-talk; importers themselves don't have to know about it.
 */
type RowOutcome = "accepted" | "skipped" | "updated";

const PROGRESS_TICK_EVERY = 100;

/**
 * Per-request progress emitter, populated by the streaming pipeline.
 * AsyncLocalStorage scopes the callback to the request that set it, so
 * two concurrent /api/import calls in the same Node process don't
 * accidentally emit each other's progress frames.
 */
const progressStorage = new AsyncLocalStorage<(rowsDone: number) => void>();

/**
 * Per-request abort signal. Tripped on either:
 *   - client disconnect (browser refresh/close — `request.signal` fires)
 *   - a newer /api/import call for the same user (replace semantics)
 *
 * processCsv checks `signal.aborted` between rows so the importer
 * unwinds within milliseconds of the trip. importEvents's composite
 * second pass checks it explicitly too — that block runs without
 * processCsv and would otherwise complete on top of an orphaned
 * request.
 */
const signalStorage = new AsyncLocalStorage<AbortSignal>();

/**
 * Per-user concurrency lock. Only one /api/import may be running per
 * user at a time; a new POST aborts the in-flight one and takes over.
 * In-memory is fine for the self-hosted single-process deployment;
 * multi-process would need a DB-row lock.
 */
const activeImports = new Map<number, AbortController>();

function throwIfAborted(): void {
  const signal = signalStorage.getStore();
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }
}

async function processCsv(
  filename: string,
  text: string,
  requiredCols: string[],
  handle: (row: string[], idx: Map<string, number>) => Promise<RowOutcome>,
): Promise<TableResult> {
  const result = emptyResult();
  const { headers, rows } = parseCsv(text);
  const onProgress = progressStorage.getStore();
  let idx: Map<string, number>;
  try {
    idx = headerIndex(headers, requiredCols);
  } catch (err) {
    result.errors.push(
      `${filename}: ${err instanceof Error ? err.message : String(err)}`,
    );
    onProgress?.(0);
    return result;
  }
  for (const [i, row] of rows.entries()) {
    // Cooperative cancellation: client disconnect or supersession by
    // a newer import for the same user trips signalStorage. Checked
    // every row so the importer aborts within milliseconds rather than
    // running to completion on an orphan request.
    throwIfAborted();
    try {
      const outcome = await handle(row, idx);
      if (outcome === "accepted") result.accepted++;
      else if (outcome === "skipped") result.skipped++;
      else result.updated++;
    } catch (err) {
      result.errors.push(
        `${filename} row ${i + 2}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (onProgress && (i + 1) % PROGRESS_TICK_EVERY === 0) {
      onProgress(i + 1);
    }
  }
  // Final tick so the client lands on rowsDone === total rows.
  onProgress?.(rows.length);
  return result;
}

// -----------------------------------------------------------------------------
// Foundational catalog + user targets — all use processCsv for boilerplate.
// -----------------------------------------------------------------------------

async function importSportsTable(text: string, userId: number): Promise<TableResult> {
  return processCsv("sports.csv", text, ["name", "color"], async (row, idx) => {
    const name = row[idx.get("name")!];
    const color = row[idx.get("color")!];
    if (!name || !color) throw new Error("missing required field");
    // Per-user uniqueness on (user_id, name). Conflict target updated
    // accordingly so the same sport name in different users coexists.
    const inserted = await db
      .insert(sports)
      .values({ userId, name, color })
      .onConflictDoNothing({ target: [sports.userId, sports.name] })
      .returning({ id: sports.id });
    return inserted.length > 0 ? "accepted" : "skipped";
  });
}

async function importMetricTypes(text: string, userId: number): Promise<TableResult> {
  const sportCache = await loadSportCache(userId);
  return processCsv(
    "metric_types.csv",
    text,
    ["name", "unit", "frequency_hint"],
    async (row, idx) => {
      const name = row[idx.get("name")!];
      const unit = row[idx.get("unit")!] ?? "";
      const freqStr = row[idx.get("frequency_hint")!] ?? "daily";
      const sportName = idx.has("sport") ? row[idx.get("sport")!] : "";
      // target + higher_is_better are optional for backward compat with
      // pre-2026-05-04 exports (the columns didn't exist yet). Missing
      // column = leave existing values alone on conflict.
      const targetRaw = idx.has("target") ? row[idx.get("target")!] : "";
      const hibRaw = idx.has("higher_is_better") ? row[idx.get("higher_is_better")!] : "";
      if (!name) throw new Error("missing name");
      if (freqStr !== "daily" && freqStr !== "weekly" && freqStr !== "occasional") {
        throw new Error(`invalid frequency_hint "${freqStr}"`);
      }
      let target: number | null = null;
      if (targetRaw !== "") {
        const n = Number(targetRaw);
        if (!Number.isFinite(n)) throw new Error(`non-numeric target "${targetRaw}"`);
        target = n;
      }
      const higherIsBetter = hibRaw === "" ? true : hibRaw === "1" || hibRaw === "true";
      const sportId = sportName ? sportCache.get(sportName) ?? null : null;
      if (sportName && !sportId) throw new Error(`unknown sport "${sportName}"`);

      // Upsert on the unique (user_id, name) index so re-import refreshes
      // target / higher_is_better on existing rows. Only update mutable
      // config fields — never touch identity.
      const inserted = await db
        .insert(metricTypes)
        .values({ userId, name, unit, frequencyHint: freqStr, sportId, target, higherIsBetter })
        .onConflictDoUpdate({
          target: [metricTypes.userId, metricTypes.name],
          set: { unit, frequencyHint: freqStr, sportId, target, higherIsBetter },
        })
        .returning({ id: metricTypes.id });
      return inserted.length > 0 ? "accepted" : "skipped";
    },
  );
}

async function importMetricTypeAliases(text: string, userId: number): Promise<TableResult> {
  const typeCache = await buildMetricTypeCache(userId);
  return processCsv(
    "metric_type_aliases.csv",
    text,
    ["alias", "canonical"],
    async (row, idx) => {
      const alias = row[idx.get("alias")!];
      const canonical = row[idx.get("canonical")!];
      if (!alias || !canonical) throw new Error("missing required field");
      const canonicalId = typeCache.byName.get(canonical);
      if (canonicalId === undefined) {
        throw new Error(`canonical metric "${canonical}" not found`);
      }
      const inserted = await db
        .insert(metricTypeAliases)
        .values({ userId, alias, canonicalMetricTypeId: canonicalId })
        .onConflictDoNothing()
        .returning({ alias: metricTypeAliases.alias });
      return inserted.length > 0 ? "accepted" : "skipped";
    },
  );
}

async function importImportSources(text: string, userId: number): Promise<TableResult> {
  return processCsv(
    "import_sources.csv",
    text,
    ["name", "kind", "mapping"],
    async (row, idx) => {
      const name = row[idx.get("name")!];
      const kind = row[idx.get("kind")!];
      const mapping = row[idx.get("mapping")!];
      if (!name || !kind || !mapping) throw new Error("missing required field");
      if (kind !== "metrics" && kind !== "events" && kind !== "workout_sets") {
        throw new Error(`invalid kind "${kind}"`);
      }
      const inserted = await db
        .insert(importSources)
        .values({ userId, name, kind, mapping })
        .onConflictDoNothing()
        .returning({ id: importSources.id });
      return inserted.length > 0 ? "accepted" : "skipped";
    },
  );
}

async function importSourceSettings(text: string, userId: number): Promise<TableResult> {
  return processCsv(
    "source_settings.csv",
    text,
    ["source", "reconcile_enabled"],
    async (row, idx) => {
      const source = row[idx.get("source")!];
      const enabledStr = row[idx.get("reconcile_enabled")!];
      if (!source) throw new Error("missing source");
      const reconcileEnabled =
        enabledStr === "1" || enabledStr.toLowerCase() === "true";
      const existing = await db
        .select({ reconcileEnabled: sourceSettings.reconcileEnabled })
        .from(sourceSettings)
        .where(and(userScope(userId).sourceSettings, eq(sourceSettings.source, source)))
        .limit(1);
      if (existing.length === 0) {
        await db.insert(sourceSettings).values({ userId, source, reconcileEnabled });
        return "accepted";
      }
      if (existing[0].reconcileEnabled === reconcileEnabled) return "skipped";
      await db
        .update(sourceSettings)
        .set({ reconcileEnabled, updatedAt: new Date().toISOString() })
        .where(and(userScope(userId).sourceSettings, eq(sourceSettings.source, source)));
      return "updated";
    },
  );
}

async function importGoals(text: string, userId: number): Promise<TableResult> {
  const sportCache = await loadSportCache(userId);
  const typeCache = await buildMetricTypeCache(userId);
  return processCsv(
    "goals.csv",
    text,
    ["sport", "metric", "target_value", "deadline"],
    async (row, idx) => {
      const sportName = row[idx.get("sport")!];
      const metricName = row[idx.get("metric")!];
      const targetStr = row[idx.get("target_value")!];
      const deadline = row[idx.get("deadline")!];
      const status =
        (idx.has("status") ? row[idx.get("status")!] : "active") || "active";
      if (!sportName || !metricName || targetStr === "" || !deadline) {
        throw new Error("missing required field");
      }
      if (!isStatus(status)) throw new Error(`invalid status "${status}"`);
      const target = Number(targetStr);
      if (!Number.isFinite(target)) {
        throw new Error(`non-numeric target_value "${targetStr}"`);
      }
      const sportId = sportCache.get(sportName);
      if (!sportId) throw new Error(`unknown sport "${sportName}"`);
      const metricTypeId = typeCache.byName.get(metricName);
      if (metricTypeId === undefined) throw new Error(`unknown metric "${metricName}"`);
      // Natural-key dedupe: (sportId, metricTypeId, deadline). Scoped
      // by user_id so two users with similar goals don't collide.
      const existing = await db
        .select({ id: goals.id })
        .from(goals)
        .where(
          and(
            userScope(userId).goals,
            eq(goals.sportId, sportId),
            eq(goals.metricTypeId, metricTypeId),
            eq(goals.deadline, deadline),
          ),
        )
        .limit(1);
      if (existing.length > 0) return "skipped";
      await db.insert(goals).values({
        userId,
        sportId,
        metricTypeId,
        targetValue: target,
        deadline,
        status,
      });
      return "accepted";
    },
  );
}

async function importFocuses(text: string, userId: number): Promise<TableResult> {
  const sportCache = await loadSportCache(userId);
  const typeCache = await buildMetricTypeCache(userId);
  // focuses is INHERIT — restrict via this user's goals.
  const ownedGoalIds = db
    .select({ id: goals.id })
    .from(goals)
    .where(userScope(userId).goals);
  return processCsv(
    "focuses.csv",
    text,
    ["name", "start_date", "goal_sport", "goal_metric", "goal_deadline"],
    async (row, idx) => {
      const name = row[idx.get("name")!];
      const startDate = row[idx.get("start_date")!];
      const goalSport = row[idx.get("goal_sport")!];
      const goalMetric = row[idx.get("goal_metric")!];
      const goalDeadline = row[idx.get("goal_deadline")!];
      const source =
        (idx.has("source") ? row[idx.get("source")!] : "manual") || "manual";
      const endDate = idx.has("end_date") ? row[idx.get("end_date")!] : "";
      const status =
        (idx.has("status") ? row[idx.get("status")!] : "active") || "active";
      const technicalNotes = idx.has("technical_notes")
        ? row[idx.get("technical_notes")!]
        : "";
      const evidence = idx.has("evidence") ? row[idx.get("evidence")!] : "";
      const dismissedAt = idx.has("dismissed_at")
        ? row[idx.get("dismissed_at")!]
        : "";

      if (!name || !startDate || !goalSport || !goalMetric || !goalDeadline) {
        throw new Error("missing required field");
      }
      if (!isStatus(status)) throw new Error(`invalid status "${status}"`);
      if (source !== "manual" && source !== "llm") {
        throw new Error(`invalid source "${source}"`);
      }

      const goalSportId = sportCache.get(goalSport);
      if (!goalSportId) throw new Error(`unknown sport "${goalSport}"`);
      const goalMetricTypeId = typeCache.byName.get(goalMetric);
      if (goalMetricTypeId === undefined) {
        throw new Error(`unknown metric "${goalMetric}"`);
      }

      const g = await db
        .select({ id: goals.id })
        .from(goals)
        .where(
          and(
            userScope(userId).goals,
            eq(goals.sportId, goalSportId),
            eq(goals.metricTypeId, goalMetricTypeId),
            eq(goals.deadline, goalDeadline),
          ),
        )
        .limit(1);
      if (g.length === 0) {
        throw new Error(
          `goal not found for (${goalSport}, ${goalMetric}, ${goalDeadline})`,
        );
      }
      const goalId = g[0].id;

      // Natural-key dedupe: (goalId, name, startDate). Restrict to focuses
      // on this user's goals.
      const existing = await db
        .select({ id: focuses.id })
        .from(focuses)
        .where(
          and(
            eq(focuses.goalId, goalId),
            eq(focuses.name, name),
            eq(focuses.startDate, startDate),
            inArray(focuses.goalId, ownedGoalIds),
          ),
        )
        .limit(1);
      if (existing.length > 0) return "skipped";
      await db.insert(focuses).values({
        name,
        goalId,
        source: source as "manual" | "llm",
        startDate,
        endDate: endDate || null,
        status,
        technicalNotes: technicalNotes || null,
        evidence: evidence || null,
        dismissedAt: dismissedAt || null,
      });
      return "accepted";
    },
  );
}

async function importGoalJournalEntries(text: string, userId: number): Promise<TableResult> {
  const sportCache = await loadSportCache(userId);
  const typeCache = await buildMetricTypeCache(userId);
  const ownedGoalIds = db
    .select({ id: goals.id })
    .from(goals)
    .where(userScope(userId).goals);
  return processCsv(
    "goal_journal_entries.csv",
    text,
    ["goal_sport", "goal_metric", "goal_deadline", "content"],
    async (row, idx) => {
      const goalSport = row[idx.get("goal_sport")!];
      const goalMetric = row[idx.get("goal_metric")!];
      const goalDeadline = row[idx.get("goal_deadline")!];
      const content = row[idx.get("content")!];
      const createdAt = idx.has("created_at") ? row[idx.get("created_at")!] : "";
      const verdictFocusName = idx.has("verdict_focus_name")
        ? row[idx.get("verdict_focus_name")!]
        : "";
      const verdictFocusStartDate = idx.has("verdict_focus_start_date")
        ? row[idx.get("verdict_focus_start_date")!]
        : "";
      const linkedMetric = idx.has("linked_metric")
        ? row[idx.get("linked_metric")!]
        : "";

      if (!goalSport || !goalMetric || !goalDeadline || !content) {
        throw new Error("missing required field");
      }
      const goalSportId = sportCache.get(goalSport);
      if (!goalSportId) throw new Error(`unknown sport "${goalSport}"`);
      const goalMetricTypeId = typeCache.byName.get(goalMetric);
      if (goalMetricTypeId === undefined) {
        throw new Error(`unknown metric "${goalMetric}"`);
      }

      const g = await db
        .select({ id: goals.id })
        .from(goals)
        .where(
          and(
            userScope(userId).goals,
            eq(goals.sportId, goalSportId),
            eq(goals.metricTypeId, goalMetricTypeId),
            eq(goals.deadline, goalDeadline),
          ),
        )
        .limit(1);
      if (g.length === 0) {
        throw new Error(
          `goal not found for (${goalSport}, ${goalMetric}, ${goalDeadline})`,
        );
      }
      const goalId = g[0].id;

      // Optional verdict_focus link: resolve by (goal_id, name, start_date).
      let verdictFocusId: number | null = null;
      if (verdictFocusName && verdictFocusStartDate) {
        const f = await db
          .select({ id: focuses.id })
          .from(focuses)
          .where(
            and(
              eq(focuses.goalId, goalId),
              eq(focuses.name, verdictFocusName),
              eq(focuses.startDate, verdictFocusStartDate),
              inArray(focuses.goalId, ownedGoalIds),
            ),
          )
          .limit(1);
        verdictFocusId = f[0]?.id ?? null;
      }

      // Optional linked_metric: resolve by name.
      let linkedMetricTypeId: number | null = null;
      if (linkedMetric) {
        linkedMetricTypeId = typeCache.byName.get(linkedMetric) ?? null;
      }

      // Dedupe by (goal_id, content, created_at) if created_at was exported;
      // otherwise (goal_id, content) — covers the common re-import case.
      // Restrict to journal entries on this user's goals.
      const dedupeConditions = createdAt
        ? [
            eq(goalJournalEntries.goalId, goalId),
            eq(goalJournalEntries.content, content),
            eq(goalJournalEntries.createdAt, createdAt),
            inArray(goalJournalEntries.goalId, ownedGoalIds),
          ]
        : [
            eq(goalJournalEntries.goalId, goalId),
            eq(goalJournalEntries.content, content),
            inArray(goalJournalEntries.goalId, ownedGoalIds),
          ];
      const existing = await db
        .select({ id: goalJournalEntries.id })
        .from(goalJournalEntries)
        .where(and(...dedupeConditions))
        .limit(1);
      if (existing.length > 0) return "skipped";
      await db.insert(goalJournalEntries).values({
        goalId,
        content,
        verdictFocusId,
        linkedMetricTypeId,
        ...(createdAt ? { createdAt } : {}),
      });
      return "accepted";
    },
  );
}

/**
 * dashboards.csv: keyed by (userId, slug). INSERT OR IGNORE so re-importing
 * the same export is a no-op. is_system + seeded_id are preserved from the
 * export, which keeps the seed migration's idempotency intact.
 */
async function importDashboards(text: string, userId: number): Promise<TableResult> {
  const sportCache = await loadSportCache(userId);
  return processCsv(
    "dashboards.csv",
    text,
    ["slug", "name"],
    async (row, idx) => {
      const slug = row[idx.get("slug")!];
      const name = row[idx.get("name")!];
      const icon = idx.has("icon") ? row[idx.get("icon")!] : "";
      const sportName = idx.has("sport_name") ? row[idx.get("sport_name")!] : "";
      const positionRaw = idx.has("position") ? row[idx.get("position")!] : "0";
      const isSystemRaw = idx.has("is_system") ? row[idx.get("is_system")!] : "0";
      const seededId = idx.has("seeded_id") ? row[idx.get("seeded_id")!] : "";
      if (!slug || !name) throw new Error("missing slug or name");

      const sportId = sportName ? sportCache.get(sportName) ?? null : null;
      if (sportName && !sportId) throw new Error(`unknown sport "${sportName}"`);

      const position = Number(positionRaw);
      if (!Number.isFinite(position)) throw new Error(`invalid position "${positionRaw}"`);
      const isSystem = isSystemRaw === "1" || isSystemRaw.toLowerCase() === "true";

      const inserted = await db
        .insert(dashboards)
        .values({
          userId,
          slug,
          name,
          icon: icon || null,
          sportId,
          position,
          isSystem,
          seededId: seededId || null,
        })
        .onConflictDoNothing()
        .returning({ id: dashboards.id });
      return inserted.length > 0 ? "accepted" : "skipped";
    },
  );
}

/**
 * dashboard_widgets.csv: parent dashboard resolved by (userId, slug).
 * Idempotent on (dashboard_id, widget_type, position) within the user's
 * dashboards. dashboard_widgets is INHERIT — never write to dashboards
 * outside this user's tenant.
 */
async function importDashboardWidgets(text: string, userId: number): Promise<TableResult> {
  // Build a slug -> id cache so we don't roundtrip per row. Scoped by user.
  const dashRows = await db
    .select({ id: dashboards.id, slug: dashboards.slug })
    .from(dashboards)
    .where(userScope(userId).dashboards);
  const dashCache = new Map(dashRows.map((r) => [r.slug, r.id]));

  // Pre-load existing widgets keyed by (dashboard_id, widget_type, position)
  // so per-row checks are in-memory. Restricted to this user's dashboards.
  const ownedDashboardIds = dashRows.map((r) => r.id);
  const existing = ownedDashboardIds.length > 0
    ? await db
        .select({
          dashboardId: dashboardWidgets.dashboardId,
          widgetType: dashboardWidgets.widgetType,
          position: dashboardWidgets.position,
        })
        .from(dashboardWidgets)
        .where(inArray(dashboardWidgets.dashboardId, ownedDashboardIds))
    : [];
  const existingKeys = new Set(
    existing.map((r) => `${r.dashboardId}|${r.widgetType}|${r.position}`),
  );

  return processCsv(
    "dashboard_widgets.csv",
    text,
    ["dashboard_slug", "widget_type", "config", "grid_x", "grid_y", "grid_w", "grid_h"],
    async (row, idx) => {
      const slug = row[idx.get("dashboard_slug")!];
      const widgetType = row[idx.get("widget_type")!];
      const config = row[idx.get("config")!] || "{}";
      const body = idx.has("body") ? row[idx.get("body")!] : "";
      const gridX = Number(row[idx.get("grid_x")!]);
      const gridY = Number(row[idx.get("grid_y")!]);
      const gridW = Number(row[idx.get("grid_w")!]);
      const gridH = Number(row[idx.get("grid_h")!]);
      const position = idx.has("position") ? Number(row[idx.get("position")!]) : 0;

      if (!slug || !widgetType) throw new Error("missing dashboard_slug or widget_type");
      if (![gridX, gridY, gridW, gridH, position].every(Number.isFinite)) {
        throw new Error("grid coordinates must be numbers");
      }
      const dashboardId = dashCache.get(slug);
      if (dashboardId === undefined) throw new Error(`unknown dashboard "${slug}"`);

      // Validate config JSON parses + matches at least the shape of *some*
      // widget schema (we don't require the registry to know this widget_type
      // — the migration import shouldn't fail on a forward-compat widget the
      // current code doesn't recognize yet, the slot will fall back gracefully).
      try {
        JSON.parse(config);
      } catch {
        throw new Error(`config is not valid JSON`);
      }

      const key = `${dashboardId}|${widgetType}|${position}`;
      if (existingKeys.has(key)) return "skipped";

      await db.insert(dashboardWidgets).values({
        dashboardId,
        widgetType,
        config,
        body: body || null,
        gridX,
        gridY,
        gridW,
        gridH,
        position,
      });
      // Add to the set so within-batch duplicates also get caught (e.g.
      // a malformed bundle with two rows for the same key).
      existingKeys.add(key);
      return "accepted";
    },
  );
}

// -----------------------------------------------------------------------------
// coach_calls.csv
// -----------------------------------------------------------------------------

/**
 * coach_calls is an audit log: append-mostly, no schema-level uniqueness.
 * For idempotent re-imports we dedupe on (ts, endpoint, model, status) —
 * tight enough that two separate calls won't collide, loose enough that
 * the same row from two exports skips cleanly. goal_id resolves from the
 * (sport, metric, deadline) natural key; missing or unresolvable = NULL
 * (matches the schema's set-null on goal delete).
 */
async function importCoachCalls(text: string, userId: number): Promise<TableResult> {
  const sportCache = await loadSportCache(userId);
  const typeCache = await buildMetricTypeCache(userId);
  return processCsv(
    "coach_calls.csv",
    text,
    ["ts", "endpoint", "model"],
    async (row, idx) => {
      const ts = row[idx.get("ts")!];
      const endpoint = row[idx.get("endpoint")!];
      const model = row[idx.get("model")!];
      const tokensIn = idx.has("tokens_in") ? Number(row[idx.get("tokens_in")!] || 0) : 0;
      const tokensOut = idx.has("tokens_out") ? Number(row[idx.get("tokens_out")!] || 0) : 0;
      const durationMs = idx.has("duration_ms") ? Number(row[idx.get("duration_ms")!] || 0) : 0;
      const status = (idx.has("status") ? row[idx.get("status")!] : "success") || "success";
      const goalSport = idx.has("goal_sport") ? row[idx.get("goal_sport")!] : "";
      const goalMetric = idx.has("goal_metric") ? row[idx.get("goal_metric")!] : "";
      const goalDeadline = idx.has("goal_deadline") ? row[idx.get("goal_deadline")!] : "";

      if (!ts || !endpoint || !model) throw new Error("missing required field");
      if (![tokensIn, tokensOut, durationMs].every(Number.isFinite)) {
        throw new Error("token / duration columns must be numeric");
      }

      let goalId: number | null = null;
      if (goalSport && goalMetric && goalDeadline) {
        const sportId = sportCache.get(goalSport);
        const metricTypeId = typeCache.byName.get(goalMetric);
        if (sportId && metricTypeId !== undefined) {
          const g = await db
            .select({ id: goals.id })
            .from(goals)
            .where(
              and(
                userScope(userId).goals,
                eq(goals.sportId, sportId),
                eq(goals.metricTypeId, metricTypeId),
                eq(goals.deadline, goalDeadline),
              ),
            )
            .limit(1);
          goalId = g[0]?.id ?? null;
        }
      }

      // Soft uniqueness check (no DB constraint to lean on). Cheap because
      // ts is indexed. Scoped by user_id.
      const existing = await db
        .select({ id: coachCalls.id })
        .from(coachCalls)
        .where(
          and(
            userScope(userId).coachCalls,
            eq(coachCalls.ts, ts),
            eq(coachCalls.endpoint, endpoint),
            eq(coachCalls.model, model),
            eq(coachCalls.status, status),
          ),
        )
        .limit(1);
      if (existing.length > 0) return "skipped";

      await db.insert(coachCalls).values({
        userId,
        ts,
        endpoint,
        goalId,
        tokensIn,
        tokensOut,
        durationMs,
        model,
        status,
      });
      return "accepted";
    },
  );
}

// -----------------------------------------------------------------------------
// reconcile_log.csv
// -----------------------------------------------------------------------------

/**
 * reconcile_log is also append-mostly. Soft uniqueness on
 * (source, kind, at, range_start, range_end) — these together identify a
 * single reconcile batch. metric is a natural-key reference to a
 * metric_type that may have been merged away (the schema's metric_type_id
 * has no FK for that reason); we resolve when possible, NULL otherwise.
 */
async function importReconcileLog(text: string, userId: number): Promise<TableResult> {
  const typeCache = await buildMetricTypeCache(userId);
  return processCsv(
    "reconcile_log.csv",
    text,
    ["source", "kind", "deleted_count", "range_start", "range_end", "at"],
    async (row, idx) => {
      const source = row[idx.get("source")!];
      const kind = row[idx.get("kind")!];
      const metric = idx.has("metric") ? row[idx.get("metric")!] : "";
      const deletedCount = Number(row[idx.get("deleted_count")!]);
      const rangeStart = row[idx.get("range_start")!];
      const rangeEnd = row[idx.get("range_end")!];
      const at = row[idx.get("at")!];

      if (!source || !kind || !rangeStart || !rangeEnd || !at) {
        throw new Error("missing required field");
      }
      if (kind !== "metric" && kind !== "event") {
        throw new Error(`invalid kind "${kind}"`);
      }
      if (!Number.isFinite(deletedCount)) {
        throw new Error("deleted_count must be numeric");
      }

      const metricTypeId = metric ? typeCache.byName.get(metric) ?? null : null;

      const existing = await db
        .select({ id: reconcileLog.id })
        .from(reconcileLog)
        .where(
          and(
            userScope(userId).reconcileLog,
            eq(reconcileLog.source, source),
            eq(reconcileLog.kind, kind),
            eq(reconcileLog.at, at),
            eq(reconcileLog.rangeStart, rangeStart),
            eq(reconcileLog.rangeEnd, rangeEnd),
          ),
        )
        .limit(1);
      if (existing.length > 0) return "skipped";

      await db.insert(reconcileLog).values({
        userId,
        source,
        kind,
        metricTypeId,
        deletedCount,
        rangeStart,
        rangeEnd,
        at,
      });
      return "accepted";
    },
  );
}

/**
 * merge_log.csv (audit-only round-trip).
 *
 * Each row carries kind, created_at, the canonical id+name from the
 * exported DB, the merged_names (display string), the JSON payload, and
 * undone_at + user_id. We DON'T trust the canonical_id integer — the
 * exporting DB's autoincrement sequence may not match the importing
 * DB's. We re-resolve canonical_id by canonical_name when the
 * referenced row exists; otherwise we keep the exported integer
 * (purely for display) and the undo endpoint's pre-check will 409 if
 * the user later tries to undo it. This is the correct failure mode:
 * exported merges are an audit log, not a redo log.
 *
 * Dedup natural key: (kind, created_at, canonical_name, merged_names).
 * Re-running import on the same bundle is a no-op.
 *
 * The exported CSV's user_id column is IGNORED — every imported merge_log
 * row is attributed to the *requesting* user's tenant (not the exporter's).
 * Cross-user "import these audit rows as me" is the right semantic for an
 * import; the exporter's user_id is just bookkeeping.
 */
async function importMergeLog(text: string, userId: number): Promise<TableResult> {
  const typeCache = await buildMetricTypeCache(userId);
  // Build a sport-name → id cache once for the same purpose, scoped to user.
  const sportRows = await db
    .select({ id: sports.id, name: sports.name })
    .from(sports)
    .where(userScope(userId).sports);
  const sportCache = new Map(sportRows.map((r) => [r.name, r.id]));

  return processCsv(
    "merge_log.csv",
    text,
    [
      "kind",
      "created_at",
      "canonical_id",
      "canonical_name",
      "merged_names",
      "payload",
    ],
    async (row, idx) => {
      const kindRaw = row[idx.get("kind")!];
      const createdAt = row[idx.get("created_at")!];
      const canonicalIdRaw = row[idx.get("canonical_id")!];
      const canonicalName = row[idx.get("canonical_name")!];
      const mergedNames = row[idx.get("merged_names")!];
      const payload = row[idx.get("payload")!];
      const undoneAt = idx.has("undone_at") ? row[idx.get("undone_at")!] : "";

      if (!kindRaw || !createdAt || !canonicalName || !payload) {
        throw new Error("missing required field");
      }
      if (kindRaw !== "metric_type" && kindRaw !== "sport") {
        throw new Error(`invalid kind "${kindRaw}"`);
      }

      // Re-resolve canonical_id by canonical_name. If the row exists
      // here, use the local id; otherwise fall back to the exported
      // integer (display-only — the undo endpoint catches stale ids).
      let canonicalId: number;
      if (kindRaw === "metric_type") {
        const id = typeCache.byName.get(canonicalName);
        canonicalId = id ?? (Number(canonicalIdRaw) || 0);
      } else {
        const id = sportCache.get(canonicalName);
        canonicalId = id ?? (Number(canonicalIdRaw) || 0);
      }

      // Dedup on (user_id, kind, created_at, canonical_name, merged_names).
      const existing = await db
        .select({ id: mergeLog.id })
        .from(mergeLog)
        .where(
          and(
            userScope(userId).mergeLog,
            eq(mergeLog.kind, kindRaw),
            eq(mergeLog.createdAt, createdAt),
            eq(mergeLog.canonicalName, canonicalName),
            eq(mergeLog.mergedNames, mergedNames),
          ),
        )
        .limit(1);
      if (existing.length > 0) return "skipped";

      await db.insert(mergeLog).values({
        userId,
        kind: kindRaw,
        createdAt,
        canonicalId,
        canonicalName,
        mergedNames,
        payload,
        undoneAt: undoneAt || null,
      });
      return "accepted";
    },
  );
}
