import {
  pgTable,
  text,
  integer,
  doublePrecision,
  boolean,
  timestamp,
  date,
  primaryKey,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AdapterAccountType } from "next-auth/adapters";
import { isoTimestamptz } from "./columns";

// Timestamp columns use the `isoTimestamptz` custom column type from
// `./columns` (Postgres `timestamptz` storage, ISO-string JS contract).
// This gives correct temporal semantics + indexable comparisons while
// preserving the legacy `.toISOString()`-shaped consumer contract.
// Date-only columns (e.g. goals.deadline, dailySummaries.date) use
// native `date({ mode: "string" })` returning canonical `YYYY-MM-DD`.
//
// Auth.js's `users.emailVerified` stays as `timestamp({ mode: "date" })`
// because the adapter owns the contract. That's the one place in this
// schema where the JS-side type is `Date` instead of string.
const isoNow = () => new Date().toISOString();

// =============================================================================
// AUTH.JS BASE TABLES
// =============================================================================
//
// Standard Auth.js v5 schema layered on the @auth/drizzle-adapter, with
// Delta-specific extensions on `users`. We use integer ids (matching every
// other Delta table's convention) instead of the adapter's default text/uuid
// — the adapter accepts either as long as the FK columns match. Bootstrap
// row is users(id=1, password_hash='!') (set by admin-bootstrap-owner).

export const users = pgTable("users", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  // Auth.js standard columns
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  // Delta extensions
  // displayName: shown in the sidebar, share-link banner, /preferences/account.
  // Distinct from `name` so we can let the user edit display without touching
  // the OAuth-provider-supplied `name`.
  displayName: text("display_name").notNull(),
  // passwordHash: argon2id. Nullable for Google-only users (no password set).
  // Sentinel '!' means un-bootstrapped owner (admin-bootstrap-owner replaces
  // it on first run). authorize() must reject both cases with the same
  // generic "invalid credentials" before calling argon2.verify.
  passwordHash: text("password_hash"),
  // Bumped to invalidate every outstanding JWT for this user (kill-all-
  // sessions semantic). Each issued JWT carries this as `pwv` and
  // requireUser() rejects on mismatch.
  passwordHashVersion: integer("password_hash_version").notNull().default(1),
  // Owner bit drives /preferences/invites visibility + can't-self-delete
  // protection. There's exactly one owner today (id=1).
  isOwner: boolean("is_owner").notNull().default(false),
  createdAt: isoTimestamptz("created_at").$defaultFn(isoNow).notNull(),
});

// One row per linked OAuth identity (e.g. Google). The Auth.js drizzle
// adapter writes here on first OAuth sign-in to bind providerAccountId
// to our users.id. `accounts` IS used at runtime under JWT strategy.
export const accounts = pgTable(
  "accounts",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
  ],
);

// Empty under JWT strategy — kept for adapter-compatibility only.
export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

// Used by Auth.js's email magic-link provider (which we don't ship today
// but the adapter still requires the table to exist).
export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })],
);

// =============================================================================
// AUTH SUPPORT TABLES (custom)
// =============================================================================

// Single-use sign-up gate. No group association in this plan.
// Atomic claim pattern: UPDATE invite_codes SET used_by_user_id = ?,
// used_at = now() WHERE code = ? AND used_by_user_id IS NULL;
// rowCount === 1 confirms the claim was successful.
export const inviteCodes = pgTable("invite_codes", {
  code: text("code").primaryKey(),
  createdByUserId: integer("created_by_user_id")
    .notNull()
    .references(() => users.id),
  usedByUserId: integer("used_by_user_id").references(() => users.id),
  expiresAt: isoTimestamptz("expires_at"),
  usedAt: isoTimestamptz("used_at"),
  createdAt: isoTimestamptz("created_at").$defaultFn(isoNow).notNull(),
});

// Strava OAuth state with user_id binding (replaces the previous cookie-
// based state). Lazy delete on callback + 1h sweep.
export const oauthStates = pgTable("oauth_states", {
  state: text("state").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: isoTimestamptz("expires_at").notNull(),
});

// JWT revocation list. Sign-out inserts the current request's `jti`. Every
// authed request checks WHERE jti = ? in requireUser(). Sweep deletes rows
// older than JWT TTL (8 days default) — past that, the row no longer
// protects anything because the JWT itself is expired.
export const sessionDenylist = pgTable("session_denylist", {
  jti: text("jti").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  revokedAt: isoTimestamptz("revoked_at").$defaultFn(isoNow).notNull(),
});

