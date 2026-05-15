import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/test-utils/in-memory-db";
import { appSettings, users } from "@/db/schema";

/**
 * Coverage for the isoTimestamptz custom column type (issue #25 POC).
 *
 * The wrapper has one job: regardless of what the driver hands back
 * (Date from postgres-js, string from pglite), reads return a
 * `new Date().toISOString()`-shaped string. These tests run against
 * pglite — they're the test-side half of the driver-parity claim.
 * postgres-js parity is verified separately via a live-DB script.
 */

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let db: TestDb;

beforeEach(async () => {
  testDb = await createTestDb();
  await testDb.clearSeedData();
  db = testDb.db;
  // appSettings has a FK to users; seed via drizzle so the $defaultFn
  // for users.createdAt fires.
  await db.insert(users).values({ id: 1, displayName: "test" }).onConflictDoNothing();
});

afterEach(async () => {
  await testDb.pg.close();
});

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe("isoTimestamptz wrapper format contract", () => {
  it("T1: $defaultFn(isoNow) on insert produces canonical ISO on read", async () => {
    await db.insert(appSettings).values({ userId: 1, timezone: null });
    const [row] = await db
      .select({ updatedAt: appSettings.updatedAt })
      .from(appSettings)
      .where(eq(appSettings.userId, 1))
      .limit(1);
    expect(row.updatedAt).toMatch(ISO_RE);
  });

  it("T2: explicit ISO string write round-trips byte-identical", async () => {
    const written = "2026-05-14T12:34:56.789Z";
    await db.insert(appSettings).values({
      userId: 1,
      timezone: null,
      updatedAt: written,
    });
    const [row] = await db
      .select({ updatedAt: appSettings.updatedAt })
      .from(appSettings)
      .where(eq(appSettings.userId, 1))
      .limit(1);
    expect(row.updatedAt).toBe(written);
  });

  it("T3: mixed-offset write normalizes to UTC Z on read", async () => {
    // Strava-style write with explicit offset. Postgres stores the
    // canonical UTC point-in-time; the wrapper reads it back as `Z`.
    const written = "2026-05-14T05:00:00.000-07:00"; // = 12:00:00Z
    await db.insert(appSettings).values({
      userId: 1,
      timezone: null,
      updatedAt: written,
    });
    const [row] = await db
      .select({ updatedAt: appSettings.updatedAt })
      .from(appSettings)
      .where(eq(appSettings.userId, 1))
      .limit(1);
    expect(row.updatedAt).toBe("2026-05-14T12:00:00.000Z");
  });

  it("T4: write without fractional seconds reads back as .000Z", async () => {
    // Strava timestamps frequently lack fractional seconds. The wrapper
    // normalizes to 3-digit ms — the canonical `new Date().toISOString()`
    // form — so the rest of the codebase sees one consistent shape.
    const written = "2026-05-14T12:00:00Z";
    await db.insert(appSettings).values({
      userId: 1,
      timezone: null,
      updatedAt: written,
    });
    const [row] = await db
      .select({ updatedAt: appSettings.updatedAt })
      .from(appSettings)
      .where(eq(appSettings.userId, 1))
      .limit(1);
    expect(row.updatedAt).toBe("2026-05-14T12:00:00.000Z");
  });

  it("T5: equality compare against ISO string works (timestamptz auto-cast)", async () => {
    const ts = "2026-05-14T12:00:00.000Z";
    await db.insert(appSettings).values({ userId: 1, timezone: null, updatedAt: ts });
    const found = await db
      .select({ userId: appSettings.userId })
      .from(appSettings)
      .where(eq(appSettings.updatedAt, ts))
      .limit(1);
    expect(found).toHaveLength(1);
  });
});
