import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  events,
  importSources,
  metrics,
  reconcileLog,
} from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

/**
 * Per-source data wipe.
 *
 * Distinct from `/api/dev/wipe-data` (dev-only nuke of every table). This
 * endpoint is production-safe and scoped: it deletes ONLY the rows whose
 * `source` column matches the requested source.
 *
 * Tables affected:
 *   - `metrics`        — DELETE WHERE source = ?
 *   - `events`         — DELETE WHERE source = ?
 *                        (`workout_sets` and `event_metrics` cascade via
 *                        FK ON DELETE CASCADE)
 *   - `reconcile_log`  — DELETE WHERE source = ? (audit trail; cleared so
 *                        future reconciles start from a clean state)
 *
 * Tables intentionally untouched: metric_types, sports, dashboards, goals,
 * focuses, metric_type_aliases, source_settings, ingest_configs,
 * import_sources (the per-source CONFIG row stays so the user's mapping
 * isn't lost — wiping data is reversible by re-import; wiping config is
 * not).
 *
 * The endpoint validates the source against a whitelist (built-in
 * importers + a row in `import_sources` for CSV sources). The POST body
 * also requires a `confirm` field equal to the source key — protects
 * against stale URLs / accidental clicks.
 *
 * Per-user: every wipe is scoped to the requesting user — Alice wiping
 * her Strava data MUST NOT touch Bob's Strava data. CSV-source whitelist
 * also restricted to this user's import_sources rows.
 */

const BUILT_IN_SOURCES = ["apple_health", "strava", "bodyspec_dexa"] as const;

interface WipeCounts {
  metrics: number;
  events: number;
  reconcileLog: number;
}

async function isValidSource(source: string, userId: number): Promise<boolean> {
  if ((BUILT_IN_SOURCES as readonly string[]).includes(source)) return true;
  // CSV sources: `source` column on metrics/events is the lowercased
  // underscore-joined import_sources.name. Recompute and check existence.
  const all = await db
    .select({ name: importSources.name })
    .from(importSources)
    .where(userScope(userId).importSources);
  return all.some((r) => r.name.toLowerCase().replace(/\s+/g, "_") === source);
}

async function countsFor(source: string, userId: number): Promise<WipeCounts> {
  const [m] = await db
    .select({ c: sql<number>`count(*)` })
    .from(metrics)
    .where(and(userScope(userId).metrics, eq(metrics.source, source)));
  const [e] = await db
    .select({ c: sql<number>`count(*)` })
    .from(events)
    .where(and(userScope(userId).events, eq(events.source, source)));
  const [r] = await db
    .select({ c: sql<number>`count(*)` })
    .from(reconcileLog)
    .where(and(userScope(userId).reconcileLog, eq(reconcileLog.source, source)));
  return {
    metrics: Number(m?.c ?? 0),
    events: Number(e?.c ?? 0),
    reconcileLog: Number(r?.c ?? 0),
  };
}

/**
 * GET /api/data-sources/wipe?source=...
 * Returns per-table counts. Used by the confirmation modal to show the
 * user exactly what will go.
 */
export async function GET(request: NextRequest) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  const source = request.nextUrl.searchParams.get("source");
  if (!source) {
    return NextResponse.json({ error: "?source is required" }, { status: 400 });
  }
  if (!(await isValidSource(source, user.id))) {
    return NextResponse.json({ error: `Unknown source: ${source}` }, { status: 400 });
  }
  const counts = await countsFor(source, user.id);
  return NextResponse.json({ source, counts });
}

/**
 * POST /api/data-sources/wipe
 * Body: { source: string, confirm: string }
 * `confirm` must equal `source` exactly — the UI asks the user to type
 * the source key into a confirmation field.
 */
export async function POST(request: NextRequest) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  }
  const { source, confirm } = body as { source?: unknown; confirm?: unknown };
  if (typeof source !== "string" || typeof confirm !== "string") {
    return NextResponse.json(
      { error: "Body must include `source` and `confirm` strings" },
      { status: 400 },
    );
  }
  if (source !== confirm) {
    return NextResponse.json(
      { error: "`confirm` must match `source` exactly" },
      { status: 400 },
    );
  }
  if (!(await isValidSource(source, user.id))) {
    return NextResponse.json({ error: `Unknown source: ${source}` }, { status: 400 });
  }

  // Capture pre-counts so the response can confirm what was deleted.
  const before = await countsFor(source, user.id);

  // Delete metrics first (safe; no children). Then events — its children
  // (workout_sets, event_metrics) cascade. Finally reconcile_log. No FKs
  // to disable; everything is naturally ordered child-before-parent or
  // already protected by the schema's ON DELETE CASCADE. All three run
  // inside one transaction so a partial failure rolls back to the prior
  // state instead of leaving the source half-wiped.
  await db.transaction(async (tx) => {
    await tx
      .delete(metrics)
      .where(and(userScope(user.id).metrics, eq(metrics.source, source)));
    await tx
      .delete(events)
      .where(and(userScope(user.id).events, eq(events.source, source)));
    await tx
      .delete(reconcileLog)
      .where(and(userScope(user.id).reconcileLog, eq(reconcileLog.source, source)));
  });

  return NextResponse.json({ source, deleted: before });
}

