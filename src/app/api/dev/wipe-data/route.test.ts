import { describe, expect, it, vi } from "vitest";
import { buildDbMock, setupRouteTest } from "@/test-utils/route-test";

// MUST be before any other imports — vi.mock is hoisted but the helper
// it points to has to be importable at hoist time.
vi.mock("@/db", () => buildDbMock());

import { POST } from "./route";
import {
  activities,
  metricTypes,
  metrics,
  events,
  workoutSets,
} from "@/db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * Regression coverage for two real bugs in the dev wipe endpoint:
 *
 *   - W1 / W2: an earlier port iteration looped per-table TRUNCATE with
 *     CASCADE. Postgres detected a deadlock because each statement
 *     acquired AccessExclusive locks on dependent tables in different
 *     orders across iterations. Fix: a single TRUNCATE statement listing
 *     every table at once acquires all locks atomically. These tests
 *     exercise the wiped-state assertion + the rapid-second-call path
 *     that originally surfaced the deadlock under load.
 *
 *   - W3: identity sequences must restart at 1 after a wipe so
 *     re-imports land with their original ids without collision. Catches
 *     a regression to plain `DELETE` (which doesn't reset sequences).
 *
 * Production-mode guard (W4) is a separate path — `NODE_ENV=production`
 * makes the route return 404. Covered with a vi.stubEnv block.
 */
describe("POST /api/dev/wipe-data", () => {
  const ctx = setupRouteTest();

  it("W1: wipes a populated DB end-to-end without a deadlock", async () => {
    const db = ctx.getDb();
    // Seed enough cross-table data that CASCADE has work to do.
    const [s] = await db
      .insert(activities)
      .values({ name: "wipe-test", color: "#abcdef" })
      .returning({ id: activities.id });
    const [mt] = await db
      .insert(metricTypes)
      .values({ name: "wipe-test-metric", unit: "kg", activityId: s.id })
      .returning({ id: metricTypes.id });
    await db.insert(metrics).values({
      metricTypeId: mt.id,
      value: 100,
      recordedAt: "2026-05-08T12:00:00.000Z",
      source: "test",
    });
    const [ev] = await db
      .insert(events)
      .values({
        activityId: s.id,
        type: "workout",
        startedAt: "2026-05-08T12:00:00.000Z",
      })
      .returning({ id: events.id });
    await db.insert(workoutSets).values({
      eventId: ev.id,
      exerciseMetricTypeId: mt.id,
      setNumber: 1,
      reps: 5,
      weight: 100,
    });

    const res = await POST();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; deletedCounts: Record<string, number> };
    expect(body.ok).toBe(true);
    expect(body.deletedCounts.activities).toBe(1);
    expect(body.deletedCounts.metric_types).toBe(1);
    expect(body.deletedCounts.metrics).toBe(1);
    expect(body.deletedCounts.events).toBe(1);
    expect(body.deletedCounts.workout_sets).toBe(1);

    // Tables actually empty after the call.
    expect(await db.select().from(activities)).toHaveLength(0);
    expect(await db.select().from(metricTypes)).toHaveLength(0);
    expect(await db.select().from(metrics)).toHaveLength(0);
    expect(await db.select().from(events)).toHaveLength(0);
    expect(await db.select().from(workoutSets)).toHaveLength(0);
  });

  it("W2: handles back-to-back wipes (idempotent, no deadlock on second call)", async () => {
    const db = ctx.getDb();
    // First wipe runs against an empty DB — should still 200 OK with
    // zero deletedCounts and not throw.
    const res1 = await POST();
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as { ok: boolean; deletedCounts: Record<string, number> };
    expect(body1.ok).toBe(true);
    expect(body1.deletedCounts.activities).toBe(0);

    // Insert a row, then immediately wipe again. This is the call pattern
    // that originally surfaced the deadlock when wipes were per-table.
    await db.insert(activities).values({ name: "second-wipe", color: "#111111" });
    const res2 = await POST();
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { ok: boolean; deletedCounts: Record<string, number> };
    expect(body2.ok).toBe(true);
    expect(body2.deletedCounts.activities).toBe(1);
    expect(await db.select().from(activities)).toHaveLength(0);
  });

  it("W3: resets identity sequences so re-imported ids start at 1", async () => {
    const db = ctx.getDb();
    // Burn the first three activity ids.
    await db.insert(activities).values({ name: "a", color: "#111" });
    await db.insert(activities).values({ name: "b", color: "#222" });
    await db.insert(activities).values({ name: "c", color: "#333" });
    const before = await db.select().from(activities);
    const maxIdBefore = Math.max(...before.map((r) => r.id));
    expect(maxIdBefore).toBeGreaterThanOrEqual(3);

    await POST();

    // Insert a new row — its id should be 1, not maxIdBefore + 1.
    const [fresh] = await db
      .insert(activities)
      .values({ name: "post-wipe", color: "#444" })
      .returning({ id: activities.id });
    expect(fresh.id).toBe(1);
  });

  it("W4: returns 404 in production mode (route is dev-only)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const res = await POST();
      expect(res.status).toBe(404);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("W5: regression — single TRUNCATE statement, not per-table loop", async () => {
    // Read the route source to confirm the bug class can't reappear.
    // A per-table loop with CASCADE deadlocks under contention; the file
    // must contain `TRUNCATE TABLE ${tableList}` (single statement) and
    // must NOT contain a loop variable named `tableName` driving
    // individual TRUNCATE calls.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/dev/wipe-data/route.ts"),
      "utf-8",
    );
    expect(src).toMatch(/TRUNCATE TABLE \$\{tableList\}/);
    // The previous-iteration shape was `TRUNCATE TABLE ${tableName} RESTART IDENTITY CASCADE`
    // inside a `for (const t of tables)` loop. Reject any reappearance.
    expect(src).not.toMatch(/TRUNCATE TABLE \$\{tableName\} RESTART IDENTITY CASCADE/);
  });
});

// Reference an unused import just to keep the imports stable across
// future schema changes that add tables — the test should keep passing
// as long as the same schema objects exist.
void eq;
void sql;
