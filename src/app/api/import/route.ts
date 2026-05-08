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
  dailySummaries,
  mergeLog,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
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
  type WorkoutSetInput,
} from "@/lib/ingest-service";
import { isStatus } from "@/lib/enums";

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

  const recognized = [
    "sports.csv",
    "metric_types.csv",
    "metric_type_aliases.csv",
    "import_sources.csv",
    "source_settings.csv",
    "goals.csv",
    "focuses.csv",
    "goal_journal_entries.csv",
    "dashboards.csv",
    "dashboard_widgets.csv",
    "metrics.csv",
    "events.csv",
    "event_metrics.csv",
    "workout_sets.csv",
    "coach_calls.csv",
    "reconcile_log.csv",
    "daily_summaries.csv",
    "merge_log.csv",
  ];
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

  // Order below matters: foundational catalog first (so FKs resolve),
  // then user targets (goals/focuses reference the catalog), then measured
  // data (events reference sports; event_metrics/workout_sets reference events).

  // --- sports.csv ----------------------------------------------------------
  if (csvs["sports.csv"]) {
    out.sports = await importSportsTable(csvs["sports.csv"]);
  }

  // --- metric_types.csv ----------------------------------------------------
  if (csvs["metric_types.csv"]) {
    out.metric_types = await importMetricTypes(csvs["metric_types.csv"]);
  }

  // --- metric_type_aliases.csv ---------------------------------------------
  if (csvs["metric_type_aliases.csv"]) {
    out.metric_type_aliases = await importMetricTypeAliases(csvs["metric_type_aliases.csv"]);
  }

  // --- import_sources.csv --------------------------------------------------
  if (csvs["import_sources.csv"]) {
    out.import_sources = await importImportSources(csvs["import_sources.csv"]);
  }

  // --- source_settings.csv -------------------------------------------------
  if (csvs["source_settings.csv"]) {
    out.source_settings = await importSourceSettings(csvs["source_settings.csv"]);
  }

  // --- goals.csv -----------------------------------------------------------
  if (csvs["goals.csv"]) {
    out.goals = await importGoals(csvs["goals.csv"]);
  }

  // --- focuses.csv ---------------------------------------------------------
  if (csvs["focuses.csv"]) {
    out.focuses = await importFocuses(csvs["focuses.csv"]);
  }

  // --- goal_journal_entries.csv -------------------------------------------
  if (csvs["goal_journal_entries.csv"]) {
    out.goal_journal_entries = await importGoalJournalEntries(
      csvs["goal_journal_entries.csv"],
    );
  }

  // --- dashboards.csv ------------------------------------------------------
  // Dashboards run before dashboard_widgets so the parent rows exist.
  if (csvs["dashboards.csv"]) {
    out.dashboards = await importDashboards(csvs["dashboards.csv"]);
  }

  // --- dashboard_widgets.csv -----------------------------------------------
  // Widgets resolve their parent dashboard by slug. Re-importing without a
  // prior wipe will append duplicate widgets — the documented round-trip is
  // wipe + import, not import-on-top-of.
  if (csvs["dashboard_widgets.csv"]) {
    out.dashboard_widgets = await importDashboardWidgets(csvs["dashboard_widgets.csv"]);
  }

  // --- metrics.csv ---------------------------------------------------------
  if (csvs["metrics.csv"]) {
    out.metrics = await importMetrics(csvs["metrics.csv"]);
  }

  // --- events.csv ----------------------------------------------------------
  if (csvs["events.csv"]) {
    out.events = await importEvents(csvs["events.csv"]);
  }

  // --- event_metrics.csv ---------------------------------------------------
  // Runs after events.csv so parent events exist. Same parent-resolution
  // strategy as workout_sets: event_source_id first, then (started_at,
  // sport, type) natural key, else auto-create a barebones parent event.
  if (csvs["event_metrics.csv"]) {
    out.event_metrics = await importEventMetrics(csvs["event_metrics.csv"]);
  }

  // --- workout_sets.csv ----------------------------------------------------
  // Must run after events.csv so parent events exist (if the user bundled
  // both). When users import workout_sets.csv alone, we try to find existing
  // events by their natural key; if missing, we error on that row.
  if (csvs["workout_sets.csv"]) {
    out.workout_sets = await importWorkoutSets(csvs["workout_sets.csv"]);
  }

  // --- coach_calls.csv -----------------------------------------------------
  // Operational history. Runs after goals so the goal_id FK can be resolved
  // by natural key (sport, metric, deadline).
  if (csvs["coach_calls.csv"]) {
    out.coach_calls = await importCoachCalls(csvs["coach_calls.csv"]);
  }

  // --- reconcile_log.csv ---------------------------------------------------
  // Runs after metric_types so the metric_type_id reference resolves by name.
  // Tolerates an empty `metric` column (matches the schema's nullable FK).
  if (csvs["reconcile_log.csv"]) {
    out.reconcile_log = await importReconcileLog(csvs["reconcile_log.csv"]);
  }

  // --- daily_summaries.csv -------------------------------------------------
  // Aggregation cache. Upserts on (date, metric_type_id) so re-importing
  // refreshes the cached values; also regenerates organically from raw
  // metrics, so importing this is purely a recovery-time-saver.
  if (csvs["daily_summaries.csv"]) {
    out.daily_summaries = await importDailySummaries(csvs["daily_summaries.csv"]);
  }

  // --- merge_log.csv -------------------------------------------------------
  // Audit history of past merges. Re-imports as audit-only — the
  // payload's embedded row ids point at the EXPORTED database's
  // autoincrement sequences, so undoing a re-imported merge will 409 at
  // the canonical-id pre-check (correct failure mode). canonical_id is
  // re-resolved by canonical_name when possible.
  if (csvs["merge_log.csv"]) {
    out.merge_log = await importMergeLog(csvs["merge_log.csv"]);
  }

  return NextResponse.json(out);
}

