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

describe("resolveMetricTypeId — alias-aware return", () => {
  it("R1: hardcoded map hit → alias is the canonical name from the map", async () => {
    await db
      .insert(metricTypes)
      .values({ name: "weight_canonical", unit: "lb", frequencyHint: "daily" });
    const cache = await buildMetricTypeCache(1, db);
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
    const inserted = await db
      .insert(metricTypes)
      .values({ name: "bodyweight", unit: "lb", frequencyHint: "daily" })
      .returning({ id: metricTypes.id });
    await db
      .insert(metricTypeAliases)
      .values({ alias: "weight", canonicalMetricTypeId: inserted[0].id });
    const cache = await buildMetricTypeCache(1, db);
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
    const inserted = await db
      .insert(metricTypes)
      .values({ name: "bodyweight", unit: "lb", frequencyHint: "daily" })
      .returning({ id: metricTypes.id });
    await db
      .insert(metricTypeAliases)
      .values({
        alias: "fitnotes_bt:weight",
        canonicalMetricTypeId: inserted[0].id,
      });
    const cache = await buildMetricTypeCache(1, db);
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
    const cache = await buildMetricTypeCache(1, db);
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
    const rows = (await db.select().from(metricTypes)).filter(
      (r) => r.name === "fresh_canonical",
    );
    expect(rows).toHaveLength(1);
  });

  it("R4: unknown → alias is `${source}:${rawName}`", async () => {
    const cache = await buildMetricTypeCache(1, db);
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

  it("R4 with empty map: shadowing canonical does NOT auto-route — orphan wins", async () => {
    // A canonical "weight" exists. With CSV's old identity-map behavior,
    // a "weight" column would have routed there. Without the map (the
    // policy this commit standardizes on), it auto-creates a
    // `${source}:weight` orphan instead — user merges explicitly.
    await db
      .insert(metricTypes)
      .values({ name: "weight", unit: "lb", frequencyHint: "daily" });
    const cache = await buildMetricTypeCache(1, db);
    const result = await resolveMetricTypeId(
      {
        rawName: "weight",
        map: {},
        sourceSystem: "sleepbotv2",
        cache,
      },
      db,
    );
    expect(result.alias).toBe("sleepbotv2:weight");
    // The new orphan exists and is distinct from the pre-existing
    // canonical "weight".
    const types = await db.select().from(metricTypes);
    expect(types.find((t) => t.name === "weight")?.id).not.toBe(result.id);
    expect(types.find((t) => t.name === "sleepbotv2:weight")?.id).toBe(result.id);
  });
});
