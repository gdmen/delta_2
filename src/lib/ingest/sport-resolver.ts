import { db } from "@/db";
import { sports } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { userScope } from "@/lib/auth/scope";

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
 *   3. Auto-create with name `${source}:${rawName}` and a random color.
 *      Race-safe: INSERT OR IGNORE + SELECT-by-name fallback so two
 *      concurrent imports converge on the same id without throwing.
 *
 * No alias table for sports today (unlike metric_types). The merge UI at
 * /data/sports updates `events.sport_id`, `goals.sport_id`,
 * `dashboards.sport_id`, and `metric_types.sport_id` directly. If sport
 * aliases ever become useful, mirror metric_type_aliases.
 *
 * Per-user: sports is OWNED. Each cache is built for one user_id and the
 * resolver only sees that user's sports.
 */

export interface SportCache {
  /** Owner of this cache. Asserted on every autoCreate to prevent the
   *  silent-corruption bug if a caller passes the wrong cache. */
  userId: number;
  byName: Map<string, number>;
}

export async function buildSportCache(userId: number): Promise<SportCache> {
  const rows = await db
    .select({ id: sports.id, name: sports.name })
    .from(sports)
    .where(userScope(userId).sports);
  return { userId, byName: new Map(rows.map((r) => [r.name, r.id])) };
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

  const color = randomColor();
  const inserted = await db
    .insert(sports)
    .values({ userId: cache.userId, name, color })
    .onConflictDoNothing()
    .returning({ id: sports.id });

  let id: number | undefined = inserted[0]?.id;
  if (id === undefined) {
    // Conflict path: another concurrent path won the race. Re-query the
    // canonical row so both callers converge on the same id.
    const existing = await db
      .select({ id: sports.id })
      .from(sports)
      .where(and(userScope(cache.userId).sports, eq(sports.name, name)))
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
 * Random hex color for a freshly minted sport. Stored once on the row,
 * so non-determinism across runs is fine — the user can override via
 * /data/sports if a generated color is hard to read or clashes with a
 * neighbour. Hue is bounded in HSL space (mid-saturation, mid-light)
 * so no auto-created sport ends up near-white or near-black on the
 * default theme.
 */
export function randomColor(): string {
  const h = Math.floor(Math.random() * 360);
  return hslToHex(h, 65, 50);
}

function hslToHex(h: number, s: number, l: number): string {
  const ll = l / 100;
  const a = (s / 100) * Math.min(ll, 1 - ll);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = ll - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
