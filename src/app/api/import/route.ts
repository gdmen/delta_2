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
  focusMetricLinks,
  focusEntries,
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
 *   - focuses.csv                - dedupe by (sport, name, start_date)
 *   - focus_metric_links.csv     - resolve focus by natural key, INSERT OR IGNORE
 *   - focus_entries.csv          - dedupe by (focus, content, created_at)
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
 * `csv_import:<rawName>` so they're visible but don't collide with canonicals.
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
    "focus_metric_links.csv",
    "focus_entries.csv",
    "metrics.csv",
    "events.csv",
    "event_metrics.csv",
    "workout_sets.csv",
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

  // --- focus_metric_links.csv ----------------------------------------------
  if (csvs["focus_metric_links.csv"]) {
    out.focus_metric_links = await importFocusMetricLinks(csvs["focus_metric_links.csv"]);
  }

  // --- focus_entries.csv ---------------------------------------------------
  if (csvs["focus_entries.csv"]) {
    out.focus_entries = await importFocusEntries(csvs["focus_entries.csv"]);
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
      const source = (idx.has("source") ? row[idx.get("source")!] : "") || "csv_import";
      let sourceId = idx.has("source_id") ? row[idx.get("source_id")!] : "";

      if (!recordedAt || !metricName || valueStr === "") {
        throw new Error("missing required field");
      }
      const value = Number(valueStr);
      if (!Number.isFinite(value)) throw new Error(`non-numeric value "${valueStr}"`);

      if (!sourceId) sourceId = `csv_import-${metricName}-${recordedAt}`;

      const metricTypeId = await resolveMetricTypeId({
        rawName: metricName,
        map: { [metricName]: metricName },
        sourceSystem: "csv_import",
        unit: unit || undefined,
        cache: typeCache,
      });

      const status = await upsertMetric({
        metricTypeId,
        value,
        recordedAt,
        source,
        sourceId,
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
      const source = (idx.has("source") ? row[idx.get("source")!] : "") || "csv_import";
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

      if (!sourceId) sourceId = `csv_import-${sportName}-${type}-${startedAt}`;

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

      const metricTypeId = await resolveMetricTypeId({
        rawName: metricName,
        map: { [metricName]: metricName },
        sourceSystem: "csv_import",
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

      // Identity map routes raw name → existing canonical via resolver step 1.
      // Same pattern the metrics CSV importer uses so a re-import doesn't
      // orphan a `csv_import:<name>` duplicate when a bare-name row exists.
      const exerciseMetricTypeId = await resolveMetricTypeId({
        rawName: exerciseName,
        map: { [exerciseName]: exerciseName },
        sourceSystem: "csv_import",
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
      if (!name) throw new Error("missing name");
      if (freqStr !== "daily" && freqStr !== "weekly" && freqStr !== "occasional") {
        throw new Error(`invalid frequency_hint "${freqStr}"`);
      }
      const sportId = sportName ? sportCache.get(sportName) ?? null : null;
      if (sportName && !sportId) throw new Error(`unknown sport "${sportName}"`);
      const inserted = await db
        .insert(metricTypes)
        .values({ name, unit, frequencyHint: freqStr, sportId })
        .onConflictDoNothing()
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
    ["name", "sport", "start_date"],
    async (row, idx) => {
      const name = row[idx.get("name")!];
      const sportName = row[idx.get("sport")!];
      const startDate = row[idx.get("start_date")!];
      const endDate = idx.has("end_date") ? row[idx.get("end_date")!] : "";
      const status =
        (idx.has("status") ? row[idx.get("status")!] : "active") || "active";
      const technicalNotes = idx.has("technical_notes")
        ? row[idx.get("technical_notes")!]
        : "";
      const goalSport = idx.has("goal_sport") ? row[idx.get("goal_sport")!] : "";
      const goalMetric = idx.has("goal_metric") ? row[idx.get("goal_metric")!] : "";
      const goalDeadline = idx.has("goal_deadline")
        ? row[idx.get("goal_deadline")!]
        : "";

      if (!name || !sportName || !startDate) throw new Error("missing required field");
      if (!isStatus(status)) throw new Error(`invalid status "${status}"`);
      const sportId = sportCache.get(sportName);
      if (!sportId) throw new Error(`unknown sport "${sportName}"`);

      // Resolve optional linked goal by its (sport, metric, deadline) tuple.
      let goalId: number | null = null;
      if (goalSport && goalMetric && goalDeadline) {
        const goalSportId = sportCache.get(goalSport);
        const goalMetricTypeId = typeCache.byName.get(goalMetric);
        if (goalSportId && goalMetricTypeId) {
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
          goalId = g[0]?.id ?? null;
        }
      }

      // Natural-key dedupe: (sportId, name, startDate).
      const existing = await db
        .select({ id: focuses.id })
        .from(focuses)
        .where(
          and(
            eq(focuses.sportId, sportId),
            eq(focuses.name, name),
            eq(focuses.startDate, startDate),
          ),
        )
        .limit(1);
      if (existing.length > 0) return "skipped";
      await db.insert(focuses).values({
        name,
        sportId,
        goalId,
        startDate,
        endDate: endDate || null,
        status,
        technicalNotes: technicalNotes || null,
      });
      return "accepted";
    },
  );
}

async function importFocusMetricLinks(text: string): Promise<TableResult> {
  const sportCache = await loadSportCache();
  const typeCache = await buildMetricTypeCache();
  return processCsv(
    "focus_metric_links.csv",
    text,
    ["focus_name", "focus_sport", "focus_start_date", "metric"],
    async (row, idx) => {
      const focusName = row[idx.get("focus_name")!];
      const focusSport = row[idx.get("focus_sport")!];
      const focusStartDate = row[idx.get("focus_start_date")!];
      const metricName = row[idx.get("metric")!];
      if (!focusName || !focusSport || !focusStartDate || !metricName) {
        throw new Error("missing required field");
      }
      const sportId = sportCache.get(focusSport);
      if (!sportId) throw new Error(`unknown sport "${focusSport}"`);
      const metricTypeId = typeCache.byName.get(metricName);
      if (metricTypeId === undefined) throw new Error(`unknown metric "${metricName}"`);
      const focus = await db
        .select({ id: focuses.id })
        .from(focuses)
        .where(
          and(
            eq(focuses.sportId, sportId),
            eq(focuses.name, focusName),
            eq(focuses.startDate, focusStartDate),
          ),
        )
        .limit(1);
      if (focus.length === 0) {
        throw new Error(
          `focus "${focusName}" (${focusSport}, ${focusStartDate}) not found`,
        );
      }
      const focusId = focus[0].id;
      const existing = await db
        .select({ focusId: focusMetricLinks.focusId })
        .from(focusMetricLinks)
        .where(
          and(
            eq(focusMetricLinks.focusId, focusId),
            eq(focusMetricLinks.metricTypeId, metricTypeId),
          ),
        )
        .limit(1);
      if (existing.length > 0) return "skipped";
      await db.insert(focusMetricLinks).values({ focusId, metricTypeId });
      return "accepted";
    },
  );
}

async function importFocusEntries(text: string): Promise<TableResult> {
  const sportCache = await loadSportCache();
  return processCsv(
    "focus_entries.csv",
    text,
    ["focus_name", "focus_sport", "focus_start_date", "content"],
    async (row, idx) => {
      const focusName = row[idx.get("focus_name")!];
      const focusSport = row[idx.get("focus_sport")!];
      const focusStartDate = row[idx.get("focus_start_date")!];
      const content = row[idx.get("content")!];
      const createdAt = idx.has("created_at") ? row[idx.get("created_at")!] : "";
      if (!focusName || !focusSport || !focusStartDate || !content) {
        throw new Error("missing required field");
      }
      const sportId = sportCache.get(focusSport);
      if (!sportId) throw new Error(`unknown sport "${focusSport}"`);
      const focus = await db
        .select({ id: focuses.id })
        .from(focuses)
        .where(
          and(
            eq(focuses.sportId, sportId),
            eq(focuses.name, focusName),
            eq(focuses.startDate, focusStartDate),
          ),
        )
        .limit(1);
      if (focus.length === 0) {
        throw new Error(
          `focus "${focusName}" (${focusSport}, ${focusStartDate}) not found`,
        );
      }
      const focusId = focus[0].id;
      // Dedupe by (focus_id, content, created_at) if created_at was exported;
      // otherwise just by (focus_id, content) to avoid duplicating on re-import.
      const dedupeConditions = createdAt
        ? [
            eq(focusEntries.focusId, focusId),
            eq(focusEntries.content, content),
            eq(focusEntries.createdAt, createdAt),
          ]
        : [eq(focusEntries.focusId, focusId), eq(focusEntries.content, content)];
      const existing = await db
        .select({ id: focusEntries.id })
        .from(focusEntries)
        .where(and(...dedupeConditions))
        .limit(1);
      if (existing.length > 0) return "skipped";
      await db
        .insert(focusEntries)
        .values({ focusId, content, ...(createdAt ? { createdAt } : {}) });
      return "accepted";
    },
  );
}
