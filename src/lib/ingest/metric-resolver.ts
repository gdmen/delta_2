import { db } from "@/db";
import { metricTypes } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Resolve a source-specific metric name to a metric_types.id, auto-creating
 * a row for unmapped names so nothing gets silently dropped.
 *
 * Pattern for adding a new import source:
 *   1. Define a name map for that source (e.g. APPLE_HEALTH_METRIC_MAP).
 *   2. Call resolveMetricTypeId(rawName, map, sourceSystem, unit?, cache).
 *   3. Known names land in their canonical metric_type.
 *      Unknown names get stored under `<source>:<rawName>` so you can see
 *      them in the DB, decide what to do, and fold them into the map later
 *      (historical rows can then be re-linked).
 *
 * The cache is per-request: a Map<metricTypeName, id> populated by a single
 * `db.select().from(metricTypes)` up-front, passed in by the caller.
 */

export type MetricTypeCache = Map<string, number>;

export async function buildMetricTypeCache(): Promise<MetricTypeCache> {
  const rows = await db.select({ id: metricTypes.id, name: metricTypes.name }).from(metricTypes);
  return new Map(rows.map((r) => [r.name, r.id]));
}

export interface ResolveArgs {
  rawName: string;
  map: Record<string, string>;
  sourceSystem: string;
  unit?: string;
  cache: MetricTypeCache;
}

export async function resolveMetricTypeId({
  rawName,
  map,
  sourceSystem,
  unit,
  cache,
}: ResolveArgs): Promise<number> {
  const canonical = map[rawName];
  if (canonical) {
    const id = cache.get(canonical);
    if (id !== undefined) return id;
    // Canonical name is in the map but not seeded — fall through to auto-create
    // under the canonical name so at least nothing drops.
    return autoCreate(canonical, unit, cache);
  }

  // Unmapped: store under `<source>:<rawName>` so unknowns are visible and
  // don't collide with any canonical name.
  const fallbackName = `${sourceSystem}:${rawName}`;
  return autoCreate(fallbackName, unit, cache);
}

async function autoCreate(
  name: string,
  unit: string | undefined,
  cache: MetricTypeCache
): Promise<number> {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;

  const inserted = await db
    .insert(metricTypes)
    .values({ name, unit: unit ?? "", frequencyHint: "daily" })
    .onConflictDoNothing()
    .returning({ id: metricTypes.id });

  let id: number | undefined = inserted[0]?.id;
  if (id === undefined) {
    // Row already existed (unique conflict). Re-query.
    const existing = await db
      .select({ id: metricTypes.id })
      .from(metricTypes)
      .where(eq(metricTypes.name, name))
      .limit(1);
    id = existing[0]?.id;
  }

  if (id === undefined) {
    throw new Error(`Failed to resolve or create metric_type "${name}"`);
  }
  cache.set(name, id);
  return id;
}
