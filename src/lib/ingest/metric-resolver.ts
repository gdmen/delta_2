import { db as defaultDb } from "@/db";
import { metricTypes, metricTypeAliases } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Resolve a source-specific metric name to a metric_types.id, auto-creating
 * a row for unmapped names so nothing gets silently dropped.
 *
 * Pattern for adding a new import source:
 *   1. (Optional) define a name map for that source — for one-shot defaults
 *      at ingest time; the DB alias table supersedes it once users merge.
 *   2. Call resolveMetricTypeId(rawName, map, sourceSystem, unit?, cache).
 *   3. Known names land in their canonical metric_type via the map or the
 *      alias table. Unknown names get stored under `<source>:<rawName>` so
 *      you can see them, then merge them from the UI to create an alias —
 *      future ingests route directly to canonical.
 *
 * The cache is per-request. A single pass populates both the canonical
 * name → id map and the alias → id map; callers pass it in.
 *
 * The resolver returns `{ id, alias }` where `alias` is the string the
 * resolver matched on (or the auto-created name). Callers persist this
 * on the metrics row so merge undo can chain-unwind by alias.
 */

type DbLike = typeof defaultDb;

export interface MetricTypeCache {
  byName: Map<string, number>;
  aliasToId: Map<string, number>;
}

export async function buildMetricTypeCache(
  db: DbLike = defaultDb,
): Promise<MetricTypeCache> {
  const [typeRows, aliasRows] = await Promise.all([
    db.select({ id: metricTypes.id, name: metricTypes.name }).from(metricTypes),
    db
      .select({
        alias: metricTypeAliases.alias,
        id: metricTypeAliases.canonicalMetricTypeId,
      })
      .from(metricTypeAliases),
  ]);
  return {
    byName: new Map(typeRows.map((r) => [r.name, r.id])),
    aliasToId: new Map(aliasRows.map((r) => [r.alias, r.id])),
  };
}

export interface ResolveArgs {
  rawName: string;
  map: Record<string, string>;
  sourceSystem: string;
  unit?: string;
  cache: MetricTypeCache;
}

export interface ResolveResult {
  id: number;
  alias: string;
}

export async function resolveMetricTypeId(
  { rawName, map, sourceSystem, unit, cache }: ResolveArgs,
  db: DbLike = defaultDb,
): Promise<ResolveResult> {
  // 1. Hardcoded source map — if it points to a canonical that exists,
  //    it wins (preserves today's CSV "identity map" behaviour where a
  //    raw name that matches a canonical routes straight to canonical).
  const canonical = map[rawName];
  if (canonical) {
    const id = cache.byName.get(canonical);
    if (id !== undefined) return { id, alias: canonical };
    // Map hit but canonical missing — fall through to alias/autocreate.
  }

  // 2. Alias table — checks the raw name AND the source-prefixed orphan
  //    form so past merges cover future ingests regardless of which path
  //    they took before the merge. User-driven merges populate this table.
  const directAlias = cache.aliasToId.get(rawName);
  if (directAlias !== undefined) return { id: directAlias, alias: rawName };
  const prefixedKey = `${sourceSystem}:${rawName}`;
  const prefixedAlias = cache.aliasToId.get(prefixedKey);
  if (prefixedAlias !== undefined) return { id: prefixedAlias, alias: prefixedKey };

  // 3. Map pointed to a canonical that isn't seeded yet — create under
  //    the canonical name so nothing drops. (Rare post-0006.)
  if (canonical) {
    const id = await autoCreate(canonical, unit, cache, db);
    return { id, alias: canonical };
  }

  // 4. Unknown — auto-create `<source>:<rawName>` so it's visible and
  //    can't collide with any canonical name. User can merge it later.
  const orphanName = `${sourceSystem}:${rawName}`;
  const id = await autoCreate(orphanName, unit, cache, db);
  return { id, alias: orphanName };
}

async function autoCreate(
  name: string,
  unit: string | undefined,
  cache: MetricTypeCache,
  db: DbLike,
): Promise<number> {
  const cached = cache.byName.get(name);
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
  cache.byName.set(name, id);
  return id;
}
