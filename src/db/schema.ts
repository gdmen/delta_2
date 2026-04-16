import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";
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
  createdAt: text("created_at").default(sql`(datetime('now'))`).notNull(),
});

export const metrics = sqliteTable("metrics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  metricTypeId: integer("metric_type_id").notNull().references(() => metricTypes.id),
  value: real("value").notNull(),
  recordedAt: text("recorded_at").notNull(),
  source: text("source").notNull(),
  sourceId: text("source_id"),
  createdAt: text("created_at").default(sql`(datetime('now'))`).notNull(),
}, (table) => [
  index("idx_metrics_type_recorded").on(table.metricTypeId, table.recordedAt),
  uniqueIndex("idx_metrics_source_id").on(table.sourceId),
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

export const workoutSets = sqliteTable("workout_sets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: integer("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  exerciseName: text("exercise_name").notNull(),
  setNumber: integer("set_number").notNull(),
  reps: integer("reps").notNull(),
  weight: real("weight").notNull(),
  rpe: real("rpe"),
  notes: text("notes"),
}, (table) => [
  index("idx_workout_sets_event").on(table.eventId),
  index("idx_workout_sets_exercise").on(table.exerciseName),
]);

export const focuses = sqliteTable("focuses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  sportId: integer("sport_id").notNull().references(() => sports.id),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  status: text("status", { enum: ["active", "completed", "abandoned"] }).notNull().default("active"),
  technicalNotes: text("technical_notes"),
  createdAt: text("created_at").default(sql`(datetime('now'))`).notNull(),
});

export const focusMetricLinks = sqliteTable("focus_metric_links", {
  focusId: integer("focus_id").notNull().references(() => focuses.id, { onDelete: "cascade" }),
  metricTypeId: integer("metric_type_id").notNull().references(() => metricTypes.id),
}, (table) => [
  index("idx_focus_metric_links").on(table.focusId, table.metricTypeId),
]);

export const focusEntries = sqliteTable("focus_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  focusId: integer("focus_id").notNull().references(() => focuses.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: text("created_at").default(sql`(datetime('now'))`).notNull(),
});

export const goals = sqliteTable("goals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  metricTypeId: integer("metric_type_id").notNull().references(() => metricTypes.id),
  sportId: integer("sport_id").notNull().references(() => sports.id),
  targetValue: real("target_value").notNull(),
  deadline: text("deadline").notNull(),
  createdAt: text("created_at").default(sql`(datetime('now'))`).notNull(),
});

export const coachMessages = sqliteTable("coach_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type", { enum: ["briefing", "weekly", "chat"] }).notNull(),
  content: text("content").notNull(),
  promptTemplateHash: text("prompt_template_hash"),
  contextSnapshot: text("context_snapshot"),
  createdAt: text("created_at").default(sql`(datetime('now'))`).notNull(),
});

export const ingestConfigs = sqliteTable("ingest_configs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull().unique(),
  apiKeyEncrypted: text("api_key_encrypted"),
  lastSyncAt: text("last_sync_at"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
});

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
