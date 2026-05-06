import { describe, expect, it } from "vitest";
import { createTestDb } from "./in-memory-db";
import { metricTypes } from "@/db/schema";

describe("createTestDb", () => {
  it("applies all migrations and lets a basic insert/select round-trip", () => {
    const { db, sqlite } = createTestDb();
    db.insert(metricTypes)
      .values({ name: "test_unique_x9", unit: "kg", frequencyHint: "daily" })
      .run();
    const rows = db
      .select()
      .from(metricTypes)
      .all()
      .filter((r) => r.name === "test_unique_x9");
    expect(rows).toHaveLength(1);
    sqlite.close();
  });

  it("creates fresh, isolated DBs across calls", () => {
    const a = createTestDb();
    const b = createTestDb();
    a.db.insert(metricTypes).values({ name: "isolation_probe_a", unit: "" }).run();
    const inB = b.db
      .select()
      .from(metricTypes)
      .all()
      .filter((r) => r.name === "isolation_probe_a");
    expect(inB).toHaveLength(0);
    a.sqlite.close();
    b.sqlite.close();
  });
});
