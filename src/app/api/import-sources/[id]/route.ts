import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  dailySummaries,
  eventMetrics,
  events,
  goals,
  importSources,
  metrics,
  metricTypeAliases,
  metricTypes,
  reconcileLog,
  sourceSettings,
  workoutSets,
} from "@/db/schema";
import { and, eq, inArray, like, ne, not, sql } from "drizzle-orm";
import type { ImportMapping } from "@/lib/import-mapping";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const rows = await db
    .select()
    .from(importSources)
    .where(and(userScope(user.id).importSources, eq(importSources.id, id)))
    .limit(1);
  if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const r = rows[0];
  return NextResponse.json({
    id: r.id,
    name: r.name,
    kind: r.kind,
    mapping: JSON.parse(r.mapping) as ImportMapping,
    createdAt: r.createdAt,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  let body: { name?: string; kind?: string; mapping?: ImportMapping };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Partial<typeof importSources.$inferInsert> = {};
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.kind !== undefined) {
    if (!["metrics", "events", "workout_sets"].includes(body.kind)) {
      return NextResponse.json({ error: "invalid kind" }, { status: 400 });
    }
    updates.kind = body.kind as "metrics" | "events" | "workout_sets";
  }
  if (body.mapping !== undefined) updates.mapping = JSON.stringify(body.mapping);

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  await db
    .update(importSources)
    .set(updates)
    .where(and(userScope(user.id).importSources, eq(importSources.id, id)));
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/import-sources/:id
 *
 * Tear the source down completely:
 *  - every metrics + events row tagged with this source (event children
 *    cascade via FK ON DELETE CASCADE)
 *  - reconcile_log audit trail
 *  - source_settings row
 *  - any `${sourceTag}:%` metric_types that are now unreferenced
 *    (per-row check; a metric_type is kept if it's still pinned by a
 *    goal, workout_set, event_metric, or by a foreign-prefix alias
 *    pointing at it as canonical — meaning some merge made it the home
 *    for another source's data, and dropping it would orphan that)
 *  - the import_sources config row itself
 *
 * Skipped metric_types are returned in the response so the UI can list
 * them ("kept these because X still references them; delete them
 * manually if you want them gone"). Stays away from cross-source
 * surprises like silently nuking an alias that another source's ingest
 * routes through.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  // Look up the source first so we can compute the same `sourceTag`
  // string that ingest writes into metrics/events.source.
  const rows = await db
    .select({ name: importSources.name })
    .from(importSources)
    .where(and(userScope(user.id).importSources, eq(importSources.id, id)))
    .limit(1);
  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const sourceTag = rows[0].name.toLowerCase().replace(/\s+/g, "_");
  const namePrefix = `${sourceTag}:`;
  const namePrefixSql = `${sourceTag}:%`;

  // Pre-count for the response payload.
  const [m] = await db
    .select({ c: sql<number>`count(*)` })
    .from(metrics)
    .where(and(userScope(user.id).metrics, eq(metrics.source, sourceTag)));
  const [e] = await db
    .select({ c: sql<number>`count(*)` })
    .from(events)
    .where(and(userScope(user.id).events, eq(events.source, sourceTag)));
  const [r] = await db
    .select({ c: sql<number>`count(*)` })
    .from(reconcileLog)
    .where(and(userScope(user.id).reconcileLog, eq(reconcileLog.source, sourceTag)));

  // Delete metrics first (no children). Then events — workout_sets and
  // event_metrics cascade via FK ON DELETE CASCADE on event_id. Then
  // operational + settings rows. Each statement is its own implicit
  // txn (better-sqlite3-drizzle rejects async tx callbacks); a partial
  // failure leaves the source half-deleted, which the user can fix by
  // retrying — the operations are idempotent.
  await db
    .delete(metrics)
    .where(and(userScope(user.id).metrics, eq(metrics.source, sourceTag)));
  await db
    .delete(events)
    .where(and(userScope(user.id).events, eq(events.source, sourceTag)));
  await db
    .delete(reconcileLog)
    .where(and(userScope(user.id).reconcileLog, eq(reconcileLog.source, sourceTag)));
  await db
    .delete(sourceSettings)
    .where(and(userScope(user.id).sourceSettings, eq(sourceSettings.source, sourceTag)));

  // Now sweep `${sourceTag}:%` metric_types. After the deletes above,
  // most should be unreferenced — but a foreign-prefixed alias OR a
  // surviving goal/workout_set/event_metric/metric pin keeps them.
  const candidateTypes = await db
    .select({ id: metricTypes.id, name: metricTypes.name })
    .from(metricTypes)
    .where(and(userScope(user.id).metricTypes, like(metricTypes.name, namePrefixSql)));

  const deletedTypes: string[] = [];
  const keptTypes: { name: string; reason: string }[] = [];

  // event_metrics + workout_sets are INHERIT — restrict by joining
  // through this user's events.
  const ownedEventIds = db
    .select({ id: events.id })
    .from(events)
    .where(userScope(user.id).events);

  for (const t of candidateTypes) {
    // Refs that would either FK-block the delete or silently break
    // other surfaces (goals, dashboards, foreign aliases).
    const [goalRef] = await db
      .select({ c: sql<number>`count(*)` })
      .from(goals)
      .where(and(userScope(user.id).goals, eq(goals.metricTypeId, t.id)));
    const [setRef] = await db
      .select({ c: sql<number>`count(*)` })
      .from(workoutSets)
      .where(
        and(
          eq(workoutSets.exerciseMetricTypeId, t.id),
          inArray(workoutSets.eventId, ownedEventIds),
        ),
      );
    const [emRef] = await db
      .select({ c: sql<number>`count(*)` })
      .from(eventMetrics)
      .where(
        and(
          eq(eventMetrics.metricTypeId, t.id),
          inArray(eventMetrics.eventId, ownedEventIds),
        ),
      );
    // Stray metrics rows from OTHER sources (manual entries against
    // this metric_type, ingest from a different source that aliased to
    // it). Pre-delete pass already cleared the ones tagged with this
    // source.
    const [metricRef] = await db
      .select({ c: sql<number>`count(*)` })
      .from(metrics)
      .where(and(userScope(user.id).metrics, eq(metrics.metricTypeId, t.id)));
    // Foreign-prefix aliases pointing at this metric_type as canonical
    // — those came from a merge ("apple_health:body_mass" → this).
    // Cascade-deleting them would silently break HAE routing.
    const [foreignAlias] = await db
      .select({ c: sql<number>`count(*)` })
      .from(metricTypeAliases)
      .where(
        and(
          userScope(user.id).metricTypeAliases,
          eq(metricTypeAliases.canonicalMetricTypeId, t.id),
          not(like(metricTypeAliases.alias, namePrefixSql)),
          ne(metricTypeAliases.alias, t.name),
        ),
      );

    const reasons: string[] = [];
    if (Number(goalRef?.c ?? 0) > 0) reasons.push(`${goalRef!.c} goal(s)`);
    if (Number(setRef?.c ?? 0) > 0) reasons.push(`${setRef!.c} workout set(s)`);
    if (Number(emRef?.c ?? 0) > 0) reasons.push(`${emRef!.c} event metric(s)`);
    if (Number(metricRef?.c ?? 0) > 0) reasons.push(`${metricRef!.c} metric(s) from other sources`);
    if (Number(foreignAlias?.c ?? 0) > 0) reasons.push(`${foreignAlias!.c} alias(es) from other sources`);

    if (reasons.length > 0) {
      keptTypes.push({ name: t.name, reason: reasons.join(", ") });
      continue;
    }

    // Safe to delete. daily_summaries has a NOT NULL FK without cascade
    // — wipe its rows first or the metric_types delete will FK-fail.
    // Self-prefix aliases (e.g. `${sourceTag}:foo` aliased to itself)
    // CASCADE-delete via the alias FK; that's fine.
    await db
      .delete(dailySummaries)
      .where(and(userScope(user.id).dailySummaries, eq(dailySummaries.metricTypeId, t.id)));
    await db
      .delete(metricTypes)
      .where(and(userScope(user.id).metricTypes, eq(metricTypes.id, t.id)));
    deletedTypes.push(t.name);
  }

  await db
    .delete(importSources)
    .where(and(userScope(user.id).importSources, eq(importSources.id, id)));

  return NextResponse.json({
    ok: true,
    sourceTag,
    sourcePrefix: namePrefix,
    deleted: {
      metrics: Number(m?.c ?? 0),
      events: Number(e?.c ?? 0),
      reconcileLog: Number(r?.c ?? 0),
      metricTypes: deletedTypes.length,
    },
    deletedMetricTypes: deletedTypes,
    keptMetricTypes: keptTypes,
  });
}
