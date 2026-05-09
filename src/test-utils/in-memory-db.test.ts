import { describe, expect, it } from "vitest";
import { createTestDb } from "./in-memory-db";
import { metricTypes } from "@/db/schema";

describe("createTestDb", () => {
  it("applies all migrations and lets a basic insert/select round-trip", async () => {
    const { db, pg } = await createTestDb();
    await db
      .insert(metricTypes)
      .values({ name: "test_unique_x9", unit: "kg", frequencyHint: "daily" });
    const rows = (await db.select().from(metricTypes)).filter(
      (r) => r.name === "test_unique_x9",
    );
    expect(rows).toHaveLength(1);
    await pg.close();
  });

  it("creates fresh, isolated DBs across calls", async () => {
    const a = await createTestDb();
    const b = await createTestDb();
    await a.db.insert(metricTypes).values({ name: "isolation_probe_a", unit: "" });
    const inB = (await b.db.select().from(metricTypes)).filter(
      (r) => r.name === "isolation_probe_a",
    );
    expect(inB).toHaveLength(0);
    await a.pg.close();
    await b.pg.close();
  });
});
