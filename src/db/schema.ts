import { sqliteTable, text, integer, real, index, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const sports = sqliteTable("sports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  color: text("color").notNull(),
  createdAt: text("created_at").default(sql`(datetime('now'))`).notNull(),
});

export const metricTypes = sqliteTable("metric_types", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  sportId: integer("sport_id").references(() => sports.id),
  unit: text("unit").notNull(),
  frequencyHint: text("frequency_hint", { enum: ["daily", "weekly", "occasional"] }).notNull().default("daily"),
  /**
   * Target value for compliance dashboards. Single source of truth — widgets
   * read from here rather than carrying their own target. NULL = no target
   * line on charts, no color coding on headlines.
   */
  target: real("target"),
  /**
   * Direction of the target. true (default) = floor (sleep, protein); false =
   * ceiling (body fat %, weight). Drives the green/orange/red color buckets
   * on metric_block headlines.
   */
  higherIsBetter: integer("higher_is_better", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").default(sql`(datetime('now'))`).notNull(),
});

/**
 * Routes a raw import name onto a canonical metric_types row. The `alias` key
 * is the string a source would have emitted (e.g. `apple_health:fiber`,
 * `dietary_fiber`), not an id — because merged-away metric_types get deleted
 * and their IDs disappear. Every ingest path checks this table before falling
 * back to auto-creating a `${source}:${rawName}` orphan.
 */
export const metricTypeAliases = sqliteTable("metric_type_aliases", {
  alias: text("alias").primaryKey(),
  canonicalMetricTypeId: integer("canonical_metric_type_id")
    .notNull()
    .references(() => metricTypes.id, { onDelete: "cascade" }),
  createdAt: text("created_at").default(sql`(datetime('now'))`).notNull(),
}, (table) => [
  index("idx_metric_type_aliases_canonical").on(table.canonicalMetricTypeId),
]);

export const metrics = sqliteTable("metrics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  metricTypeId: integer("metric_type_id").notNull().references(() => metricTypes.id),
  value: real("value").notNull(),
  recordedAt: text("recorded_at").notNull(),
  source: text("source").notNull(),
  sourceId: text("source_id"),
  createdAt: text("created_at").default(sql`(datetime('now'))`).notNull(),
  // Alias key the resolver matched at ingest time (e.g.
  // "fitnotes_bt:weight"). Powers chain-undo of merges: when a merge is
  // reversed, the applier moves metrics whose `alias` matches the
  // pre-merge resolution back to the merged_id. NULL for rows ingested
  // before this column existed — those are reversed via the captured
  // metricsMovedIds path only.
  alias: text("alias"),
}, (table) => [
  index("idx_metrics_type_recorded").on(table.metricTypeId, table.recordedAt),
  uniqueIndex("idx_metrics_source_id").on(table.sourceId),
  index("idx_metrics_type_alias").on(table.metricTypeId, table.alias),
]);

export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sportId: integer("sport_id").notNull().references(() => sports.id),
  type: text("type").notNull(),
  durationMinutes: integer("duration_minutes"),
  notes: text("notes"),
  startedAt: text("started_at").notNull(),
  source: text("source").notNull().default("manual"),
  sourceId: text("source_id"),
  createdAt: text("created_at").default(sql`(datetime('now'))`).notNull(),
}, (table) => [
  index("idx_events_sport_started").on(table.sportId, table.startedAt),
  uniqueIndex("idx_events_source_id").on(table.sourceId),
]);

/**
 * Per-event numeric dimensions: distance, calories, avg HR, elevation, etc.
 * Lets cardio + workout sessions carry arbitrary quantified data without
 * ballooning the events schema.  Keyed by (event_id, metric_type_id) so
 * imports can upsert idempotently.
 */
export const eventMetrics = sqliteTable("event_metrics", {
  eventId: integer("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  metricTypeId: integer("metric_type_id").notNull().references(() => metricTypes.id),
  value: real("value").notNull(),
}, (table) => [
  uniqueIndex("idx_event_metrics_event_type").on(table.eventId, table.metricTypeId),
]);

export const workoutSets = sqliteTable("workout_sets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: integer("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  exerciseMetricTypeId: integer("exercise_metric_type_id").notNull().references(() => metricTypes.id),
  setNumber: integer("set_number").notNull(),
  reps: integer("reps").notNull(),
  weight: real("weight").notNull(),
  rpe: real("rpe"),
  notes: text("notes"),
}, (table) => [
  index("idx_workout_sets_event").on(table.eventId),
  index("idx_workout_sets_exercise_mt").on(table.exerciseMetricTypeId),
]);

export const goals = sqliteTable("goals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  metricTypeId: integer("metric_type_id").notNull().references(() => metricTypes.id),
  sportId: integer("sport_id").notNull().references(() => sports.id),
  targetValue: real("target_value").notNull(),
  deadline: text("deadline").notNull(),
  status: text("status", { enum: ["active", "completed", "abandoned"] })
    .notNull()
    .default("active"),
  createdAt: text("created_at").default(sql`(datetime('now'))`).notNull(),
});

