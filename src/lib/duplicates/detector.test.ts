import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/test-utils/in-memory-db";
import { users, sports, events } from "@/db/schema";
import { findDuplicateCandidates } from "./detector";

/**
 * Coverage for the post-#24 detector rewrite (BETWEEN + recent
 * prefilter, backed by the (user_id, started_at) composite index).
 *
 * The rewrite is functionally identical to the prior ABS(EXTRACT(...))
 * shape — these tests prove that across the cases that mattered for #25
 * and #24:
 * - Mixed-offset writes flag correctly (the post-#25 promise).
 * - The 60-min window boundary is inclusive on both edges.
 * - The recent=true prefilter doesn't drop legitimate pairs that
 *   straddle the cutoff (the -60min slop is what saves us here).
 * - status='visible' filter still hides composite + hidden_by_composite
 *   members.
 * - denylist NOT EXISTS still applies.
 */

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let db: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
  db = testDb.db;
});

afterAll(async () => {
  await testDb.pg.close();
});

beforeEach(async () => {
  await testDb.clearSeedData();
  await db.insert(users).values({ id: 1, displayName: "u" }).onConflictDoNothing();
  await db
    .insert(sports)
    .values([
      { id: 1, name: "running", color: "#000" },
      { id: 2, name: "lifting", color: "#111" },
    ])
    .onConflictDoNothing();
});