// Per-dashboard read-only public links. Owner of the dashboard can mint and
// revoke. ONE active token per dashboard at a time (re-mint revokes the
// previous one). View page lives at /share/[token]; renders the dashboard
// READ-ONLY using the dashboard owner's user_id (not the viewer's session).
export const dashboardShareTokens = pgTable(
  "dashboard_share_tokens",
  {
    token: text("token").primaryKey(), // 32-byte url-safe random
    dashboardId: integer("dashboard_id")
      .notNull()
      .references((): AnyPgColumn => dashboards.id, { onDelete: "cascade" }),
    createdByUserId: integer("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: isoTimestamptz("created_at").$defaultFn(isoNow).notNull(),
    revokedAt: isoTimestamptz("revoked_at"),
  },
  (t) => [
    uniqueIndex("dashboard_share_tokens_one_active_per_dashboard")
      .on(t.dashboardId)
      .where(sql`revoked_at IS NULL`),
  ],
);

// =============================================================================
// OWNED TABLES (every row has a user_id; cascade-delete on user removal)
// =============================================================================

export const activities = pgTable(
  "activities",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .default(1)
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull(),
    createdAt: isoTimestamptz("created_at").$defaultFn(isoNow).notNull(),
  },
  (t) => [uniqueIndex("activities_user_name_uniq").on(t.userId, t.name)],
);

export const metricTypes = pgTable(
  "metric_types",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .default(1)
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    activityId: integer("activity_id").references(() => activities.id),
    unit: text("unit").notNull(),
    frequencyHint: text("frequency_hint", {
      enum: ["daily", "weekly", "occasional"],
    })
      .notNull()
      .default("daily"),
    /**
     * Target value for compliance dashboards. Single source of truth — widgets
     * read from here rather than carrying their own target. NULL = no target
     * line on charts, no color coding on headlines.
     */
    target: doublePrecision("target"),
    /**
     * Direction of the target. true (default) = floor (sleep, protein); false =
     * ceiling (body fat %, weight). Drives the green/orange/red color buckets
     * on metric_block headlines.
     */
    higherIsBetter: boolean("higher_is_better").notNull().default(true),
    /**
     * If non-null, the lazy "scheduled doses" materializer stamps one
     * metrics row per local-calendar day with `value = auto_log_dose`,
     * `source = 'scheduled'`, `source_id = 'schedule:<typeId>:<date>'`.
     * Used for medications + other daily-take-this metrics. Issue #30.
     */
    autoLogDose: doublePrecision("auto_log_dose"),
    createdAt: isoTimestamptz("created_at").$defaultFn(isoNow).notNull(),
  },
  (t) => [uniqueIndex("metric_types_user_name_uniq").on(t.userId, t.name)],
);

/**
 * Tombstones for "user deleted today's auto-logged dose row." Keyed on
 * (metric_type_id, local_date) — no FK to a schedule row because the
 * schedule lives on metric_types itself via `autoLogDose`. The
 * materializer checks both "is there already a metric row for this
 * slot?" AND "is there a skip row?" before inserting. Lets the user
 * delete an auto-row to mean "I missed this day" without it being
 * re-created on the next request. Issue #30.
 */
export const metricScheduleSkips = pgTable("metric_schedule_skips", {
  metricTypeId: integer("metric_type_id")
    .notNull()
    .references(() => metricTypes.id, { onDelete: "cascade" }),
  /**
   * Local-calendar date the user skipped (YYYY-MM-DD). Local-not-UTC
   * because the user thinks "I missed Wednesday," not "I missed
   * 00:00-00:00 UTC."
   */
  skippedDate: date("skipped_date", { mode: "string" }).notNull(),
  createdAt: isoTimestamptz("created_at").$defaultFn(isoNow).notNull(),
}, (t) => [primaryKey({ columns: [t.metricTypeId, t.skippedDate] })]);

/**
 * Routes a raw import name onto a canonical metric_types row. The `alias` key
 * is the string a source would have emitted (e.g. `apple_health:fiber`,
 * `dietary_fiber`), not an id — because merged-away metric_types get deleted
 * and their IDs disappear. Every ingest path checks this table before falling
 * back to auto-creating a `${source}:${rawName}` orphan.
 */