/**
 * A focus is a current emphasis on a goal. Two flavors share the same shape:
 * `source: 'manual'` is what the user typed (e.g. "Pause reps for bench"),
 * `source: 'llm'` is what the LLM proposed from training data, with `evidence`
 * carrying the workout_ids / metric trends that drove the suggestion.
 *
 * Sport is reachable via the goal — focuses don't carry sport_id directly.
 * Promote-an-llm-focus = update source to 'manual'. Dismiss = set dismissed_at.
 */
export const focuses = sqliteTable("focuses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  goalId: integer("goal_id").notNull().references(() => goals.id, { onDelete: "cascade" }),
  source: text("source", { enum: ["manual", "llm"] }).notNull().default("manual"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  status: text("status", { enum: ["active", "completed", "abandoned"] }).notNull().default("active"),
  technicalNotes: text("technical_notes"),
  evidence: text("evidence"),
  dismissedAt: text("dismissed_at"),
  createdAt: text("created_at").default(sql`(datetime('now'))`).notNull(),
}, (table) => [
  index("idx_focuses_goal_status").on(table.goalId, table.status),
]);

/**
 * Per-goal markdown journal. Append-only timestamped entries form the longitudinal
 * narrative of a goal. `verdict_focus_id` tags entries auto-generated when a focus
 * closes, so they can be styled differently in the journal feed.
 * `linked_metric_type_id` is optional — pin an entry to a metric without resurrecting
 * a join table.
 */
export const goalJournalEntries = sqliteTable("goal_journal_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  goalId: integer("goal_id").notNull().references(() => goals.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: text("created_at").default(sql`(datetime('now'))`).notNull(),
  verdictFocusId: integer("verdict_focus_id").references((): AnySQLiteColumn => focuses.id, { onDelete: "set null" }),
  linkedMetricTypeId: integer("linked_metric_type_id").references(() => metricTypes.id, { onDelete: "set null" }),
}, (table) => [
  index("idx_goal_journal_goal_created").on(table.goalId, table.createdAt),
]);

/**
 * One row per LLM call. Metadata only (no message content — content lives in
 * focuses.evidence or goal_journal_entries). Lets us track cost, latency, and
 * failure rates without joining to external service logs.
 */
export const coachCalls = sqliteTable("coach_calls", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ts: text("ts").default(sql`(datetime('now'))`).notNull(),
  endpoint: text("endpoint").notNull(),
  goalId: integer("goal_id").references(() => goals.id, { onDelete: "set null" }),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  model: text("model").notNull(),
  status: text("status").notNull().default("success"),
}, (table) => [
  index("idx_coach_calls_ts").on(table.ts),
  index("idx_coach_calls_goal").on(table.goalId),
]);

export const ingestConfigs = sqliteTable("ingest_configs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull().unique(),
  apiKeyEncrypted: text("api_key_encrypted"),
  lastSyncAt: text("last_sync_at"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
});

export const importSources = sqliteTable("import_sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // Display name, also used as the `source` value written to metrics/events.
  name: text("name").notNull().unique(),
  kind: text("kind", { enum: ["metrics", "events", "workout_sets"] }).notNull(),
  // JSON-encoded ImportMapping (see src/lib/import-mapping.ts). Opaque to
  // the DB layer; parsed by the import runner.
  mapping: text("mapping").notNull(),
  createdAt: text("created_at").default(sql`(datetime('now'))`).notNull(),
});

/**
 * App-wide preferences. Single row by convention (`id = 1`). Migration
 * 0022 inserts that row so reads can be unconditional.
 *
 * - `timezone`: IANA name (e.g. `America/Los_Angeles`). null falls back
 *   to the JS runtime's resolved TZ. Used by metric-history to compute
 *   the user's "today" when filtering daily-aggregate windows — without
 *   it, a UTC server makes the wrong call for any user not on UTC.
 */
