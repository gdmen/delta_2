import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, and } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/test-utils/in-memory-db";
import { metricTypes, metrics, dailySummaries } from "@/db/schema";
import {
  upsertMetric,
  bulkImportStorage,
  flushBulkImportRecomputes,
  type BulkImportContext,
} from "./ingest-service";

/**
 * Coverage for the ingest choke point: every ingest path
 * (CSV import, Apple Health, BodySpec, Strava) calls `upsertMetric`,
 * so verifying that this function persists the `alias` field is enough
 * to prove the chain-undo invariant. The TypeScript signature on
 * `MetricInput` enforces all callers supply the alias at compile time.
 */

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let db: TestDb;

beforeEach(async () => {
  testDb = await createTestDb();
  await testDb.clearSeedData();
  db = testDb.db;
});

afterEach(async () => {
  await testDb.pg.close();
});

describe("upsertMetric persists alias", () => {
  it("I1: alias passed in is stored on the inserted row", async () => {
    const inserted = await db
      .insert(metricTypes)
      .values({ name: "weight", unit: "lb", frequencyHint: "daily" })
      .returning({ id: metricTypes.id });

    await upsertMetric(
      {
        userId: 1,
        metricTypeId: inserted[0].id,
        value: 70,
        recordedAt: "2026-01-01T00:00:00Z",
        source: "fitnotes_bt",
        sourceId: "bt-1",
        alias: "fitnotes_bt:weight",
      },
      db,
    );

    const rows = await db
      .select()
      .from(metrics)
      .where(eq(metrics.metricTypeId, inserted[0].id));
    expect(rows).toHaveLength(1);
    expect(rows[0].alias).toBe("fitnotes_bt:weight");
  });
});

describe("bulkImportStorage defers daily_summaries recompute", () => {
  it("D1: outside the bulk context, recompute fires per row (eager)", async () => {
    const mt = await db
      .insert(metricTypes)
      .values({ name: "sleep", unit: "h", frequencyHint: "daily" })
      .returning({ id: metricTypes.id });

    // Three rows on the same day. Each upsertMetric should keep the
    // summary cell consistent because no bulk context is active.
    for (let i = 0; i < 3; i++) {
      await upsertMetric(
        {
          userId: 1,
          metricTypeId: mt[0].id,
          value: 7 + i,
          recordedAt: `2026-01-01T0${i}:00:00Z`,
          source: "manual",
          sourceId: `eager-${i}`,
          alias: null,
        },
        db,
      );
    }

    const summary = await db
      .select()
      .from(dailySummaries)
      .where(
        and(
          eq(dailySummaries.metricTypeId, mt[0].id),
          eq(dailySummaries.date, "2026-01-01"),
        ),
      );
    expect(summary).toHaveLength(1);
    expect(summary[0].count).toBe(3);
    expect(summary[0].avgValue).toBe(8); // (7+8+9)/3
  });

  it("D2: inside the bulk context, summaries are NOT touched until flush", async () => {
    const mt = await db
      .insert(metricTypes)
      .values({ name: "weight", unit: "lb", frequencyHint: "daily" })
      .returning({ id: metricTypes.id });

    const ctx: BulkImportContext = { touchedBuckets: new Set() };
    await bulkImportStorage.run(ctx, async () => {
      for (let i = 0; i < 5; i++) {
        await upsertMetric(
          {
            userId: 1,
            metricTypeId: mt[0].id,
            value: 70 + i,
            recordedAt: `2026-02-0${i + 1}T08:00:00Z`,
            source: "manual",
            sourceId: `bulk-${i}`,
            alias: null,
          },
          db,
        );
      }
    });

    // Before flush: no summary rows written; touched-bucket set has 5 entries
    // (one per distinct date).
    const beforeFlush = await db.select().from(dailySummaries);
    expect(beforeFlush).toHaveLength(0);
    expect(ctx.touchedBuckets.size).toBe(5);

    await flushBulkImportRecomputes(1, ctx, db);

    const afterFlush = await db
      .select()
      .from(dailySummaries)
      .where(eq(dailySummaries.metricTypeId, mt[0].id));
    expect(afterFlush).toHaveLength(5);
    // Spot check: each cell has count=1, value matches its row.
    const byDate = new Map(afterFlush.map((r) => [r.date, r]));
    expect(byDate.get("2026-02-01")?.count).toBe(1);
    expect(byDate.get("2026-02-01")?.avgValue).toBe(70);
    expect(byDate.get("2026-02-05")?.avgValue).toBe(74);
  });

  it("D3: same-bucket rows collapse to one entry in touchedBuckets", async () => {
    const mt = await db
      .insert(metricTypes)
      .values({ name: "calories", unit: "kcal", frequencyHint: "daily" })
      .returning({ id: metricTypes.id });

    const ctx: BulkImportContext = { touchedBuckets: new Set() };
    await bulkImportStorage.run(ctx, async () => {
      // Many rows on the SAME day. Touched-bucket set should hold ONE
      // entry — that's the whole point of deferral, vs. live ingest's
      // N redundant recomputes for N same-day rows.
      for (let i = 0; i < 6; i++) {
        await upsertMetric(
          {
            userId: 1,
            metricTypeId: mt[0].id,
            value: 2000 + i,
            recordedAt: `2026-03-15T0${i}:00:00Z`,
            source: "manual",
            sourceId: `dense-${i}`,
            alias: null,
          },
          db,
        );
      }
    });

    expect(ctx.touchedBuckets.size).toBe(1);

    await flushBulkImportRecomputes(1, ctx, db);

    const summary = await db
      .select()
      .from(dailySummaries)
      .where(
        and(
          eq(dailySummaries.metricTypeId, mt[0].id),
          eq(dailySummaries.date, "2026-03-15"),
        ),
      );
    expect(summary).toHaveLength(1);
    expect(summary[0].count).toBe(6);
  });
});