export const metricTypeAliases = pgTable(
  "metric_type_aliases",
  {
    userId: integer("user_id")
      .notNull()
      .default(1)
      .references(() => users.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    canonicalMetricTypeId: integer("canonical_metric_type_id")
      .notNull()
      .references(() => metricTypes.id, { onDelete: "cascade" }),
    createdAt: isoTimestamptz("created_at").$defaultFn(isoNow).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.alias] }),
    index("idx_metric_type_aliases_canonical").on(t.canonicalMetricTypeId),
  ],
);

export const metrics = pgTable(
  "metrics",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .default(1)
      .references(() => users.id, { onDelete: "cascade" }),
    metricTypeId: integer("metric_type_id")
      .notNull()
      .references(() => metricTypes.id),
    value: doublePrecision("value").notNull(),
    recordedAt: isoTimestamptz("recorded_at").notNull(),
    source: text("source").notNull(),
    sourceId: text("source_id"),
    createdAt: isoTimestamptz("created_at").$defaultFn(isoNow).notNull(),
    // Alias key the resolver matched at ingest time (e.g.
    // "fitnotes_bt:weight"). Powers chain-undo of merges: when a merge is
    // reversed, the applier moves metrics whose `alias` matches the
    // pre-merge resolution back to the merged_id. NULL for rows ingested
    // before this column existed — those are reversed via the captured
    // metricsMovedIds path only.
    alias: text("alias"),
  },
  (t) => [
    index("idx_metrics_type_recorded").on(t.metricTypeId, t.recordedAt),
    uniqueIndex("idx_metrics_user_source_id").on(t.userId, t.sourceId),
    index("idx_metrics_type_alias").on(t.metricTypeId, t.alias),
    index("idx_metrics_user").on(t.userId),
  ],
);

export const events = pgTable(
  "events",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .default(1)
      .references(() => users.id, { onDelete: "cascade" }),
    activityId: integer("activity_id").notNull().references(() => activities.id),
    type: text("type").notNull(),
    durationMinutes: integer("duration_minutes"),
    notes: text("notes"),
    startedAt: isoTimestamptz("started_at").notNull(),
    source: text("source").notNull().default("manual"),
    sourceId: text("source_id"),
    // 'visible' = normal event. 'hidden_by_composite' = folded into a
    // composite (still queryable for exports/diagnostics, but absent
    // from default views). 'composite' = synthetic merged row that
    // references its members via composite_member_ids.
    status: text("status", {
      enum: ["visible", "hidden_by_composite", "composite"],
    })
      .notNull()
      .default("visible"),
    // Non-empty only when status='composite'. Lists the event ids that
    // were merged. Child rows (event_metrics, workout_sets) stay on
    // the member rows; composite renders fetch them via
    // WHERE event_id = ANY(composite_member_ids).
    compositeMemberIds: integer("composite_member_ids")
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    createdAt: isoTimestamptz("created_at").$defaultFn(isoNow).notNull(),
  },
  (t) => [
    index("idx_events_sport_started").on(t.activityId, t.startedAt),
    uniqueIndex("idx_events_user_source_id").on(t.userId, t.sourceId),
    index("idx_events_user").on(t.userId),
    // Powers the duplicate-event detector's BETWEEN-on-started_at range
    // scan. See drizzle/0007_events_user_started_index.sql for the
    // measured impact (1,685ms → 1.78ms on /home).
    index("idx_events_user_started").on(t.userId, t.startedAt),
  ],
);

/**
 * Dismiss-once-forever memory for the duplicate detector. When a user
 * clicks "Not a duplicate" on a candidate pair OR unmerges a composite,
 * the pair (event_a_id, event_b_id) lands here. The detector skips any
 * pair present in this table. Always insert with event_a_id < event_b_id
 * so the lookup stays symmetric.
 */
export const eventDuplicateDenylist = pgTable(
  "event_duplicate_denylist",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventAId: integer("event_a_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    eventBId: integer("event_b_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    createdAt: isoTimestamptz("created_at").$defaultFn(isoNow).notNull(),
  },
  (t) => [
    uniqueIndex("event_duplicate_denylist_pair").on(t.eventAId, t.eventBId),
    index("idx_event_duplicate_denylist_user").on(t.userId),
  ],
);

/**
 * Per-event numeric dimensions: distance, calories, avg HR, elevation, etc.
 * Lets cardio + workout sessions carry arbitrary quantified data without
 * ballooning the events schema.  Keyed by (event_id, metric_type_id) so
 * imports can upsert idempotently.
 *
 * INHERIT table — no user_id; scope via parent events row.
 */