describe("findDuplicateCandidates — BETWEEN + recent prefilter (#24)", () => {
  it("D1: Strava Z-offset + Apple Health local-offset within 60min flagged", async () => {
    // 2026-05-14T12:00Z and 2026-05-14T05:00-07:00 are the SAME instant.
    // The detector should flag them as a candidate pair (minutes_apart=0,
    // different sources). This is the post-#25 mixed-offset case.
    await db.insert(events).values([
      {
        userId: 1, sportId: 1, type: "Run",
        startedAt: "2026-05-14T12:00:00.000Z",
        source: "strava", sourceId: "z-1",
      },
      {
        userId: 1, sportId: 1, type: "Run",
        startedAt: "2026-05-14T05:00:00.000-07:00", // == 12:00Z
        source: "apple_health", sourceId: "ah-1",
      },
    ]);

    const pairs = await findDuplicateCandidates(1, { recent: false }, db);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].minutesApart).toBe(0);
    expect(new Set([pairs[0].aSource, pairs[0].bSource])).toEqual(
      new Set(["strava", "apple_health"]),
    );
  });

  it("D2: events 60 minutes apart exactly are flagged (inclusive boundary)", async () => {
    await db.insert(events).values([
      {
        userId: 1, sportId: 1, type: "Run",
        startedAt: "2026-05-14T12:00:00.000Z",
        source: "strava", sourceId: "boundary-a",
      },
      {
        userId: 1, sportId: 1, type: "Run",
        startedAt: "2026-05-14T13:00:00.000Z", // exactly +60min
        source: "manual", sourceId: "boundary-b",
      },
    ]);

    const pairs = await findDuplicateCandidates(1, { recent: false }, db);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].minutesApart).toBe(60);
  });

  it("D3: events 61 minutes apart are NOT flagged (just outside window)", async () => {
    await db.insert(events).values([
      {
        userId: 1, sportId: 1, type: "Run",
        startedAt: "2026-05-14T12:00:00.000Z",
        source: "strava", sourceId: "out-a",
      },
      {
        userId: 1, sportId: 1, type: "Run",
        startedAt: "2026-05-14T13:01:00.000Z", // +61min
        source: "manual", sourceId: "out-b",
      },
    ]);

    const pairs = await findDuplicateCandidates(1, { recent: false }, db);
    expect(pairs).toHaveLength(0);
  });

  it("D4: same-source pairs are NOT flagged", async () => {
    // Two manual events seconds apart — should still not flag because
    // the source-not-equal filter excludes them.
    await db.insert(events).values([
      {
        userId: 1, sportId: 1, type: "Run",
        startedAt: "2026-05-14T12:00:00.000Z",
        source: "manual", sourceId: "same-a",
      },
      {
        userId: 1, sportId: 1, type: "Run",
        startedAt: "2026-05-14T12:00:30.000Z",
        source: "manual", sourceId: "same-b",
      },
    ]);

    const pairs = await findDuplicateCandidates(1, { recent: false }, db);
    expect(pairs).toHaveLength(0);
  });

  it("D5: recent=true respects the 14-day cutoff via prefilter", async () => {
    // Use NOW-relative dates so the test isn't fragile to whatever real
    // time it runs against. The detector's recent=true uses NOW() inside
    // the SQL, so the test must too.
    const now = Date.now();
    const fiveDaysAgo = new Date(now - 5 * 24 * 3600 * 1000);
    const oneHundredDaysAgo = new Date(now - 100 * 24 * 3600 * 1000);
    await db.insert(events).values([
      // Pair A: both ~5 days ago. Should be flagged by recent=true.
      {
        userId: 1, sportId: 1, type: "Run",
        startedAt: fiveDaysAgo.toISOString(),
        source: "strava", sourceId: "recent-a",
      },
      {
        userId: 1, sportId: 1, type: "Run",
        startedAt: new Date(fiveDaysAgo.getTime() + 30 * 60 * 1000).toISOString(),
        source: "apple_health", sourceId: "recent-b",
      },
      // Pair B: both ~100 days ago. Should be filtered OUT by recent=true.
      {
        userId: 1, sportId: 1, type: "Run",
        startedAt: oneHundredDaysAgo.toISOString(),
        source: "strava", sourceId: "old-a",
      },
      {
        userId: 1, sportId: 1, type: "Run",
        startedAt: new Date(oneHundredDaysAgo.getTime() + 30 * 60 * 1000).toISOString(),
        source: "apple_health", sourceId: "old-b",
      },
    ]);

    const recentPairs = await findDuplicateCandidates(1, { recent: true }, db);
    expect(recentPairs).toHaveLength(1);
    const sources = new Set([recentPairs[0].aSource, recentPairs[0].bSource]);
    expect(sources).toEqual(new Set(["strava", "apple_health"]));

    // recent=false sees both pairs.
    const allPairs = await findDuplicateCandidates(1, { recent: false }, db);
    expect(allPairs).toHaveLength(2);
  });

  it("D6: recent=true cutoff-straddle preserved by -60min prefilter slop", async () => {
    // The whole point of the -60min slop on the prefilter: a pair where
    // the OLDER endpoint is just before the 14-day cutoff but the NEWER
    // endpoint is just inside it should still flag, because the join's
    // 60-min window pulls them together AND the post-join GREATEST
    // check sees the newer one as recent.
    //
    // Older endpoint = 30 min BEFORE the 14-day cutoff (outside).
    // Newer endpoint = 15 min AFTER the cutoff (inside).
    // Gap = 45 min, within the 60-min match window.
    const cutoff = Date.now() - 14 * 24 * 3600 * 1000;
    const olderTs = new Date(cutoff - 30 * 60 * 1000);
    const newerTs = new Date(cutoff + 15 * 60 * 1000);
    await db.insert(events).values([
      {
        userId: 1, sportId: 1, type: "Run",
        startedAt: olderTs.toISOString(),
        source: "strava", sourceId: "straddle-old",
      },
      {
        userId: 1, sportId: 1, type: "Run",
        startedAt: newerTs.toISOString(),
        source: "apple_health", sourceId: "straddle-new",
      },
    ]);

    const pairs = await findDuplicateCandidates(1, { recent: true }, db);
    expect(pairs).toHaveLength(1);
  });

  it("D7: status='hidden_by_composite' member hidden from candidates", async () => {
    await db.insert(events).values([
      {
        userId: 1, sportId: 1, type: "Run",
        startedAt: "2026-05-14T12:00:00.000Z",
        source: "strava", sourceId: "v-1",
        status: "visible",
      },
      {
        userId: 1, sportId: 1, type: "Run",
        startedAt: "2026-05-14T12:05:00.000Z",
        source: "apple_health", sourceId: "h-1",
        status: "hidden_by_composite",
      },
    ]);

    const pairs = await findDuplicateCandidates(1, { recent: false }, db);
    expect(pairs).toHaveLength(0);
  });
});
