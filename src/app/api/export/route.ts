import { NextResponse } from "next/server";
import { zipSync, strToU8 } from "fflate";
import { db } from "@/db";
import {
  metrics,
  events,
  eventMetrics,
  workoutSets,
  metricTypes,
  metricTypeAliases,
  sports,
  importSources,
  sourceSettings,
  goals,
  focuses,
  goalJournalEntries,
} from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { serializeCsv } from "@/lib/csv";

/**
 * GET /api/export
 *
 * Returns a ZIP of all foundational data — everything needed to wipe the
 * DB and restore the app to the same functional state.
 *
 * Foundational catalog:
 *   - sports.csv                 - name, color
 *   - metric_types.csv           - canonical + user-created metric types
 *   - metric_type_aliases.csv    - merge-result alias routing
 *   - import_sources.csv         - saved custom CSV import mappings
 *   - source_settings.csv        - per-source reconcile toggle
 *
 * User-configured targets:
 *   - goals.csv                  - goals with target + deadline
 *   - focuses.csv                - manual + LLM-suggested focuses, owned by goals
 *   - goal_journal_entries.csv   - per-goal markdown journal (timestamped)
 *
 * Measured data:
 *   - metrics.csv                - timestamped numeric streams
 *   - events.csv                 - sessions (runs, rides, strength days, BJJ)
 *   - event_metrics.csv          - per-event dimensions (distance, HR, ...)
 *   - workout_sets.csv           - per-set lifting details
 *
 * Deliberately NOT exported:
 *   - ingest_configs             - OAuth tokens; re-connect after restore
 *   - coach_calls                - LLM call metadata; rebuilds on use
 *   - daily_summaries            - aggregation cache; regenerates
 *   - reconcile_log              - audit trail; regenerates
 *
 * Everything uses human-readable natural keys (metric / sport / focus name)
 * instead of DB IDs so the CSVs are self-describing and round-trip through
 * the matching import endpoint (or any other SQL/spreadsheet tool).
 */
