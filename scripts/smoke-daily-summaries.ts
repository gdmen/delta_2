/**
 * Smoke test for PR #15 (daily_summaries recompute).
 *
 * Drives the exact API surface the new PATCH/DELETE handlers use —
 * `recomputeDailySummary` against the real dev DB — and asserts that
 * the cell math is right at each step.
 *
 * Self-cleans on success. On failure: prints the failing assertion and
 * exits non-zero; leaves the test rows in place so they can be inspected.
 *
 *   npx tsx scripts/smoke-daily-summaries.ts
 */
import { db } from "@/db";
import { metrics, metricTypes, dailySummaries, sports } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { recomputeDailySummary } from "@/lib/ingest-service";

const TEST_TAG = "smoke-test-daily-summaries";

async function pickUserId(): Promise<number> {
  const rows = await db
    .select({ id: sql<number>`id` })
    .from(sql.raw("users") as never)
    .limit(1);
  if (rows.length === 0) throw new Error("No users in DB; bootstrap one first");
  return rows[0].id;
}

async function getOrCreateMetricType(userId: number, name: string): Promise<number> {
  const existing = await db
    .select({ id: metricTypes.id })
    .from(metricTypes)
    .where(and(eq(metricTypes.userId, userId), eq(metricTypes.name, name)))
    .limit(1);
  if (existing.length > 0) return existing[0].id;

  // Look for a sport to attach. Any sport works for this test.
  const anySport = await db.select({ id: sports.id }).from(sports).where(eq(sports.userId, userId)).limit(1);
  const sportId = anySport[0]?.id ?? null;

  const result = await db
    .insert(metricTypes)
    .values({
      userId,
      name,
      unit: "test",
      higherIsBetter: true,
      sportId,
    })
    .returning({ id: metricTypes.id });
  return result[0].id;
}

async function fetchCell(userId: number, metricTypeId: number, date: string) {
  const rows = await db
    .select({
      avgValue: dailySummaries.avgValue,
      minValue: dailySummaries.minValue,
      maxValue: dailySummaries.maxValue,
      count: dailySummaries.count,
    })
    .from(dailySummaries)
    .where(
      and(
        eq(dailySummaries.userId, userId),
        eq(dailySummaries.metricTypeId, metricTypeId),
        eq(dailySummaries.date, date),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
}

async function run() {
  const userId = await pickUserId();
  const metricTypeId = await getOrCreateMetricType(userId, TEST_TAG);

  // Clean any stale state from a prior run.
  await db.delete(metrics).where(and(eq(metrics.userId, userId), eq(metrics.metricTypeId, metricTypeId)));
  await db.delete(dailySummaries).where(and(eq(dailySummaries.userId, userId), eq(dailySummaries.metricTypeId, metricTypeId)));

  console.log(`User ${userId}, metric_type ${metricTypeId} (${TEST_TAG})`);

  // ---- 1. Insert two rows on the same day; recompute manually. ----
  const dayA = "2026-05-12";
  await db.insert(metrics).values([
    { userId, metricTypeId, value: 10, recordedAt: `${dayA}T08:00:00.000Z`, source: TEST_TAG, sourceId: `${TEST_TAG}-1`, alias: null },
    { userId, metricTypeId, value: 30, recordedAt: `${dayA}T20:00:00.000Z`, source: TEST_TAG, sourceId: `${TEST_TAG}-2`, alias: null },
  ]);
  await recomputeDailySummary(userId, metricTypeId, `${dayA}T08:00:00.000Z`);

  let cell = await fetchCell(userId, metricTypeId, dayA);
  assert(cell !== null, "cell created after first recompute");
  assert(cell!.count === 2, `count=2 (got ${cell!.count})`);
  assert(cell!.avgValue === 20, `avg=20 (got ${cell!.avgValue})`);
  assert(cell!.minValue === 10, `min=10 (got ${cell!.minValue})`);
  assert(cell!.maxValue === 30, `max=30 (got ${cell!.maxValue})`);

  // ---- 2. Mutate value of one row (simulating PATCH), recompute. ----
  await db
    .update(metrics)
    .set({ value: 50 })
    .where(and(eq(metrics.userId, userId), eq(metrics.sourceId, `${TEST_TAG}-1`)));
  await recomputeDailySummary(userId, metricTypeId, `${dayA}T08:00:00.000Z`);

  cell = await fetchCell(userId, metricTypeId, dayA);
  assert(cell!.count === 2, `after value PATCH: count still 2 (got ${cell!.count})`);
  assert(cell!.avgValue === 40, `after value PATCH: avg=40 (got ${cell!.avgValue})`);
  assert(cell!.minValue === 30, `after value PATCH: min=30 (got ${cell!.minValue})`);
  assert(cell!.maxValue === 50, `after value PATCH: max=50 (got ${cell!.maxValue})`);

  // ---- 3. Move one row to a different day (PATCH with cross-day recordedAt). ----
  const dayB = "2026-05-13";
  const oldRecordedAt = `${dayA}T20:00:00.000Z`;
  await db
    .update(metrics)
    .set({ recordedAt: `${dayB}T08:00:00.000Z` })
    .where(and(eq(metrics.userId, userId), eq(metrics.sourceId, `${TEST_TAG}-2`)));
  // PATCH handler recomputes both new + old day cells.
  await recomputeDailySummary(userId, metricTypeId, `${dayB}T08:00:00.000Z`);
  await recomputeDailySummary(userId, metricTypeId, oldRecordedAt);

  cell = await fetchCell(userId, metricTypeId, dayA);
  assert(cell!.count === 1, `dayA after cross-day move: count=1 (got ${cell!.count})`);
  assert(cell!.avgValue === 50, `dayA after cross-day move: avg=50 (got ${cell!.avgValue})`);

  cell = await fetchCell(userId, metricTypeId, dayB);
  assert(cell !== null, "dayB cell created");
  assert(cell!.count === 1, `dayB after cross-day move: count=1 (got ${cell!.count})`);
  assert(cell!.avgValue === 30, `dayB after cross-day move: avg=30 (got ${cell!.avgValue})`);

  // ---- 4. Delete the last row of dayB; recompute should sweep the cell. ----
  await db.delete(metrics).where(and(eq(metrics.userId, userId), eq(metrics.sourceId, `${TEST_TAG}-2`)));
  await recomputeDailySummary(userId, metricTypeId, `${dayB}T08:00:00.000Z`);

  cell = await fetchCell(userId, metricTypeId, dayB);
  assert(cell === null, "dayB cell swept after last row deleted");

  // dayA's row still untouched.
  cell = await fetchCell(userId, metricTypeId, dayA);
  assert(cell !== null, "dayA cell survives unrelated delete");
  assert(cell!.count === 1, `dayA still count=1 after dayB delete (got ${cell!.count})`);

  // ---- 5. Delete the very last row; cell sweep on the last surviving day. ----
  await db.delete(metrics).where(and(eq(metrics.userId, userId), eq(metrics.sourceId, `${TEST_TAG}-1`)));
  await recomputeDailySummary(userId, metricTypeId, `${dayA}T08:00:00.000Z`);

  cell = await fetchCell(userId, metricTypeId, dayA);
  assert(cell === null, "dayA cell swept after final row deleted");

  // ---- Cleanup ----
  await db
    .delete(metricTypes)
    .where(and(eq(metricTypes.userId, userId), eq(metricTypes.id, metricTypeId)));

  console.log("\nAll daily_summaries assertions passed.");
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
