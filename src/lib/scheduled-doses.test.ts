import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/test-utils/in-memory-db";
import {
  users,
  metricTypes,
  metrics,
  metricScheduleSkips,
} from "@/db/schema";
import {
  ensureScheduledDoses,
  backfillScheduledDoses,
  insertScheduledDoseIfMissing,
  _resetEnsuredCache,
  MAX_BACKFILL_DAYS,
} from "./scheduled-doses";

/**
 * Coverage for the scheduled-doses materializer + backfill loop
 * (issue #30). The lazy materializer + skip-on-delete + backfill
 * together are the core of the medication-tracking feature; these
 * tests pin every edge case from the spec's verification section.
 *
 * UTC is the test session's TZ (pglite default), so "today local" ==
 * "today UTC" here. The materializer reads timezone from
 * app_settings; with no row, loadUserTimezone falls back to the
 * runtime default. Test cases pin `now` explicitly to make
 * date-arithmetic reproducible across runs.
 */

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let db: TestDb;

const USER_ID = 42;

// Fixed clock so "today" is deterministic across CI runs.
const TEST_NOW = new Date("2026-05-21T18:00:00.000Z");

beforeAll(async () => {
  testDb = await createTestDb();
  db = testDb.db;
});

afterAll(async () => {
  await testDb.pg.close();
});

beforeEach(async () => {
  await testDb.clearSeedData();
  // Cache is module-level; reset between cases or the second call
  // sees the previous test's user.
  _resetEnsuredCache();
  await db.insert(users).values({ id: USER_ID, displayName: "u" }).onConflictDoNothing();
});

async function makeScheduledType(name: string, dose: number | null = 180): Promise<number> {
  const [row] = await db
    .insert(metricTypes)
    .values({
      userId: USER_ID,
      name,
      unit: "mg",
      frequencyHint: "occasional",
      autoLogDose: dose,
    })
    .returning({ id: metricTypes.id });
  return row.id;
}