export async function GET() {
  // --- sports.csv ----------------------------------------------------------
  const sportRows = await db.select().from(sports).orderBy(asc(sports.name));
  const sportsCsv = serializeCsv(
    ["name", "color"],
    sportRows.map((r) => [r.name, r.color]),
  );

  // --- metric_types.csv ----------------------------------------------------
  // Left-join sports so the optional sport link round-trips by name.
  const mtRows = await db
    .select({
      name: metricTypes.name,
      unit: metricTypes.unit,
      frequencyHint: metricTypes.frequencyHint,
      sport: sports.name,
    })
    .from(metricTypes)
    .leftJoin(sports, eq(metricTypes.sportId, sports.id))
    .orderBy(asc(metricTypes.name));
  const metricTypesCsv = serializeCsv(
    ["name", "unit", "frequency_hint", "sport"],
    mtRows.map((r) => [r.name, r.unit, r.frequencyHint, r.sport ?? ""]),
  );

  // --- metric_type_aliases.csv ---------------------------------------------
  const aliasRows = await db
    .select({
      alias: metricTypeAliases.alias,
      canonical: metricTypes.name,
    })
    .from(metricTypeAliases)
    .innerJoin(
      metricTypes,
      eq(metricTypeAliases.canonicalMetricTypeId, metricTypes.id),
    )
    .orderBy(asc(metricTypeAliases.alias));
  const metricTypeAliasesCsv = serializeCsv(
    ["alias", "canonical"],
    aliasRows.map((r) => [r.alias, r.canonical]),
  );

  // --- import_sources.csv --------------------------------------------------
  // The `mapping` column is an opaque JSON string; it round-trips as a
  // single CSV cell. serializeCsv handles the quoting.
  const importSourceRows = await db
    .select()
    .from(importSources)
    .orderBy(asc(importSources.name));
  const importSourcesCsv = serializeCsv(
    ["name", "kind", "mapping"],
    importSourceRows.map((r) => [r.name, r.kind, r.mapping]),
  );

  // --- source_settings.csv -------------------------------------------------
  const sourceSettingRows = await db
    .select()
    .from(sourceSettings)
    .orderBy(asc(sourceSettings.source));
  const sourceSettingsCsv = serializeCsv(
    ["source", "reconcile_enabled"],
    sourceSettingRows.map((r) => [r.source, r.reconcileEnabled ? "1" : "0"]),
  );

  // --- goals.csv -----------------------------------------------------------
  const goalRows = await db
    .select({
      sport: sports.name,
      metric: metricTypes.name,
      targetValue: goals.targetValue,
      deadline: goals.deadline,
      status: goals.status,
    })
    .from(goals)
    .innerJoin(sports, eq(goals.sportId, sports.id))
    .innerJoin(metricTypes, eq(goals.metricTypeId, metricTypes.id))
    .orderBy(asc(goals.deadline));
  const goalsCsv = serializeCsv(
    ["sport", "metric", "target_value", "deadline", "status"],
    goalRows.map((r) => [r.sport, r.metric, r.targetValue, r.deadline, r.status]),
  );

  // --- focuses.csv ---------------------------------------------------------
  // Focuses now belong to goals; sport reaches the focus via the goal. Natural
  // key for round-trip: (goal_sport, goal_metric, goal_deadline, name, start_date).
  // The importer resolves the goal first, then attaches the focus.
  const focusRows = await db
    .select({
      name: focuses.name,
      source: focuses.source,
      startDate: focuses.startDate,
      endDate: focuses.endDate,
      status: focuses.status,
      technicalNotes: focuses.technicalNotes,
      evidence: focuses.evidence,
      dismissedAt: focuses.dismissedAt,
      goalSport: sports.name,
      goalMetric: metricTypes.name,
      goalDeadline: goals.deadline,
    })
    .from(focuses)
    .innerJoin(goals, eq(focuses.goalId, goals.id))
    .innerJoin(sports, eq(goals.sportId, sports.id))
    .innerJoin(metricTypes, eq(goals.metricTypeId, metricTypes.id))
    .orderBy(asc(focuses.startDate));

  const focusesCsv = serializeCsv(
    [
      "name",
      "source",
      "start_date",
      "end_date",
      "status",
      "technical_notes",
      "evidence",
      "dismissed_at",
      "goal_sport",
      "goal_metric",
      "goal_deadline",
    ],
    focusRows.map((r) => [
      r.name,
      r.source,
      r.startDate,
      r.endDate ?? "",
      r.status,
      r.technicalNotes ?? "",
      r.evidence ?? "",
      r.dismissedAt ?? "",
      r.goalSport,
      r.goalMetric,
      r.goalDeadline,
    ]),
  );

  // --- goal_journal_entries.csv --------------------------------------------
  // Per-goal markdown journal. Round-trip natural key for the parent goal is
  // (goal_sport, goal_metric, goal_deadline). verdict_focus_id is exported as
  // the focus's (name, start_date) tuple so it survives ID changes.
  const journalRows = await db
    .select({
      content: goalJournalEntries.content,
      createdAt: goalJournalEntries.createdAt,
      goalSport: sports.name,
      goalMetric: metricTypes.name,
      goalDeadline: goals.deadline,
      verdictFocusName: focuses.name,
      verdictFocusStartDate: focuses.startDate,
      linkedMetric: alias(metricTypes, "linked_mt").name,
    })
    .from(goalJournalEntries)
    .innerJoin(goals, eq(goalJournalEntries.goalId, goals.id))
    .innerJoin(sports, eq(goals.sportId, sports.id))
    .innerJoin(metricTypes, eq(goals.metricTypeId, metricTypes.id))
    .leftJoin(focuses, eq(goalJournalEntries.verdictFocusId, focuses.id))
    .leftJoin(
      alias(metricTypes, "linked_mt"),
      eq(goalJournalEntries.linkedMetricTypeId, alias(metricTypes, "linked_mt").id),
    )
    .orderBy(asc(goalJournalEntries.createdAt));
  const goalJournalEntriesCsv = serializeCsv(
    [
      "goal_sport",
      "goal_metric",
      "goal_deadline",
      "content",
      "created_at",
      "verdict_focus_name",
      "verdict_focus_start_date",
      "linked_metric",
    ],
    journalRows.map((r) => [
      r.goalSport,
      r.goalMetric,
      r.goalDeadline,
      r.content,
      r.createdAt,
      r.verdictFocusName ?? "",
      r.verdictFocusStartDate ?? "",
      r.linkedMetric ?? "",
    ]),
  );

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
  // Inner-join metric_types to turn exercise_metric_type_id back into the
  // canonical exercise_name, preserving the CSV schema for round-trip.
  const setRows = await db
    .select({
      eventStartedAt: events.startedAt,
      sport: sports.name,
      eventType: events.type,
      eventSourceId: events.sourceId,
      exerciseName: metricTypes.name,
      setNumber: workoutSets.setNumber,
      reps: workoutSets.reps,
      weight: workoutSets.weight,
      rpe: workoutSets.rpe,
      notes: workoutSets.notes,
    })
    .from(workoutSets)
    .innerJoin(events, eq(workoutSets.eventId, events.id))
    .innerJoin(sports, eq(events.sportId, sports.id))
    .innerJoin(metricTypes, eq(workoutSets.exerciseMetricTypeId, metricTypes.id))
    .orderBy(asc(events.startedAt), asc(metricTypes.name), asc(workoutSets.setNumber));
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
    "sports.csv": strToU8(sportsCsv),
    "metric_types.csv": strToU8(metricTypesCsv),
    "metric_type_aliases.csv": strToU8(metricTypeAliasesCsv),
    "import_sources.csv": strToU8(importSourcesCsv),
    "source_settings.csv": strToU8(sourceSettingsCsv),
    "goals.csv": strToU8(goalsCsv),
    "focuses.csv": strToU8(focusesCsv),
    "goal_journal_entries.csv": strToU8(goalJournalEntriesCsv),
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
