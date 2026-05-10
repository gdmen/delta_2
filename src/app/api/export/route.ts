import { NextRequest, NextResponse } from "next/server";
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
  dashboards,
  dashboardWidgets,
  coachCalls,
  reconcileLog,
  dailySummaries,
  mergeLog,
} from "@/db/schema";
import { and, eq, asc, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { serializeCsv } from "@/lib/csv";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

/**
 * GET /api/export
 * GET /api/export?manual=true
 *
 * Returns a ZIP of all foundational data — everything needed to wipe the
 * DB and restore the app to the same functional state.
 *
 * Per-user: every CSV is restricted to the requesting user's tenant. Two
 * users' exports are independent.
 *
 * `?manual=true` narrows the bundle to data the user typed in by hand
 * (metrics + events with source="manual", manual-source focuses, plus
 * goals + journal entries + dashboards which are always manual). The
 * supporting catalog (sports, metric_types, aliases) is also narrowed
 * to ONLY the rows actually referenced by the exported slice — so a
 * manual export doesn't bloat the bundle with every sport and metric
 * in the DB. import_sources + source_settings still ship in full
 * because they're tiny and configuration-shaped (no rows reference
 * them by id, so no narrowing is meaningful). Operational rows
 * (coach_calls, reconcile_log, daily_summaries, merge_log) are
 * skipped — they regenerate or no longer apply.
 */
export async function GET(request: NextRequest) {
  const { user, error } = await requireUserOr401();
  if (error) return error;
  const userId = user.id;

  const manualOnly = request.nextUrl.searchParams.get("manual") === "true";

  // Pre-compute the set of manual event ids so the per-event children
  // (event_metrics, workout_sets) can be filtered by FK without a join.
  // Empty array when manualOnly is false — never used in that path.
  const manualEventIds = manualOnly
    ? (
        await db
          .select({ id: events.id })
          .from(events)
          .where(and(userScope(userId).events, eq(events.source, "manual")))
      ).map((r) => r.id)
    : [];

  // In manual mode, narrow the supporting catalog (sports, metric_types,
  // metric_type_aliases) to only what's actually referenced by the
  // exported slice plus the always-included tables (goals, dashboards,
  // journal entries). Without this, a manual export ships every sport
  // and metric_type in the DB even though most aren't reachable from
  // the exported rows — bloats the bundle and clutters the re-import.
  const { neededMetricTypeNames, neededSportNames } = manualOnly
    ? await collectManualNeededRefs(manualEventIds, userId)
    : { neededMetricTypeNames: null, neededSportNames: null };

  // --- sports.csv ----------------------------------------------------------
  const sportRows = (
    await db
      .select()
      .from(sports)
      .where(userScope(userId).sports)
      .orderBy(asc(sports.name))
  ).filter((r) => !neededSportNames || neededSportNames.has(r.name));
  const sportsCsv = serializeCsv(
    ["name", "color"],
    sportRows.map((r) => [r.name, r.color]),
  );

  // --- metric_types.csv ----------------------------------------------------
  // Left-join sports so the optional sport link round-trips by name.
  // target + higher_is_better drive widget headline color coding (see
  // src/lib/metric-history.ts); re-importing a CSV without them would
  // silently reset every metric's target to NULL.
  const mtRows = (
    await db
      .select({
        name: metricTypes.name,
        unit: metricTypes.unit,
        frequencyHint: metricTypes.frequencyHint,
        target: metricTypes.target,
        higherIsBetter: metricTypes.higherIsBetter,
        sport: sports.name,
      })
      .from(metricTypes)
      .leftJoin(sports, eq(metricTypes.sportId, sports.id))
      .where(userScope(userId).metricTypes)
      .orderBy(asc(metricTypes.name))
  ).filter((r) => !neededMetricTypeNames || neededMetricTypeNames.has(r.name));
  const metricTypesCsv = serializeCsv(
    ["name", "unit", "frequency_hint", "target", "higher_is_better", "sport"],
    mtRows.map((r) => [
      r.name,
      r.unit,
      r.frequencyHint,
      r.target == null ? "" : String(r.target),
      r.higherIsBetter ? "1" : "0",
      r.sport ?? "",
    ]),
  );

  // --- metric_type_aliases.csv ---------------------------------------------
  const aliasRows = (
    await db
      .select({
        alias: metricTypeAliases.alias,
        canonical: metricTypes.name,
      })
      .from(metricTypeAliases)
      .innerJoin(
        metricTypes,
        eq(metricTypeAliases.canonicalMetricTypeId, metricTypes.id),
      )
      .where(userScope(userId).metricTypeAliases)
      .orderBy(asc(metricTypeAliases.alias))
  ).filter((r) => !neededMetricTypeNames || neededMetricTypeNames.has(r.canonical));
  const metricTypeAliasesCsv = serializeCsv(
    ["alias", "canonical"],
    aliasRows.map((r) => [r.alias, r.canonical]),
  );

  // --- import_sources.csv --------------------------------------------------
  const importSourceRows = await db
    .select()
    .from(importSources)
    .where(userScope(userId).importSources)
    .orderBy(asc(importSources.name));
  const importSourcesCsv = serializeCsv(
    ["name", "kind", "mapping"],
    importSourceRows.map((r) => [r.name, r.kind, r.mapping]),
  );

  // --- source_settings.csv -------------------------------------------------
  const sourceSettingRows = await db
    .select()
    .from(sourceSettings)
    .where(userScope(userId).sourceSettings)
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
    .where(userScope(userId).goals)
    .orderBy(asc(goals.deadline));
  const goalsCsv = serializeCsv(
    ["sport", "metric", "target_value", "deadline", "status"],
    goalRows.map((r) => [r.sport, r.metric, r.targetValue, r.deadline, r.status]),
  );

  // --- focuses.csv ---------------------------------------------------------
  const focusBase = db
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
    .$dynamic();
  const focusRows = await (manualOnly
    ? focusBase.where(and(userScope(userId).goals, eq(focuses.source, "manual")))
    : focusBase.where(userScope(userId).goals)
  ).orderBy(asc(focuses.startDate));

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
    .where(userScope(userId).goals)
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
  const metricsBase = db
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
    .$dynamic();
  const metricRows = await (manualOnly
    ? metricsBase.where(and(userScope(userId).metrics, eq(metrics.source, "manual")))
    : metricsBase.where(userScope(userId).metrics)
  ).orderBy(asc(metrics.recordedAt));
  const metricsCsv = serializeCsv(
    ["recorded_at", "metric", "unit", "value", "source", "source_id"],
    metricRows.map((r) => [
      r.recordedAt,
      r.metric,
      r.unit,
      r.value,
      r.source,
      r.sourceId ?? `custom-${r.metric}-${r.recordedAt}`,
    ]),
  );

  // --- events.csv ----------------------------------------------------------
  const eventsBase = db
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
    .$dynamic();
  const eventRows = await (manualOnly
    ? eventsBase.where(and(userScope(userId).events, eq(events.source, "manual")))
    : eventsBase.where(userScope(userId).events)
  ).orderBy(asc(events.startedAt));
  const eventsCsv = serializeCsv(
    ["started_at", "sport", "type", "duration_minutes", "notes", "source", "source_id"],
    eventRows.map((r) => [
      r.startedAt,
      r.sport,
      r.type,
      r.durationMinutes ?? "",
      r.notes ?? "",
      r.source,
      r.sourceId ?? `custom-${r.sport}-${r.type}-${r.startedAt}`,
    ]),
  );

  // --- event_metrics.csv ---------------------------------------------------
  const emBase = db
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
    .$dynamic();
  const emRows = await (manualOnly
    ? emBase.where(
        and(
          userScope(userId).events,
          manualEventIds.length > 0
            ? inArray(eventMetrics.eventId, manualEventIds)
            : eq(eventMetrics.eventId, -1),
        ),
      )
    : emBase.where(userScope(userId).events)
  ).orderBy(asc(events.startedAt), asc(metricTypes.name));
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
  const setsBase = db
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
    .$dynamic();
  const setRows = await (manualOnly
    ? setsBase.where(
        and(
          userScope(userId).events,
          manualEventIds.length > 0
            ? inArray(workoutSets.eventId, manualEventIds)
            : eq(workoutSets.eventId, -1),
        ),
      )
    : setsBase.where(userScope(userId).events)
  ).orderBy(asc(events.startedAt), asc(metricTypes.name), asc(workoutSets.setNumber));
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

  // --- dashboards.csv ------------------------------------------------------
  const dashboardSports = alias(sports, "dashboard_sports");
  const dashboardRows = await db
    .select({
      slug: dashboards.slug,
      name: dashboards.name,
      icon: dashboards.icon,
      sportName: dashboardSports.name,
      position: dashboards.position,
      isSystem: dashboards.isSystem,
      seededId: dashboards.seededId,
    })
    .from(dashboards)
    .leftJoin(dashboardSports, eq(dashboards.sportId, dashboardSports.id))
    .where(userScope(userId).dashboards)
    .orderBy(asc(dashboards.position));
  const dashboardsCsv = serializeCsv(
    ["slug", "name", "icon", "sport_name", "position", "is_system", "seeded_id"],
    dashboardRows.map((r) => [
      r.slug,
      r.name,
      r.icon ?? "",
      r.sportName ?? "",
      r.position,
      r.isSystem ? 1 : 0,
      r.seededId ?? "",
    ]),
  );

  // --- dashboard_widgets.csv -----------------------------------------------
  const widgetRows = await db
    .select({
      dashboardSlug: dashboards.slug,
      widgetType: dashboardWidgets.widgetType,
      config: dashboardWidgets.config,
      body: dashboardWidgets.body,
      gridX: dashboardWidgets.gridX,
      gridY: dashboardWidgets.gridY,
      gridW: dashboardWidgets.gridW,
      gridH: dashboardWidgets.gridH,
      position: dashboardWidgets.position,
    })
    .from(dashboardWidgets)
    .innerJoin(dashboards, eq(dashboardWidgets.dashboardId, dashboards.id))
    .where(userScope(userId).dashboards)
    .orderBy(asc(dashboards.position), asc(dashboardWidgets.position));
  const dashboardWidgetsCsv = serializeCsv(
    ["dashboard_slug", "widget_type", "config", "body", "grid_x", "grid_y", "grid_w", "grid_h", "position"],
    widgetRows.map((r) => [
      r.dashboardSlug,
      r.widgetType,
      r.config,
      r.body ?? "",
      r.gridX,
      r.gridY,
      r.gridW,
      r.gridH,
      r.position,
    ]),
  );

  // --- coach_calls.csv -----------------------------------------------------
  const coachCallRows = await db
    .select({
      ts: coachCalls.ts,
      endpoint: coachCalls.endpoint,
      tokensIn: coachCalls.tokensIn,
      tokensOut: coachCalls.tokensOut,
      durationMs: coachCalls.durationMs,
      model: coachCalls.model,
      status: coachCalls.status,
      goalSport: sports.name,
      goalMetric: metricTypes.name,
      goalDeadline: goals.deadline,
    })
    .from(coachCalls)
    .leftJoin(goals, eq(coachCalls.goalId, goals.id))
    .leftJoin(sports, eq(goals.sportId, sports.id))
    .leftJoin(metricTypes, eq(goals.metricTypeId, metricTypes.id))
    .where(userScope(userId).coachCalls)
    .orderBy(asc(coachCalls.ts));
  const coachCallsCsv = serializeCsv(
    [
      "ts",
      "endpoint",
      "tokens_in",
      "tokens_out",
      "duration_ms",
      "model",
      "status",
      "goal_sport",
      "goal_metric",
      "goal_deadline",
    ],
    coachCallRows.map((r) => [
      r.ts,
      r.endpoint,
      r.tokensIn,
      r.tokensOut,
      r.durationMs,
      r.model,
      r.status,
      r.goalSport ?? "",
      r.goalMetric ?? "",
      r.goalDeadline ?? "",
    ]),
  );

  // --- reconcile_log.csv ---------------------------------------------------
  const reconcileLogRows = await db
    .select({
      source: reconcileLog.source,
      kind: reconcileLog.kind,
      deletedCount: reconcileLog.deletedCount,
      rangeStart: reconcileLog.rangeStart,
      rangeEnd: reconcileLog.rangeEnd,
      at: reconcileLog.at,
      metric: metricTypes.name,
    })
    .from(reconcileLog)
    .leftJoin(metricTypes, eq(reconcileLog.metricTypeId, metricTypes.id))
    .where(userScope(userId).reconcileLog)
    .orderBy(asc(reconcileLog.at));
  const reconcileLogCsv = serializeCsv(
    ["source", "kind", "metric", "deleted_count", "range_start", "range_end", "at"],
    reconcileLogRows.map((r) => [
      r.source,
      r.kind,
      r.metric ?? "",
      r.deletedCount,
      r.rangeStart,
      r.rangeEnd,
      r.at,
    ]),
  );

  // --- daily_summaries.csv -------------------------------------------------
  const dailySummaryRows = await db
    .select({
      date: dailySummaries.date,
      metric: metricTypes.name,
      avgValue: dailySummaries.avgValue,
      minValue: dailySummaries.minValue,
      maxValue: dailySummaries.maxValue,
      count: dailySummaries.count,
      lastIngestAt: dailySummaries.lastIngestAt,
    })
    .from(dailySummaries)
    .innerJoin(metricTypes, eq(dailySummaries.metricTypeId, metricTypes.id))
    .where(userScope(userId).dailySummaries)
    .orderBy(asc(dailySummaries.date), asc(metricTypes.name));
  const dailySummariesCsv = serializeCsv(
    ["date", "metric", "avg_value", "min_value", "max_value", "count", "last_ingest_at"],
    dailySummaryRows.map((r) => [
      r.date,
      r.metric,
      r.avgValue ?? "",
      r.minValue ?? "",
      r.maxValue ?? "",
      r.count,
      r.lastIngestAt ?? "",
    ]),
  );

  // --- merge_log.csv -------------------------------------------------------
  const mergeLogRows = await db
    .select({
      id: mergeLog.id,
      kind: mergeLog.kind,
      createdAt: mergeLog.createdAt,
      canonicalId: mergeLog.canonicalId,
      canonicalName: mergeLog.canonicalName,
      mergedNames: mergeLog.mergedNames,
      payload: mergeLog.payload,
      undoneAt: mergeLog.undoneAt,
      userId: mergeLog.userId,
    })
    .from(mergeLog)
    .where(userScope(userId).mergeLog)
    .orderBy(asc(mergeLog.id));
  const mergeLogCsv = serializeCsv(
    [
      "id",
      "kind",
      "created_at",
      "canonical_id",
      "canonical_name",
      "merged_names",
      "payload",
      "undone_at",
      "user_id",
    ],
    mergeLogRows.map((r) => [
      r.id,
      r.kind,
      r.createdAt,
      r.canonicalId,
      r.canonicalName,
      r.mergedNames,
      r.payload,
      r.undoneAt ?? "",
      r.userId == null ? "" : String(r.userId),
    ]),
  );

  // --- bundle ---------------------------------------------------------------
  const bundle: Record<string, Uint8Array> = {
    "sports.csv": strToU8(sportsCsv),
    "metric_types.csv": strToU8(metricTypesCsv),
    "metric_type_aliases.csv": strToU8(metricTypeAliasesCsv),
    "import_sources.csv": strToU8(importSourcesCsv),
    "source_settings.csv": strToU8(sourceSettingsCsv),
    "goals.csv": strToU8(goalsCsv),
    "focuses.csv": strToU8(focusesCsv),
    "goal_journal_entries.csv": strToU8(goalJournalEntriesCsv),
    "dashboards.csv": strToU8(dashboardsCsv),
    "dashboard_widgets.csv": strToU8(dashboardWidgetsCsv),
    "metrics.csv": strToU8(metricsCsv),
    "events.csv": strToU8(eventsCsv),
    "event_metrics.csv": strToU8(eventMetricsCsv),
    "workout_sets.csv": strToU8(workoutSetsCsv),
  };

  if (!manualOnly) {
    bundle["coach_calls.csv"] = strToU8(coachCallsCsv);
    bundle["reconcile_log.csv"] = strToU8(reconcileLogCsv);
    bundle["daily_summaries.csv"] = strToU8(dailySummariesCsv);
    bundle["merge_log.csv"] = strToU8(mergeLogCsv);
  }

  const zipped = zipSync(bundle);

  const stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const filename = manualOnly
    ? `delta-manual-export-${stamp}.zip`
    : `delta-export-${stamp}.zip`;
  const body = new Uint8Array(zipped);

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

/**
 * Walk a parsed widget config (or any JSON value) and collect every
 * string at a `metric` key. Covers the metric-strip / metric-block /
 * metrics-grid shapes (`{metric: "name"}`, `{metrics: [{metric: "name"}]}`)
 * without hard-coding the per-widget schema.
 */
function collectMetricNamesFromConfig(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) collectMetricNamesFromConfig(v, out);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "metric" && typeof v === "string" && v.length > 0) {
        out.add(v);
      } else {
        collectMetricNamesFromConfig(v, out);
      }
    }
  }
}