export const eventMetrics = pgTable(
  "event_metrics",
  {
    eventId: integer("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    metricTypeId: integer("metric_type_id")
      .notNull()
      .references(() => metricTypes.id),
    value: doublePrecision("value").notNull(),
  },
  (t) => [
    uniqueIndex("idx_event_metrics_event_type").on(t.eventId, t.metricTypeId),
  ],
);

// INHERIT table — no user_id; scope via parent events row.
export const workoutSets = pgTable(
  "workout_sets",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    eventId: integer("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    exerciseMetricTypeId: integer("exercise_metric_type_id")
      .notNull()
      .references(() => metricTypes.id),
    setNumber: integer("set_number").notNull(),
    reps: integer("reps").notNull(),
    weight: doublePrecision("weight").notNull(),
    rpe: doublePrecision("rpe"),
    notes: text("notes"),
  },
  (t) => [
    index("idx_workout_sets_event").on(t.eventId),
    index("idx_workout_sets_exercise_mt").on(t.exerciseMetricTypeId),
  ],
);

export const goals = pgTable("goals", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  userId: integer("user_id")
    .notNull()
    .default(1)
    .references(() => users.id, { onDelete: "cascade" }),
  metricTypeId: integer("metric_type_id")
    .notNull()
    .references(() => metricTypes.id),
  activityId: integer("activity_id").notNull().references(() => activities.id),
  // Optional user-facing label. When null, every UI surface falls back
  // to the derived `<metric> <target><unit>` string so legacy rows look
  // unchanged. Editable from /goals/[id].
  name: text("name"),
  targetValue: doublePrecision("target_value").notNull(),
  deadline: date("deadline", { mode: "string" }).notNull(),
  status: text("status", { enum: ["active", "completed", "abandoned"] })
    .notNull()
    .default("active"),
  createdAt: isoTimestamptz("created_at").$defaultFn(isoNow).notNull(),
});

/**
 * A focus is a current emphasis on a goal. Two flavors share the same shape:
 * `source: 'manual'` is what the user typed (e.g. "Pause reps for bench"),
 * `source: 'llm'` is what the LLM proposed from training data, with `evidence`
 * carrying the workout_ids / metric trends that drove the suggestion.
 *
 * Activity is reachable via the goal — focuses don't carry activity_id directly.
 * Promote-an-llm-focus = update source to 'manual'. Dismiss = set dismissed_at.
 *
 * INHERIT table — no user_id; scope via parent goal row.
 */
export const focuses = pgTable(
  "focuses",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    name: text("name").notNull(),
    goalId: integer("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    source: text("source", { enum: ["manual", "llm"] })
      .notNull()
      .default("manual"),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    status: text("status", { enum: ["active", "completed", "abandoned"] })
      .notNull()
      .default("active"),
    technicalNotes: text("technical_notes"),
    evidence: text("evidence"),
    dismissedAt: isoTimestamptz("dismissed_at"),
    createdAt: isoTimestamptz("created_at").$defaultFn(isoNow).notNull(),
  },
  (t) => [index("idx_focuses_goal_status").on(t.goalId, t.status)],
);

/**
 * Per-goal markdown journal. Append-only timestamped entries form the longitudinal
 * narrative of a goal. `verdict_focus_id` tags entries auto-generated when a focus
 * closes, so they can be styled differently in the journal feed.
 * `linked_metric_type_id` is optional — pin an entry to a metric without resurrecting
 * a join table.
 *
 * INHERIT table — no user_id; scope via parent goal row.
 */
export const goalJournalEntries = pgTable(
  "goal_journal_entries",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    goalId: integer("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    createdAt: isoTimestamptz("created_at").$defaultFn(isoNow).notNull(),
    verdictFocusId: integer("verdict_focus_id").references(
      (): AnyPgColumn => focuses.id,
      { onDelete: "set null" },
    ),
    linkedMetricTypeId: integer("linked_metric_type_id").references(
      () => metricTypes.id,
      { onDelete: "set null" },
    ),
  },
  (t) => [index("idx_goal_journal_goal_created").on(t.goalId, t.createdAt)],
);

/**
 * Free-form journal entries on events (issue #19). Same shape as
 * goal_journal_entries but keyed on events.id, so notes can live on any
 * event — regular or composite. INHERIT: no user_id; scope through the
 * parent events.user_id (like workout_sets / event_metrics).
 *
 * `updated_at` is set on create and on every PATCH (full edit/delete,
 * unlike the append-only goal journal — see #33 to bring that to parity).
 *
 * Composite unmerge copies a composite's entries onto selected member
 * events before the composite row (and its entries, via cascade) is
 * deleted — see src/app/api/events/[id]/unmerge/route.ts.
 */