// -----------------------------------------------------------------------------
// metrics.csv
// -----------------------------------------------------------------------------

async function importMetrics(text: string): Promise<TableResult> {
  const typeCache = await buildMetricTypeCache();
  return processCsv(
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

      // Orphan-first: drop identity map so unknown columns auto-create
      // as `custom:${name}` instead of silently routing to whatever
      // canonical happens to share the name. Matches the per-source
      // import route's behavior.
      const { id: metricTypeId, alias: metricAlias } = await resolveMetricTypeId({
        rawName: metricName,
        map: {},
        sourceSystem: "custom",
        unit: unit || undefined,
        cache: typeCache,
      });

      const status = await upsertMetric({
        metricTypeId,
        value,
        recordedAt,
        source,
        sourceId,
        alias: metricAlias,
      });
      return status === "accepted" ? "accepted" : "skipped";
    },
  );
}

// -----------------------------------------------------------------------------
// events.csv
// -----------------------------------------------------------------------------

async function importEvents(text: string): Promise<TableResult> {
  const sportCache = await loadSportCache();
  return processCsv(
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

      // If an existing row matches on the natural key but has no source_id,
      // adopt the synthesized one so future imports all dedupe against it.
      const natural = await db
        .select({ id: events.id, sourceId: events.sourceId })
        .from(events)
        .where(
          and(
            eq(events.startedAt, startedAt),
            eq(events.sportId, sportId),
            eq(events.type, type),
          ),
        )
        .limit(1);
      if (natural.length > 0 && !natural[0].sourceId) {
        await db.update(events).set({ sourceId }).where(eq(events.id, natural[0].id));
        return "skipped";
      }

      const { status } = await upsertEvent({
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
}

// -----------------------------------------------------------------------------
// event_metrics.csv
// -----------------------------------------------------------------------------

async function importEventMetrics(text: string): Promise<TableResult> {
  const sportCache = await loadSportCache();
  const typeCache = await buildMetricTypeCache();
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
        sourceId: eventSourceId,
        startedAt,
        sportId,
        type: eventType,
      });
      if (parentId === null) {
        const synthId = eventSourceId || `custom-${sportName}-${eventType}-${startedAt}`;
        const { eventId } = await upsertEvent({
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

      const { id: metricTypeId } = await resolveMetricTypeId({
        rawName: metricName,
        map: {},
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

async function importWorkoutSets(text: string): Promise<TableResult> {
  const sportCache = await loadSportCache();
  const typeCache = await buildMetricTypeCache();
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
        sourceId: eventSourceId,
        startedAt,
        sportId,
        type: eventType,
      });
      if (parentId === null) {
        const synthId = eventSourceId || `custom-${sportName}-${eventType}-${startedAt}`;
        const { eventId } = await upsertEvent({
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

      // Orphan-first: exercise names land under `custom:${name}`
      // unless an alias routes them. Matches the per-source import path.
      const { id: exerciseMetricTypeId } = await resolveMetricTypeId({
        rawName: exerciseName,
        map: {},
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
// helpers
// -----------------------------------------------------------------------------

async function loadSportCache(): Promise<Map<string, number>> {
  const rows = await db.select({ id: sports.id, name: sports.name }).from(sports);
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
 */
type RowOutcome = "accepted" | "skipped" | "updated";

async function processCsv(
  filename: string,
  text: string,
  requiredCols: string[],
  handle: (row: string[], idx: Map<string, number>) => Promise<RowOutcome>,
): Promise<TableResult> {
  const result = emptyResult();
  const { headers, rows } = parseCsv(text);
  let idx: Map<string, number>;
  try {
    idx = headerIndex(headers, requiredCols);
  } catch (err) {
    result.errors.push(
      `${filename}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return result;
  }
  for (const [i, row] of rows.entries()) {
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
  }
  return result;
}

// -----------------------------------------------------------------------------
// Foundational catalog + user targets — all use processCsv for boilerplate.
// -----------------------------------------------------------------------------

async function importSportsTable(text: string): Promise<TableResult> {
  return processCsv("sports.csv", text, ["name", "color"], async (row, idx) => {
    const name = row[idx.get("name")!];
    const color = row[idx.get("color")!];
    if (!name || !color) throw new Error("missing required field");
    const inserted = await db
      .insert(sports)
      .values({ name, color })
      .onConflictDoNothing()
      .returning({ id: sports.id });
    return inserted.length > 0 ? "accepted" : "skipped";
  });
}

async function importMetricTypes(text: string): Promise<TableResult> {
  const sportCache = await loadSportCache();
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

      // Upsert on the unique name index so re-import refreshes target /
      // higher_is_better on existing rows (insert-only would skip them
      // and the user's "import to restore my targets" flow would silently
      // fail). Only update mutable config fields — never touch identity.
      const inserted = await db
        .insert(metricTypes)
        .values({ name, unit, frequencyHint: freqStr, sportId, target, higherIsBetter })
        .onConflictDoUpdate({
          target: metricTypes.name,
          set: { unit, frequencyHint: freqStr, sportId, target, higherIsBetter },
        })
        .returning({ id: metricTypes.id });
      return inserted.length > 0 ? "accepted" : "skipped";
    },
  );
}

async function importMetricTypeAliases(text: string): Promise<TableResult> {
  const typeCache = await buildMetricTypeCache();
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
        .values({ alias, canonicalMetricTypeId: canonicalId })
        .onConflictDoNothing()
        .returning({ alias: metricTypeAliases.alias });
      return inserted.length > 0 ? "accepted" : "skipped";
    },
  );
}

async function importImportSources(text: string): Promise<TableResult> {
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
        .values({ name, kind, mapping })
        .onConflictDoNothing()
        .returning({ id: importSources.id });
      return inserted.length > 0 ? "accepted" : "skipped";
    },
  );
}

async function importSourceSettings(text: string): Promise<TableResult> {
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
        .where(eq(sourceSettings.source, source))
        .limit(1);
      if (existing.length === 0) {
        await db.insert(sourceSettings).values({ source, reconcileEnabled });
        return "accepted";
      }
      if (existing[0].reconcileEnabled === reconcileEnabled) return "skipped";
      await db
        .update(sourceSettings)
        .set({ reconcileEnabled, updatedAt: new Date().toISOString() })
        .where(eq(sourceSettings.source, source));
      return "updated";
    },
  );
}

async function importGoals(text: string): Promise<TableResult> {
  const sportCache = await loadSportCache();
  const typeCache = await buildMetricTypeCache();
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
      // Natural-key dedupe: (sportId, metricTypeId, deadline).
      const existing = await db
        .select({ id: goals.id })
        .from(goals)
        .where(
          and(
            eq(goals.sportId, sportId),
            eq(goals.metricTypeId, metricTypeId),
            eq(goals.deadline, deadline),
          ),
        )
        .limit(1);
      if (existing.length > 0) return "skipped";
      await db.insert(goals).values({
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

async function importFocuses(text: string): Promise<TableResult> {
  const sportCache = await loadSportCache();
  const typeCache = await buildMetricTypeCache();
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

      // Natural-key dedupe: (goalId, name, startDate).
      const existing = await db
        .select({ id: focuses.id })
        .from(focuses)
        .where(
          and(
            eq(focuses.goalId, goalId),
            eq(focuses.name, name),
            eq(focuses.startDate, startDate),
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

async function importGoalJournalEntries(text: string): Promise<TableResult> {
  const sportCache = await loadSportCache();
  const typeCache = await buildMetricTypeCache();
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
      const dedupeConditions = createdAt
        ? [
            eq(goalJournalEntries.goalId, goalId),
            eq(goalJournalEntries.content, content),
            eq(goalJournalEntries.createdAt, createdAt),
          ]
        : [
            eq(goalJournalEntries.goalId, goalId),
            eq(goalJournalEntries.content, content),
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
 * dashboards.csv: keyed by slug (UNIQUE on the table). INSERT OR IGNORE so
 * re-importing the same export is a no-op. is_system + seeded_id are preserved
 * from the export, which keeps the seed migration's idempotency intact.
 */
async function importDashboards(text: string): Promise<TableResult> {
  const sportCache = await loadSportCache();
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
 * dashboard_widgets.csv: parent dashboard resolved by slug. No natural unique
 * key on widgets (config blobs differ row-to-row), so this handler always
 * inserts. The documented round-trip is wipe + import, not import-on-top-of —
 * doing the latter without a wipe will produce duplicate widget rows.
 */
async function importDashboardWidgets(text: string): Promise<TableResult> {
  // Build a slug -> id cache so we don't roundtrip per row.
  const dashRows = await db.select({ id: dashboards.id, slug: dashboards.slug }).from(dashboards);
  const dashCache = new Map(dashRows.map((r) => [r.slug, r.id]));

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
async function importCoachCalls(text: string): Promise<TableResult> {
  const sportCache = await loadSportCache();
  const typeCache = await buildMetricTypeCache();
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
      // ts is indexed.
      const existing = await db
        .select({ id: coachCalls.id })
        .from(coachCalls)
        .where(
          and(
            eq(coachCalls.ts, ts),
            eq(coachCalls.endpoint, endpoint),
            eq(coachCalls.model, model),
            eq(coachCalls.status, status),
          ),
        )
        .limit(1);
      if (existing.length > 0) return "skipped";

      await db.insert(coachCalls).values({
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
async function importReconcileLog(text: string): Promise<TableResult> {
  const typeCache = await buildMetricTypeCache();
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

// -----------------------------------------------------------------------------
// daily_summaries.csv
// -----------------------------------------------------------------------------

/**
 * Cache of per-day per-metric aggregates. Has a unique index on
 * (date, metric_type_id) so we can upsert directly. Skips rows whose
 * metric doesn't exist locally (the cache will rebuild from raw metrics
 * on the next aggregation pass).
 */
async function importDailySummaries(text: string): Promise<TableResult> {
  const typeCache = await buildMetricTypeCache();
  return processCsv(
    "daily_summaries.csv",
    text,
    ["date", "metric", "count"],
    async (row, idx) => {
      const date = row[idx.get("date")!];
      const metric = row[idx.get("metric")!];
      const count = Number(row[idx.get("count")!]);
      const avgRaw = idx.has("avg_value") ? row[idx.get("avg_value")!] : "";
      const minRaw = idx.has("min_value") ? row[idx.get("min_value")!] : "";
      const maxRaw = idx.has("max_value") ? row[idx.get("max_value")!] : "";
      const lastIngestAt = idx.has("last_ingest_at") ? row[idx.get("last_ingest_at")!] : "";

      if (!date || !metric) throw new Error("missing date or metric");
      if (!Number.isFinite(count)) throw new Error("count must be numeric");

      const metricTypeId = typeCache.byName.get(metric);
      if (metricTypeId === undefined) return "skipped";

      const parseNullable = (s: string): number | null => {
        if (s === "") return null;
        const n = Number(s);
        if (!Number.isFinite(n)) throw new Error(`non-numeric value "${s}"`);
        return n;
      };
      const avgValue = parseNullable(avgRaw);
      const minValue = parseNullable(minRaw);
      const maxValue = parseNullable(maxRaw);

      const inserted = await db
        .insert(dailySummaries)
        .values({
          date,
          metricTypeId,
          avgValue,
          minValue,
          maxValue,
          count,
          lastIngestAt: lastIngestAt || null,
        })
        .onConflictDoUpdate({
          target: [dailySummaries.date, dailySummaries.metricTypeId],
          set: {
            avgValue,
            minValue,
            maxValue,
            count,
            lastIngestAt: lastIngestAt || null,
          },
        })
        .returning({ id: dailySummaries.id });
      return inserted.length > 0 ? "accepted" : "skipped";
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
 */
async function importMergeLog(text: string): Promise<TableResult> {
  const typeCache = await buildMetricTypeCache();
  // Build a sport-name → id cache once for the same purpose.
  const sportRows = await db.select({ id: sports.id, name: sports.name }).from(sports);
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
      const userIdRaw = idx.has("user_id") ? row[idx.get("user_id")!] : "";

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

      const userId =
        userIdRaw === "" ? null : Number.isFinite(Number(userIdRaw)) ? Number(userIdRaw) : null;

      // Dedup on (kind, created_at, canonical_name, merged_names).
      const existing = await db
        .select({ id: mergeLog.id })
        .from(mergeLog)
        .where(
          and(
            eq(mergeLog.kind, kindRaw),
            eq(mergeLog.createdAt, createdAt),
            eq(mergeLog.canonicalName, canonicalName),
            eq(mergeLog.mergedNames, mergedNames),
          ),
        )
        .limit(1);
      if (existing.length > 0) return "skipped";

      await db.insert(mergeLog).values({
        kind: kindRaw,
        createdAt,
        canonicalId,
        canonicalName,
        mergedNames,
        payload,
        undoneAt: undoneAt || null,
        userId,
      });
      return "accepted";
    },
  );
}
