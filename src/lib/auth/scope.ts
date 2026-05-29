import { eq } from "drizzle-orm";
import {
  activities,
  metricTypes,
  metricTypeAliases,
  metrics,
  events,
  eventDuplicateDenylist,
  goals,
  ingestConfigs,
  importSources,
  appSettings,
  sourceSettings,
  dashboards,
  reconcileLog,
  mergeLog,
  dailySummaries,
  coachCalls,
} from "@/db/schema";

/**
 * Per-user query scoping helpers. Use these inside a Drizzle WHERE
 * clause when you've got a userId from `requireUser()` and you're
 * reading or writing an OWNED table.
 *
 * The shape — `userScope(uid).activities` returns `eq(activities.userId, uid)`
 * — makes call sites read like `where(userScope(uid).activities)` or
 * `where(and(userScope(uid).activities, eq(activities.id, activityId)))`.
 *
 * Why a single function instead of `eq(table.userId, uid)` inline?
 *   1. Greppable: `userScope(` matches every per-user query. Easy to
 *      audit at review time.
 *   2. Single point of forgetting: if a future schema change renames
 *      the userId column on a table, you fix one place.
 *   3. Readable in the cross-user-isolation harness — the test asserts
 *      `userScope(victim.id).metrics` returns zero rows when the
 *      attacker tries to PATCH them.
 *
 * INHERIT tables (event_metrics, workout_sets, focuses,
 * goal_journal_entries, dashboard_widgets) are NOT in this map — they
 * scope through their parent FK (event_id, goal_id, etc.).
 */
export function userScope(userId: number) {
  return {
    activities: eq(activities.userId, userId),
    metricTypes: eq(metricTypes.userId, userId),
    metricTypeAliases: eq(metricTypeAliases.userId, userId),
    metrics: eq(metrics.userId, userId),
    events: eq(events.userId, userId),
    eventDuplicateDenylist: eq(eventDuplicateDenylist.userId, userId),
    goals: eq(goals.userId, userId),
    ingestConfigs: eq(ingestConfigs.userId, userId),
    importSources: eq(importSources.userId, userId),
    appSettings: eq(appSettings.userId, userId),
    sourceSettings: eq(sourceSettings.userId, userId),
    dashboards: eq(dashboards.userId, userId),
    reconcileLog: eq(reconcileLog.userId, userId),
    mergeLog: eq(mergeLog.userId, userId),
    dailySummaries: eq(dailySummaries.userId, userId),
    coachCalls: eq(coachCalls.userId, userId),
  };
}