export const eventJournalEntries = pgTable(
  "event_journal_entries",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    eventId: integer("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    createdAt: isoTimestamptz("created_at").$defaultFn(isoNow).notNull(),
    updatedAt: isoTimestamptz("updated_at").$defaultFn(isoNow).notNull(),
  },
  (t) => [index("idx_event_journal_event_created").on(t.eventId, t.createdAt)],
);

/**
 * One row per LLM call. Metadata only (no message content — content lives in
 * focuses.evidence or goal_journal_entries). Lets us track cost, latency, and
 * failure rates without joining to external service logs.
 *
 * `userId` is nullable because account deletion sets it to NULL (anonymizes
 * historical cost data — we want the cumulative usage stats to survive).
 * `deletedUserHash` captures sha256 of the deleted user's email so we can
 * still bucket calls per ex-user for cost attribution without keeping the
 * email itself. NULL while the user is alive.
 */
export const coachCalls = pgTable(
  "coach_calls",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: integer("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    deletedUserHash: text("deleted_user_hash"),
    ts: isoTimestamptz("ts").$defaultFn(isoNow).notNull(),
    endpoint: text("endpoint").notNull(),
    goalId: integer("goal_id").references(() => goals.id, {
      onDelete: "set null",
    }),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    model: text("model").notNull(),
    status: text("status").notNull().default("success"),
  },
  (t) => [
    index("idx_coach_calls_ts").on(t.ts),
    index("idx_coach_calls_goal").on(t.goalId),
    index("idx_coach_calls_user").on(t.userId),
  ],
);

export const ingestConfigs = pgTable(
  "ingest_configs",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .default(1)
      .references(() => users.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    // AES-256-GCM ciphertext, format: base64(iv || ciphertext || tag).
    // 12-byte random IV per encryption (IV reuse breaks GCM). Decrypt
    // fails closed on tag mismatch via src/lib/auth/secrets.ts.
    encryptedValue: text("encrypted_value"),
    // sha256(plaintext_token), indexed. Required for HAE rows (bearer-
    // auth lookup); not used for Strava (looked up by (user_id, source)).
    // AES-GCM is non-deterministic — we cannot index ciphertext directly,
    // so the hash column is the only way to find a row by token value.
    lookupHash: text("lookup_hash"),
    lastSyncAt: isoTimestamptz("last_sync_at"),
    enabled: boolean("enabled").notNull().default(true),
  },
  (t) => [
    uniqueIndex("ingest_configs_user_source_uniq").on(t.userId, t.source),
    index("idx_ingest_configs_lookup_hash").on(t.lookupHash),
  ],
);

export const importSources = pgTable(
  "import_sources",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .default(1)
      .references(() => users.id, { onDelete: "cascade" }),
    // Display name, also used as the `source` value written to metrics/events.
    name: text("name").notNull(),
    kind: text("kind", { enum: ["metrics", "events", "workout_sets"] }).notNull(),
    // JSON-encoded ImportMapping (see src/lib/import-mapping.ts). Opaque to
    // the DB layer; parsed by the import runner.
    mapping: text("mapping").notNull(),
    createdAt: isoTimestamptz("created_at").$defaultFn(isoNow).notNull(),
  },
  (t) => [uniqueIndex("import_sources_user_name_uniq").on(t.userId, t.name)],
);

/**
 * Per-user app preferences. PK is user_id (was singleton id=1 in pre-multi-
 * user days; now one row per user).
 *
 * - `timezone`: IANA name (e.g. `America/Los_Angeles`). null falls back
 *   to the JS runtime's resolved TZ.
 */
export const appSettings = pgTable("app_settings", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  timezone: text("timezone"),
  // POC for issue #25 — first column converted to native timestamptz
  // via the isoTimestamptz wrapper. The JS-side contract (ISO string in
  // `new Date().toISOString()` format) is preserved exactly; the
  // underlying storage is now correct timestamptz with indexable
  // temporal semantics. Other timestamp columns follow once the POC
  // proves the wrapper end-to-end.
  updatedAt: isoTimestamptz("updated_at").$defaultFn(isoNow).notNull(),
});