export const appSettings = sqliteTable("app_settings", {
  id: integer("id").primaryKey().default(1),
  timezone: text("timezone"),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`).notNull(),
});

/**
 * Audit log for merges (sport + metric_type). One row per merge call,
 * inserted inside the same transaction that performs the merge so a
 * failure rolls everything back together. Drives /data/merges and the
 * inline undo toast.
 *
 * - `payload` is a versioned JSON blob (top-level `v: 1`) carrying
 *   everything needed to reverse the merge. Snapshot includes the
 *   merged metric_type/sport row data, the lists of FK row ids that
 *   were re-pointed, deduped-and-deleted event_metrics rows, and the
 *   rescale factor (if any). Daily_summaries is NOT in the payload —
 *   it's recomputed from `metrics` on undo so post-merge ingest
 *   survives.
 * - `userId` is nullable and indexed alongside createdAt so the
 *   future multi-user list query (`WHERE user_id = ? ORDER BY ...`)
 *   stays efficient. NULL today (no auth/user table yet); when auth
 *   lands the merge endpoints fill it in and the GET/undo endpoints
 *   filter by it.
 * - `undoneAt` flips from NULL to a timestamp via CAS at undo start
 *   (TOCTOU-safe — concurrent double-undos see only one winner).
 */
export const mergeLog = sqliteTable("merge_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["metric_type", "sport"] }).notNull(),
  createdAt: text("created_at").default(sql`(datetime('now'))`).notNull(),
  canonicalId: integer("canonical_id").notNull(),
  canonicalName: text("canonical_name").notNull(),
  mergedNames: text("merged_names").notNull(),
  payload: text("payload").notNull(),
  undoneAt: text("undone_at"),
  userId: integer("user_id"),
}, (table) => [
  index("idx_merge_log_created_at").on(table.createdAt),
  index("idx_merge_log_user_id_created_at").on(table.userId, table.createdAt),
]);

/**
 * Per-source config. Today: just the reconcile toggle. Future per-source
 * prefs fit here too. One row per `source` tag (matches the `source`
 * column on metrics/events).
 */
export const sourceSettings = sqliteTable("source_settings", {
  source: text("source").primaryKey(),
  reconcileEnabled: integer("reconcile_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`).notNull(),
});

/**
 * Audit trail for reconcile deletions. Zero-deletion ingest runs don't
 * write here; only batches that actually removed rows. Used by the
 * "Last reconcile" chip on each source sub-page.
 *
 * `metric_type_id` has no FK so rows survive a later metric_types delete.
 */
export const reconcileLog = sqliteTable("reconcile_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull(),
  kind: text("kind", { enum: ["metric", "event"] }).notNull(),
  metricTypeId: integer("metric_type_id"),
  deletedCount: integer("deleted_count").notNull(),
  rangeStart: text("range_start").notNull(),
  rangeEnd: text("range_end").notNull(),
  at: text("at").default(sql`(datetime('now'))`).notNull(),
}, (table) => [
  index("idx_reconcile_log_source_at").on(table.source, table.at),
]);

export const dailySummaries = sqliteTable("daily_summaries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  metricTypeId: integer("metric_type_id").notNull().references(() => metricTypes.id),
  avgValue: real("avg_value"),
  minValue: real("min_value"),
  maxValue: real("max_value"),
  count: integer("count").notNull().default(0),
  lastIngestAt: text("last_ingest_at"),
}, (table) => [
  uniqueIndex("idx_daily_summaries_date_metric").on(table.date, table.metricTypeId),
]);

/**
 * A dashboard is a named collection of widgets. System dashboards (Today,
 * Recovery, Body Comp) ship as defaults via seed migration; users can rename
 * and edit but not delete them. User-created dashboards have is_system=0 and
 * are fully managed.
 *
 * `seeded_id` lets the seed migration stay idempotent across renames: future
 * deploys check for the seeded marker, not the slug, so renaming "Today" to
 * "Home" doesn't trigger a re-insert. NULL for user-created rows.
 *
 * `sport_id` is optional and drives the sport-color dot in the sidebar.
 * `position` orders dashboards in the sidebar.
 */
export const dashboards = sqliteTable("dashboards", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  icon: text("icon"),
  sportId: integer("sport_id").references(() => sports.id, { onDelete: "set null" }),
  position: integer("position").notNull().default(0),
  isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
  seededId: text("seeded_id").unique(),
  createdAt: text("created_at").default(sql`(datetime('now'))`).notNull(),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`).notNull(),
}, (table) => [
  index("idx_dashboards_position").on(table.position),
]);

/**
 * Each row is one widget on one dashboard. `widget_type` is a string key into
 * the widget registry (src/lib/widgets/registry.ts). `config` is JSON parsed
 * by the widget's Zod schema at render time. `body` is reserved for widgets
 * (text_card) whose content exceeds the 4KB JSON cap and benefits from a
 * dedicated TEXT column.
 *
 * grid_x / grid_y / grid_w / grid_h are abstract grid units (not pixels):
 * x and y index into a 12-column CSS Grid, w/h are spans. Layout is purely
 * CSS-driven; the renderer doesn't convert to pixels.
 *
 * `position` is the mobile single-column stacking order; on desktop the
 * grid_x/y dictate layout.
 */
export const dashboardWidgets = sqliteTable("dashboard_widgets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dashboardId: integer("dashboard_id")
    .notNull()
    .references(() => dashboards.id, { onDelete: "cascade" }),
  widgetType: text("widget_type").notNull(),
  config: text("config").notNull().default("{}"),
  body: text("body"),
  gridX: integer("grid_x").notNull().default(0),
  gridY: integer("grid_y").notNull().default(0),
  gridW: integer("grid_w").notNull().default(12),
  gridH: integer("grid_h").notNull().default(2),
  position: integer("position").notNull().default(0),
}, (table) => [
  index("idx_dashboard_widgets_dashboard_position").on(table.dashboardId, table.position),
]);