describe("ensureScheduledDoses — daily materializer (#30)", () => {
  it("S1: stamps one row per active schedule on first call of the day", async () => {
    const typeId = await makeScheduledType("medication:fexofenadine_hcl", 180);

    const out = await ensureScheduledDoses(USER_ID, db, TEST_NOW);

    expect(out.inserted).toBe(1);
    expect(out.checked).toBe(1);

    const rows = await db
      .select()
      .from(metrics)
      .where(and(eq(metrics.userId, USER_ID), eq(metrics.metricTypeId, typeId)));
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(180);
    expect(rows[0].source).toBe("scheduled");
    expect(rows[0].sourceId).toBe(`schedule:${typeId}:2026-05-21`);
  });

  it("S2: second call same day is a cache hit — no DB work", async () => {
    await makeScheduledType("medication:melatonin", 5);
    const first = await ensureScheduledDoses(USER_ID, db, TEST_NOW);
    expect(first.inserted).toBe(1);

    const second = await ensureScheduledDoses(USER_ID, db, TEST_NOW);
    expect(second.inserted).toBe(0);
    expect(second.checked).toBe(0); // cache short-circuit before SELECT
  });

  it("S3: cache miss next day re-SELECTs but doesn't double-insert", async () => {
    await makeScheduledType("medication:melatonin", 5);
    await ensureScheduledDoses(USER_ID, db, TEST_NOW);

    _resetEnsuredCache();
    const nextDay = new Date("2026-05-22T18:00:00.000Z");
    const out = await ensureScheduledDoses(USER_ID, db, nextDay);

    expect(out.checked).toBe(1); // SELECT ran
    expect(out.inserted).toBe(1); // tomorrow's row IS new

    const rows = await db.select().from(metrics).where(eq(metrics.userId, USER_ID));
    expect(rows).toHaveLength(2);
  });

  it("S4: skip-table tombstone prevents re-creation of deleted day", async () => {
    const typeId = await makeScheduledType("medication:fexofenadine_hcl", 180);
    await ensureScheduledDoses(USER_ID, db, TEST_NOW);

    // User deletes the row (the DELETE route writes the skip; here
    // we simulate that by writing the skip + deleting the row directly).
    await db
      .delete(metrics)
      .where(and(eq(metrics.userId, USER_ID), eq(metrics.metricTypeId, typeId)));
    await db.insert(metricScheduleSkips).values({
      metricTypeId: typeId,
      skippedDate: "2026-05-21",
    });

    // Force cache miss to re-run materializer.
    _resetEnsuredCache();
    const out = await ensureScheduledDoses(USER_ID, db, TEST_NOW);

    expect(out.inserted).toBe(0); // skip blocked the insert
    const rows = await db
      .select()
      .from(metrics)
      .where(and(eq(metrics.userId, USER_ID), eq(metrics.metricTypeId, typeId)));
    expect(rows).toHaveLength(0); // still gone
  });

  it("S5: clearing autoLogDose=null stops new rows", async () => {
    const typeId = await makeScheduledType("medication:fexofenadine_hcl", 180);
    await ensureScheduledDoses(USER_ID, db, TEST_NOW);

    // User clears the schedule.
    await db
      .update(metricTypes)
      .set({ autoLogDose: null })
      .where(eq(metricTypes.id, typeId));

    _resetEnsuredCache();
    const nextDay = new Date("2026-05-22T18:00:00.000Z");
    const out = await ensureScheduledDoses(USER_ID, db, nextDay);

    expect(out.checked).toBe(0); // filtered out — no rows with auto_log_dose IS NOT NULL
    expect(out.inserted).toBe(0);
    // The previously-stamped row for May 21 stays — it represents
    // what was actually scheduled at that time.
    const rows = await db
      .select()
      .from(metrics)
      .where(eq(metrics.userId, USER_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceId).toBe(`schedule:${typeId}:2026-05-21`);
  });

  it("S6: concurrent race — second insert collides on unique index", async () => {
    const typeId = await makeScheduledType("medication:fexofenadine_hcl", 180);

    // Two simultaneous insert attempts via the same helper. Both see
    // no row in the skip table; both attempt the INSERT. The unique
    // (user_id, source_id) index ensures only one wins.
    const [a, b] = await Promise.all([
      insertScheduledDoseIfMissing(USER_ID, typeId, 180, "2026-05-21", "UTC", db),
      insertScheduledDoseIfMissing(USER_ID, typeId, 180, "2026-05-21", "UTC", db),
    ]);

    const insertedCount = (a.inserted ? 1 : 0) + (b.inserted ? 1 : 0);
    expect(insertedCount).toBe(1);

    const rows = await db
      .select()
      .from(metrics)
      .where(and(eq(metrics.userId, USER_ID), eq(metrics.metricTypeId, typeId)));
    expect(rows).toHaveLength(1);
  });

  it("S7: no active schedules — no inserts, no errors", async () => {
    // Make a non-scheduled type — auto_log_dose stays NULL.
    await db
      .insert(metricTypes)
      .values({
        userId: USER_ID,
        name: "bodyspec_dexa:lean_mass",
        unit: "lb",
        frequencyHint: "occasional",
      });

    const out = await ensureScheduledDoses(USER_ID, db, TEST_NOW);
    expect(out.checked).toBe(0);
    expect(out.inserted).toBe(0);
  });
});

describe("backfillScheduledDoses — one-shot historical fill (#30)", () => {
  it("S8: backfill since 16 days ago creates 16 rows", async () => {
    const typeId = await makeScheduledType("medication:fexofenadine_hcl", 180);

    const out = await backfillScheduledDoses(
      USER_ID,
      typeId,
      180,
      "2026-05-06",
      db,
      TEST_NOW,
    );

    expect(out.days).toBe(16); // May 6 through May 21 inclusive
    expect(out.inserted).toBe(16);

    const rows = await db
      .select({ sourceId: metrics.sourceId })
      .from(metrics)
      .where(and(eq(metrics.userId, USER_ID), eq(metrics.metricTypeId, typeId)));
    expect(rows).toHaveLength(16);
    const ids = rows.map((r) => r.sourceId).sort();
    expect(ids[0]).toBe(`schedule:${typeId}:2026-05-06`);
    expect(ids[15]).toBe(`schedule:${typeId}:2026-05-21`);
  });

  it("S9: idempotent — re-running with same `since` inserts 0 new rows", async () => {
    const typeId = await makeScheduledType("medication:fexofenadine_hcl", 180);

    await backfillScheduledDoses(USER_ID, typeId, 180, "2026-05-06", db, TEST_NOW);
    const second = await backfillScheduledDoses(
      USER_ID,
      typeId,
      180,
      "2026-05-06",
      db,
      TEST_NOW,
    );

    expect(second.days).toBe(16);
    expect(second.inserted).toBe(0);
    const rows = await db
      .select()
      .from(metrics)
      .where(eq(metrics.userId, USER_ID));
    expect(rows).toHaveLength(16);
  });

  it("S10: skip-during-backfill — tombstoned day stays out", async () => {
    const typeId = await makeScheduledType("medication:fexofenadine_hcl", 180);
    await db.insert(metricScheduleSkips).values({
      metricTypeId: typeId,
      skippedDate: "2026-05-10",
    });

    const out = await backfillScheduledDoses(
      USER_ID,
      typeId,
      180,
      "2026-05-06",
      db,
      TEST_NOW,
    );

    expect(out.days).toBe(16);
    expect(out.inserted).toBe(15); // May 10 blocked by skip
    const may10 = await db
      .select()
      .from(metrics)
      .where(eq(metrics.sourceId, `schedule:${typeId}:2026-05-10`));
    expect(may10).toHaveLength(0);
  });

  it("S11: rejects ranges over the cap with a clear error", async () => {
    const typeId = await makeScheduledType("medication:fexofenadine_hcl", 180);

    const sinceTooFar = "2024-01-01"; // ~870 days back from TEST_NOW
    await expect(
      backfillScheduledDoses(USER_ID, typeId, 180, sinceTooFar, db, TEST_NOW),
    ).rejects.toThrow(/exceeds cap of /);

    // No rows inserted.
    const rows = await db
      .select()
      .from(metrics)
      .where(eq(metrics.userId, USER_ID));
    expect(rows).toHaveLength(0);
  });

  it("S12: since=today inserts one row only (today)", async () => {
    const typeId = await makeScheduledType("medication:fexofenadine_hcl", 180);

    const out = await backfillScheduledDoses(
      USER_ID,
      typeId,
      180,
      "2026-05-21",
      db,
      TEST_NOW,
    );

    expect(out.days).toBe(1);
    expect(out.inserted).toBe(1);
  });

  it("S13: backfill cap constant is sane", () => {
    // Sanity guard so the cap doesn't silently regress to something
    // pathological. 365 days minimum — anything less and "I started
    // a year ago" stops working.
    expect(MAX_BACKFILL_DAYS).toBeGreaterThanOrEqual(365);
  });
});

describe("ensureScheduledDoses + manual dose interaction (#30)", () => {
  it("S14: existing same-day manual row blocks scheduled insert via unique index", async () => {
    const typeId = await makeScheduledType("medication:fexofenadine_hcl", 180);

    // User logged a manual dose earlier today with the SAME source_id
    // (unlikely in practice but the unique index is what we're testing).
    await db.insert(metrics).values({
      userId: USER_ID,
      metricTypeId: typeId,
      value: 90, // half dose, manually logged
      recordedAt: "2026-05-21T08:00:00.000Z",
      source: "manual",
      sourceId: `schedule:${typeId}:2026-05-21`, // collide on purpose
    });

    const out = await ensureScheduledDoses(USER_ID, db, TEST_NOW);

    expect(out.inserted).toBe(0); // ON CONFLICT DO NOTHING
    const rows = await db
      .select()
      .from(metrics)
      .where(and(eq(metrics.userId, USER_ID), eq(metrics.metricTypeId, typeId)));
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(90); // manual row preserved
  });

  it("S15: differently-source-id'd manual row coexists with scheduled row", async () => {
    const typeId = await makeScheduledType("medication:fexofenadine_hcl", 180);

    // User manually logged a dose with a DIFFERENT source_id.
    // Materializer adds today's auto-row alongside it.
    await db.insert(metrics).values({
      userId: USER_ID,
      metricTypeId: typeId,
      value: 90,
      recordedAt: "2026-05-21T08:00:00.000Z",
      source: "manual",
      sourceId: "manual:2026-05-21:morning",
    });

    const out = await ensureScheduledDoses(USER_ID, db, TEST_NOW);

    expect(out.inserted).toBe(1);
    const rows = await db
      .select()
      .from(metrics)
      .where(and(eq(metrics.userId, USER_ID), eq(metrics.metricTypeId, typeId)));
    expect(rows).toHaveLength(2);
  });
});