/**
 * Compute the metric_type + sport names actually referenced by the
 * manual-export slice. All queries scoped to the requesting user.
 */
async function collectManualNeededRefs(manualEventIds: number[], userId: number): Promise<{
  neededMetricTypeNames: Set<string>;
  neededSportNames: Set<string>;
}> {
  const neededTypeIds = new Set<number>();

  // metrics tagged with source=manual (this user)
  for (const r of await db
    .selectDistinct({ id: metrics.metricTypeId })
    .from(metrics)
    .where(and(userScope(userId).metrics, eq(metrics.source, "manual")))) {
    neededTypeIds.add(r.id);
  }

  // event_metrics + workout_sets are INHERIT — already filtered to this
  // user's events via manualEventIds (which was loaded user-scoped).
  if (manualEventIds.length > 0) {
    for (const r of await db
      .selectDistinct({ id: eventMetrics.metricTypeId })
      .from(eventMetrics)
      .where(inArray(eventMetrics.eventId, manualEventIds))) {
      neededTypeIds.add(r.id);
    }
    for (const r of await db
      .selectDistinct({ id: workoutSets.exerciseMetricTypeId })
      .from(workoutSets)
      .where(inArray(workoutSets.eventId, manualEventIds))) {
      neededTypeIds.add(r.id);
    }
  }

  for (const r of await db
    .selectDistinct({ id: goals.metricTypeId })
    .from(goals)
    .where(userScope(userId).goals)) {
    neededTypeIds.add(r.id);
  }

  // goal_journal_entries is INHERIT — restrict via this user's goals.
  const ownedGoalIds = await db
    .select({ id: goals.id })
    .from(goals)
    .where(userScope(userId).goals);
  if (ownedGoalIds.length > 0) {
    const ownedIds = ownedGoalIds.map((g) => g.id);
    for (const r of await db
      .select({ id: goalJournalEntries.linkedMetricTypeId })
      .from(goalJournalEntries)
      .where(inArray(goalJournalEntries.goalId, ownedIds))) {
      if (r.id != null) neededTypeIds.add(r.id);
    }
  }

  // dashboard_widgets is INHERIT — restrict via this user's dashboards.
  const ownedDashboardRows = await db
    .select({ id: dashboards.id })
    .from(dashboards)
    .where(userScope(userId).dashboards);
  const widgetConfigRows = ownedDashboardRows.length > 0
    ? await db
        .select({ config: dashboardWidgets.config })
        .from(dashboardWidgets)
        .where(inArray(dashboardWidgets.dashboardId, ownedDashboardRows.map((d) => d.id)))
    : [];
  const namesFromWidgets = new Set<string>();
  for (const row of widgetConfigRows) {
    try {
      collectMetricNamesFromConfig(JSON.parse(row.config), namesFromWidgets);
    } catch {
      // Unparseable config — already broken, just skip it.
    }
  }

  const idsArray = [...neededTypeIds];
  const byIdRows = idsArray.length > 0
    ? await db
        .select({
          id: metricTypes.id,
          name: metricTypes.name,
          sportId: metricTypes.sportId,
        })
        .from(metricTypes)
        .where(and(userScope(userId).metricTypes, inArray(metricTypes.id, idsArray)))
    : [];
  const neededTypeNames = new Set<string>();
  const sportIdsFromTypes = new Set<number>();
  for (const r of byIdRows) {
    neededTypeNames.add(r.name);
    if (r.sportId != null) sportIdsFromTypes.add(r.sportId);
  }
  for (const name of namesFromWidgets) neededTypeNames.add(name);

  if (namesFromWidgets.size > 0) {
    const widgetTypeRows = await db
      .select({ name: metricTypes.name, sportId: metricTypes.sportId })
      .from(metricTypes)
      .where(and(userScope(userId).metricTypes, inArray(metricTypes.name, [...namesFromWidgets])));
    for (const r of widgetTypeRows) {
      if (r.sportId != null) sportIdsFromTypes.add(r.sportId);
    }
  }

  const neededSportIds = new Set<number>(sportIdsFromTypes);
  if (manualEventIds.length > 0) {
    for (const r of await db
      .selectDistinct({ id: events.sportId })
      .from(events)
      .where(inArray(events.id, manualEventIds))) {
      neededSportIds.add(r.id);
    }
  }
  for (const r of await db
    .selectDistinct({ id: goals.sportId })
    .from(goals)
    .where(userScope(userId).goals)) {
    neededSportIds.add(r.id);
  }
  for (const r of await db
    .select({ id: dashboards.sportId })
    .from(dashboards)
    .where(userScope(userId).dashboards)) {
    if (r.id != null) neededSportIds.add(r.id);
  }

  const neededSportNames = new Set<string>();
  if (neededSportIds.size > 0) {
    const sportRows2 = await db
      .select({ name: sports.name })
      .from(sports)
      .where(and(userScope(userId).sports, inArray(sports.id, [...neededSportIds])));
    for (const r of sportRows2) neededSportNames.add(r.name);
  }

  return { neededMetricTypeNames: neededTypeNames, neededSportNames };
}
