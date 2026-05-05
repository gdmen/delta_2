import { db } from "@/db";
import { sports } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Resolve a source-specific sport name to a sports.id, auto-creating a
 * row for unmapped names so nothing gets silently dropped or hard-fails.
 *
 * Mirrors the shape of `metric-resolver.ts` so importers see a uniform
 * pattern: the user merges source-prefixed orphans (`strava:Ride`,
 * `apple_health:Hiking`, etc.) into canonical names via /data/sports.
 *
 * Three resolution paths:
 *   1. Cache hit by raw name — covers user-renamed canonicals (e.g. the
 *      user already merged `strava:Ride` into `biking`; raw is `biking`).
 *   2. Cache hit by `${source}:${rawName}` — covers post-import re-runs.
 *   3. Auto-create with name `${source}:${rawName}` and a curated-palette
 *      color. Race-safe: INSERT OR IGNORE + SELECT-by-name fallback so
 *      two concurrent imports converge on the same id without throwing.
 *
 * No alias table for sports today (unlike metric_types). The merge UI at
 * /data/sports updates `events.sport_id`, `goals.sport_id`,
 * `dashboards.sport_id`, and `metric_types.sport_id` directly. If sport
 * aliases ever become useful, mirror metric_type_aliases.
 */

export interface SportCache {
  byName: Map<string, number>;
}

export async function buildSportCache(): Promise<SportCache> {
  const rows = await db.select({ id: sports.id, name: sports.name }).from(sports);
  return { byName: new Map(rows.map((r) => [r.name, r.id])) };
}

export interface ResolveSportArgs {
  rawName: string;
  sourceSystem: string;
  cache: SportCache;
}

export async function resolveSportId({
  rawName,
  sourceSystem,
  cache,
}: ResolveSportArgs): Promise<number> {
  // 1. Direct hit — covers user-renamed canonicals.
  const direct = cache.byName.get(rawName);
  if (direct !== undefined) return direct;

  // 2. Source-prefixed hit — covers post-import re-runs.
  const prefixed = `${sourceSystem}:${rawName}`;
  const fromPrefix = cache.byName.get(prefixed);
  if (fromPrefix !== undefined) return fromPrefix;

  // 3. Auto-create. Race-safe path mirrors metric-resolver auto-create.
  return autoCreate(prefixed, cache);
}

async function autoCreate(name: string, cache: SportCache): Promise<number> {
  // Cheap re-check before going to the DB — covers tight loops within a
  // single request that resolve the same new name multiple times.
  const cached = cache.byName.get(name);
  if (cached !== undefined) return cached;

  const color = paletteColor(name);
  const inserted = await db
    .insert(sports)
    .values({ name, color })
    .onConflictDoNothing()
    .returning({ id: sports.id });

  let id: number | undefined = inserted[0]?.id;
  if (id === undefined) {
    // Conflict path: another concurrent path won the race. Re-query the
    // canonical row so both callers converge on the same id.
    const existing = await db
      .select({ id: sports.id })
      .from(sports)
      .where(eq(sports.name, name))
      .limit(1);
    id = existing[0]?.id;
  }

  if (id === undefined) {
    throw new Error(`Failed to resolve or create sport "${name}"`);
  }
  cache.byName.set(name, id);
  // Visibility for the dev log — auto-creation is a soft event but worth
  // surfacing so a user inspecting an import run can see what landed.
  console.log(`[sport-resolver] auto-created sport: ${name} (color ${color})`);
  return id;
}

/**
 * Curated 12-color qualitative palette indexed by stable string hash.
 * Picked for visual distinguishability without being garish — mid-tone
 * saturation, mid-light, no two adjacent hues clash. Deterministic:
 * same name → same color across runs.
 *
 * Why a palette and not free-floating HSL: hashing into a continuous
 * hue gives ~25% birthday-collision odds at 10 sports for "visually
 * distinguishable" (~30° hue separation). A 12-slot palette guarantees
 * no two sports share a color until the catalog exceeds 12, at which
 * point the user is in heavy-merge territory anyway.
 */
const PALETTE = [
  "#2563eb", // blue
  "#dc2626", // red
  "#16a34a", // green
  "#d97706", // amber
  "#7c3aed", // violet
  "#db2777", // pink
  "#0891b2", // cyan
  "#65a30d", // lime
  "#c026d3", // fuchsia
  "#ea580c", // orange
  "#0d9488", // teal
  "#a16207", // brown-amber
];

export function paletteColor(name: string): string {
  return PALETTE[hashString(name) % PALETTE.length];
}

/**
 * Tiny deterministic string hash. Not cryptographic — just stable across
 * runs and well-distributed across the 12-slot palette. djb2-style.
 */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  return Math.abs(h | 0);
}
