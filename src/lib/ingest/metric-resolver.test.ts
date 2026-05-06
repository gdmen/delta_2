import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/test-utils/in-memory-db";
import { metricTypes, metricTypeAliases } from "@/db/schema";
import {
  buildMetricTypeCache,
  resolveMetricTypeId,
} from "./metric-resolver";

/**
 * Resolver returns the alias key it matched on (or the auto-created
 * name) so undo can chain-unwind by alias. Verified across all 4
 * resolution paths.
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

describe("resolveMetricTypeId — alias-aware return", () => {
  it("R1: hardcoded map hit → alias is the canonical name from the map", async () => {
    db.insert(metricTypes)
      .values({ name: "weight_canonical", unit: "lb", frequencyHint: "daily" })
      .run();
    const cache = await buildMetricTypeCache(db);
    const result = await resolveMetricTypeId(
      {
        rawName: "Weight",
        map: { Weight: "weight_canonical" },
        sourceSystem: "fitnotes_bw",
        cache,
      },
      db,
    );
    expect(result.alias).toBe("weight_canonical");
  });

  it("R2a: alias-table hit on raw name → alias is the raw name", async () => {
    const inserted = db
      .insert(metricTypes)
      .values({ name: "bodyweight", unit: "lb", frequencyHint: "daily" })
      .returning({ id: metricTypes.id })
      .all();
    db.insert(metricTypeAliases)
      .values({ alias: "weight", canonicalMetricTypeId: inserted[0].id })
      .run();
    const cache = await buildMetricTypeCache(db);
    const result = await resolveMetricTypeId(
      {
        rawName: "weight",
        map: {},
        sourceSystem: "fitnotes_bw",
        cache,
      },
      db,
    );
    expect(result.alias).toBe("weight");
  });

  it("R2b: alias-table hit on `${source}:${rawName}` → alias is the prefixed form", async () => {
    const inserted = db
      .insert(metricTypes)
      .values({ name: "bodyweight", unit: "lb", frequencyHint: "daily" })
      .returning({ id: metricTypes.id })
      .all();
    db.insert(metricTypeAliases)
      .values({
        alias: "fitnotes_bt:weight",
        canonicalMetricTypeId: inserted[0].id,
      })
      .run();
    const cache = await buildMetricTypeCache(db);
    const result = await resolveMetricTypeId(
      {
        rawName: "weight",
        map: {},
        sourceSystem: "fitnotes_bt",
        cache,
      },
      db,
    );
    expect(result.alias).toBe("fitnotes_bt:weight");
  });

  it("R3: map points to unseeded canonical → alias is the canonical name", async () => {
    const cache = await buildMetricTypeCache(db);
    const result = await resolveMetricTypeId(
      {
        rawName: "Weight",
        map: { Weight: "fresh_canonical" },
        sourceSystem: "fitnotes_bw",
        cache,
      },
      db,
    );
    expect(result.alias).toBe("fresh_canonical");
    const rows = db
      .select()
      .from(metricTypes)
      .all()
      .filter((r) => r.name === "fresh_canonical");
    expect(rows).toHaveLength(1);
  });

  it("R4: unknown → alias is `${source}:${rawName}`", async () => {
    const cache = await buildMetricTypeCache(db);
    const result = await resolveMetricTypeId(
      {
        rawName: "weight",
        map: {},
        sourceSystem: "fitnotes_bt",
        cache,
      },
      db,
    );
    expect(result.alias).toBe("fitnotes_bt:weight");
  });
});
