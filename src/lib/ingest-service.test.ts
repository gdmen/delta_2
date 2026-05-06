import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/test-utils/in-memory-db";
import { metricTypes, metrics } from "@/db/schema";
import { upsertMetric } from "./ingest-service";

/**
 * Coverage for the ingest choke point: every ingest path
 * (CSV import, Apple Health, BodySpec, Strava) calls `upsertMetric`,
 * so verifying that this function persists the `alias` field is enough
 * to prove the chain-undo invariant. The TypeScript signature on
 * `MetricInput` enforces all callers supply the alias at compile time.
 */

let testDb: ReturnType<typeof createTestDb>;
let db: TestDb;

beforeEach(() => {
  testDb = createTestDb();
  testDb.clearSeedData();
  db = testDb.db;
});

afterEach(() => {
  testDb.sqlite.close();
});

describe("upsertMetric persists alias", () => {
  it("I1: alias passed in is stored on the inserted row", async () => {
    const inserted = db
      .insert(metricTypes)
      .values({ name: "weight", unit: "lb", frequencyHint: "daily" })
      .returning({ id: metricTypes.id })
      .all();

    await upsertMetric(
      {
        metricTypeId: inserted[0].id,
        value: 70,
        recordedAt: "2026-01-01T00:00:00Z",
        source: "fitnotes_bt",
        sourceId: "bt-1",
        alias: "fitnotes_bt:weight",
      },
      db,
    );

    const rows = db
      .select()
      .from(metrics)
      .where(eq(metrics.metricTypeId, inserted[0].id))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0].alias).toBe("fitnotes_bt:weight");
  });
});