/**
 * Audit log for merges (activity + metric_type). One row per merge call,
 * inserted inside the same transaction that performs the merge so a
 * failure rolls everything back together. Drives /data/merges and the
 * inline undo toast.
 *
 * - `payload` is a versioned JSON blob (top-level `v: 1`) carrying
 *   everything needed to reverse the merge.
 * - `userId` is NOT NULL (multi-user enforces ownership). undo rejects
 *   if the caller's user_id doesn't match.
 * - `undoneAt` flips from NULL to a timestamp via CAS at undo start
 *   (TOCTOU-safe — concurrent double-undos see only one winner).
 */
export const mergeLog = pgTable(
  "merge_log",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .default(1)
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["metric_type", "activity"] }).notNull(),
    createdAt: isoTimestamptz("created_at").$defaultFn(isoNow).notNull(),
    canonicalId: integer("canonical_id").notNull(),
    canonicalName: text("canonical_name").notNull(),
    mergedNames: text("merged_names").notNull(),
    payload: text("payload").notNull(),
    undoneAt: isoTimestamptz("undone_at"),
  },
  (t) => [
    index("idx_merge_log_created_at").on(t.createdAt),
    index("idx_merge_log_user_id_created_at").on(t.userId, t.createdAt),
  ],
);

/**
 * Per-source config, scoped to user. PK becomes (user_id, source).
 */
export const sourceSettings = pgTable(
  "source_settings",
  {
    userId: integer("user_id")
      .notNull()
      .default(1)
      .references(() => users.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    reconcileEnabled: boolean("reconcile_enabled").notNull().default(false),
    updatedAt: isoTimestamptz("updated_at").$defaultFn(isoNow).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.source] })],
);

/**
 * Audit trail for reconcile deletions. Zero-deletion ingest runs don't
 * write here; only batches that actually removed rows.
 *
 * `metric_type_id` has no FK so rows survive a later metric_types delete.
 */
export const reconcileLog = pgTable(
  "reconcile_log",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .default(1)
      .references(() => users.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    kind: text("kind", { enum: ["metric", "event"] }).notNull(),
    metricTypeId: integer("metric_type_id"),
    deletedCount: integer("deleted_count").notNull(),
    rangeStart: isoTimestamptz("range_start").notNull(),
    rangeEnd: isoTimestamptz("range_end").notNull(),
    at: isoTimestamptz("at").$defaultFn(isoNow).notNull(),
  },
  (t) => [
    index("idx_reconcile_log_source_at").on(t.source, t.at),
    index("idx_reconcile_log_user").on(t.userId),
  ],
);

export const dailySummaries = pgTable(
  "daily_summaries",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .default(1)
      .references(() => users.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    metricTypeId: integer("metric_type_id")
      .notNull()
      .references(() => metricTypes.id),
    avgValue: doublePrecision("avg_value"),
    minValue: doublePrecision("min_value"),
    maxValue: doublePrecision("max_value"),
    count: integer("count").notNull().default(0),
    lastIngestAt: isoTimestamptz("last_ingest_at"),
  },
  (t) => [
    uniqueIndex("idx_daily_summaries_user_date_metric").on(
      t.userId,
      t.date,
      t.metricTypeId,
    ),
  ],
);

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
 * `activity_id` is optional and drives the activity-color dot in the sidebar.
 * `position` orders dashboards in the sidebar.
 */
export const dashboards = pgTable(
  "dashboards",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .default(1)
      .references(() => users.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    icon: text("icon"),
    activityId: integer("activity_id").references(() => activities.id, {
      onDelete: "set null",
    }),
    position: integer("position").notNull().default(0),
    isSystem: boolean("is_system").notNull().default(false),
    seededId: text("seeded_id"),
    createdAt: isoTimestamptz("created_at").$defaultFn(isoNow).notNull(),
    updatedAt: isoTimestamptz("updated_at").$defaultFn(isoNow).notNull(),
  },
  (t) => [
    uniqueIndex("dashboards_user_slug_uniq").on(t.userId, t.slug),
    uniqueIndex("dashboards_user_seeded_id_uniq").on(t.userId, t.seededId),
    index("idx_dashboards_position").on(t.position),
  ],
);

/**
 * Each row is one widget on one dashboard. INHERIT table — scope via parent
 * dashboard row.
 */
export const dashboardWidgets = pgTable(
  "dashboard_widgets",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
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
  },
  (t) => [
    index("idx_dashboard_widgets_dashboard_position").on(
      t.dashboardId,
      t.position,
    ),
  ],
);
