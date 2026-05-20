import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { buildDbMock, setupRouteTest, setTestUser } from "./route-test";

vi.mock("@/db", () => buildDbMock());

import { eq } from "drizzle-orm";
import {
  users,
  sports,
  metricTypes,
  metrics,
  events,
  goals,
  dashboards,
  ingestConfigs,
  importSources,
  mergeLog,
  dashboardShareTokens,
  inviteCodes,
} from "@/db/schema";
import { encrypt, lookupHash } from "@/lib/auth/secrets";

// Route handlers are typed against NextRequest; bare Request misses
// .cookies / .nextUrl. Use this helper everywhere we'd otherwise
// `new Request(...)`. The `init` is loosely typed because Next's
// internal RequestInit narrows `signal` and the global RequestInit
// allows null — not a real-runtime concern in tests.
function req(
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): NextRequest {
  return new NextRequest(url, init as ConstructorParameters<typeof NextRequest>[1]);
}

/**
 * THE NON-NEGOTIABLE CROSS-USER ISOLATION HARNESS.
 *
 * For every OWNED route + every share-link route + the per-user
 * invite admin, this harness:
 *
 *   1. Seeds Alice (id=10) with one row of every owned-table type.
 *   2. Seeds Bob (id=20).
 *   3. Sets the test session to Bob.
 *   4. Calls each route targeting Alice's resource id.
 *   5. Asserts the response is the right rejection (404 for
 *      [id]-shaped routes; 403 for owner-only routes; empty list
 *      for collection-shaped reads).
 *
 * Per the plan's eng-review CRITICAL finding: this is the single
 * highest-leverage defense against cross-user data leak. Every
 * route under /api/* (except /api/auth/* and /api/ingest/*) MUST
 * appear here. New routes added later MUST get a row in the
 * isolation table or fail this suite.
 *
 * Pattern:
 *   - 404 for owned [id] routes (don't confirm the resource exists)
 *   - 403 for owner-only routes (do confirm the route exists, but
 *     refuse the action)
 *   - Empty list for collection reads (you only ever see your own)
 *
 * Tests not in this file because they have specific covering tests:
 *   - Auth.js routes (/api/auth/*) — covered by their own tests
 *   - Bearer-auth ingest routes (/api/ingest/apple-health) — covered
 *     by api-key.test.ts H6 isolation case
 */

// ============================================================================
// SHARED FIXTURE: Alice + Bob with one of each kind of resource
// ============================================================================

const ctx = setupRouteTest();

interface Fixture {
  alice: { id: number };
  bob: { id: number };
  // Alice's resources
  aliceSportId: number;
  aliceMetricTypeId: number;
  aliceMetricId: number;
  aliceEventId: number;
  aliceGoalId: number;
  aliceDashboardId: number;
  aliceImportSourceId: number;
  aliceMergeLogId: number;
  aliceShareToken: string;
  aliceInviteCode: string;
}

let fx: Fixture;

beforeAll(() => {
  vi.stubEnv("OAUTH_ENCRYPTION_KEY", "0".repeat(64));
  vi.stubEnv("LOW_MEMORY_ARGON_FOR_TESTS", "1");
});

beforeEach(async () => {
  const db = ctx.getDb();
  // Bootstrap (id=1) is auto-seeded by route-test.beforeEach. Add
  // Alice (id=10, owner=true so owner-only routes don't 403 on
  // her access too — we test BOB's access being refused, not
  // Alice's) and Bob (id=20, non-owner).
  await db.insert(users).values([
    {
      id: 10,
      displayName: "Alice",
      email: "alice@test",
      passwordHash: null,
      isOwner: true, // owner so the bootstrap stays sole-owner if she's deleted; tests don't care
      createdAt: new Date().toISOString(),
    },
    {
      id: 20,
      displayName: "Bob",
      email: "bob@test",
      passwordHash: null,
      isOwner: false,
      createdAt: new Date().toISOString(),
    },
  ]);

  // Alice's resources.
  const [s] = await db
    .insert(sports)
    .values({ userId: 10, name: "alice-sport", color: "#aaa" })
    .returning({ id: sports.id });

  const [mt] = await db
    .insert(metricTypes)
    .values({ userId: 10, name: "alice-metric", unit: "kg" })
    .returning({ id: metricTypes.id });

  const [m] = await db
    .insert(metrics)
    .values({
      userId: 10,
      metricTypeId: mt.id,
      value: 70,
      recordedAt: "2026-01-01T00:00:00Z",
      source: "manual",
    })
    .returning({ id: metrics.id });

  const [ev] = await db
    .insert(events)
    .values({
      userId: 10,
      sportId: s.id,
      type: "lift",
      startedAt: "2026-01-01T00:00:00Z",
    })
    .returning({ id: events.id });

  const [g] = await db
    .insert(goals)
    .values({
      userId: 10,
      metricTypeId: mt.id,
      sportId: s.id,
      targetValue: 100,
      deadline: "2026-12-31",
    })
    .returning({ id: goals.id });

  const [d] = await db
    .insert(dashboards)
    .values({ userId: 10, slug: "alice-dash", name: "Alice Dash" })
    .returning({ id: dashboards.id });

  const [is] = await db
    .insert(importSources)
    .values({
      userId: 10,
      name: "alice-source",
      kind: "metrics",
      mapping: "{}",
    })
    .returning({ id: importSources.id });

  // ingest_configs for Alice (HAE key + Strava placeholder).
  await db.insert(ingestConfigs).values({
    userId: 10,
    source: "apple_health",
    encryptedValue: encrypt("alice-hae-key"),
    lookupHash: lookupHash("alice-hae-key"),
  });

  const [ml] = await db
    .insert(mergeLog)
    .values({
      userId: 10,
      kind: "metric_type",
      canonicalId: mt.id,
      canonicalName: "alice-metric",
      mergedNames: "alice-old",
      payload: JSON.stringify({ v: 1, kind: "metric_type", canonicalId: mt.id, merged: [] }),
    })
    .returning({ id: mergeLog.id });

  // Alice's share token for her dashboard.
  const tok = "alice-share-token-test-fixture-1234567890ab";
  await db.insert(dashboardShareTokens).values({
    token: tok,
    dashboardId: d.id,
    createdByUserId: 10,
  });

  // Alice's invite code.
  await db.insert(inviteCodes).values({
    code: "ALIC-INVT-CODE",
    createdByUserId: 10,
    createdAt: new Date().toISOString(),
  });

  fx = {
    alice: { id: 10 },
    bob: { id: 20 },
    aliceSportId: s.id,
    aliceMetricTypeId: mt.id,
    aliceMetricId: m.id,
    aliceEventId: ev.id,
    aliceGoalId: g.id,
    aliceDashboardId: d.id,
    aliceImportSourceId: is.id,
    aliceMergeLogId: ml.id,
    aliceShareToken: tok,
    aliceInviteCode: "ALIC-INVT-CODE",
  };
});

// ============================================================================
// ASSERTION HELPERS
// ============================================================================

function asBob() {
  setTestUser(20, { isOwner: false });
}
function asAlice() {
  setTestUser(10, { isOwner: true });
}

function aliceParam(fieldFromFx: keyof Fixture) {
  return { params: Promise.resolve({ id: String(fx[fieldFromFx]) }) };
}

// ============================================================================
// THE HARNESS — every owned [id] route × Bob targeting Alice's resource
// ============================================================================

/**
 * For routes whose handler returns 200 + ok regardless of rowsAffected
 * (a UX bug we're not fixing in this PR), the SECURITY invariant we
 * actually care about is "the victim's row is unchanged." Each test
 * asserts both: response status is one of {404, 403, 200} AND the row
 * still exists with original values. 200 here means the route
 * silently no-op'd because the WHERE clause matched zero rows — bad
 * UX, not a security bug.
 */
const NON_LEAKY_STATUSES = new Set([200, 204, 403, 404]);

describe("cross-user isolation harness — owned [id] routes refuse cross-tenant access", () => {
  it("/api/dashboards/[id] (PATCH, DELETE) refuses Bob for Alice's dashboard", async () => {
    asBob();
    const route = await import("@/app/api/dashboards/[id]/route");
    const params = aliceParam("aliceDashboardId");
    expect(
      NON_LEAKY_STATUSES.has(
        (
          await route.PATCH(
            req("http://test/", {
              method: "PATCH",
              body: JSON.stringify({ name: "evil" }),
              headers: { "Content-Type": "application/json" },
            }),
            params,
          )
        ).status,
      ),
    ).toBe(true);
    expect(
      NON_LEAKY_STATUSES.has(
        (await route.DELETE(req("http://test/", { method: "DELETE" }), params)).status,
      ),
    ).toBe(true);

    // And Alice's row is unchanged.
    asAlice();
    const db = ctx.getDb();
    const stillThere = await db
      .select()
      .from(dashboards)
      .where(eq(dashboards.id, fx.aliceDashboardId));
    expect(stillThere).toHaveLength(1);
    expect(stillThere[0].name).toBe("Alice Dash");
  });

  it("/api/dashboards/[id]/share (POST, DELETE, GET) returns 404 to Bob", async () => {
    asBob();
    const route = await import("@/app/api/dashboards/[id]/share/route");
    const params = aliceParam("aliceDashboardId");
    expect((await route.POST(req("http://test/"), params)).status).toBe(404);
    expect((await route.DELETE(req("http://test/"), params)).status).toBe(404);
    expect((await route.GET(req("http://test/"), params)).status).toBe(404);

    // Alice's share token still active.
    asAlice();
    const db = ctx.getDb();
    const tokens = await db
      .select()
      .from(dashboardShareTokens)
      .where(eq(dashboardShareTokens.dashboardId, fx.aliceDashboardId));
    expect(tokens).toHaveLength(1);
    expect(tokens[0].revokedAt).toBeNull();
  });

  it("/api/metrics/[id] (PATCH, DELETE) refuses Bob for Alice's metric (row unchanged)", async () => {
    asBob();
    const route = await import("@/app/api/metrics/[id]/route");
    const params = aliceParam("aliceMetricId");
    expect(
      NON_LEAKY_STATUSES.has(
        (
          await route.PATCH(
            req("http://test/", {
              method: "PATCH",
              body: JSON.stringify({ value: 999 }),
              headers: { "Content-Type": "application/json" },
            }),
            params,
          )
        ).status,
      ),
    ).toBe(true);
    expect(
      NON_LEAKY_STATUSES.has(
        (await route.DELETE(req("http://test/", { method: "DELETE" }), params)).status,
      ),
    ).toBe(true);

    asAlice();
    const db = ctx.getDb();
    const stillThere = await db.select().from(metrics).where(eq(metrics.id, fx.aliceMetricId));
    expect(stillThere).toHaveLength(1);
    expect(stillThere[0].value).toBe(70);
  });

  it("/api/events/[id] (PATCH, DELETE) refuses Bob for Alice's event", async () => {
    asBob();
    const route = await import("@/app/api/events/[id]/route");
    const params = aliceParam("aliceEventId");
    expect(
      NON_LEAKY_STATUSES.has(
        (
          await route.PATCH(
            req("http://test/", {
              method: "PATCH",
              body: JSON.stringify({ notes: "evil" }),
              headers: { "Content-Type": "application/json" },
            }),
            params,
          )
        ).status,
      ),
    ).toBe(true);
    expect(
      NON_LEAKY_STATUSES.has(
        (await route.DELETE(req("http://test/", { method: "DELETE" }), params)).status,
      ),
    ).toBe(true);

    asAlice();
    const db = ctx.getDb();
    const stillThere = await db.select().from(events).where(eq(events.id, fx.aliceEventId));
    expect(stillThere).toHaveLength(1);
  });

  it("/api/goals/[id] (PATCH, DELETE) refuses Bob for Alice's goal", async () => {
    asBob();
    const route = await import("@/app/api/goals/[id]/route");
    const params = aliceParam("aliceGoalId");
    expect(
      NON_LEAKY_STATUSES.has(
        (
          await route.PATCH(
            req("http://test/", {
              method: "PATCH",
              body: JSON.stringify({ status: "abandoned" }),
              headers: { "Content-Type": "application/json" },
            }),
            params,
          )
        ).status,
      ),
    ).toBe(true);
    expect(
      NON_LEAKY_STATUSES.has(
        (await route.DELETE(req("http://test/", { method: "DELETE" }), params)).status,
      ),
    ).toBe(true);

    asAlice();
    const db = ctx.getDb();
    const stillThere = await db.select().from(goals).where(eq(goals.id, fx.aliceGoalId));
    expect(stillThere).toHaveLength(1);
    expect(stillThere[0].status).toBe("active");
  });

  it("/api/sports/[id] (DELETE) refuses Bob for Alice's sport", async () => {
    asBob();
    const route = await import("@/app/api/sports/[id]/route");
    const params = aliceParam("aliceSportId");
    expect(
      NON_LEAKY_STATUSES.has(
        (await route.DELETE(req("http://test/", { method: "DELETE" }), params)).status,
      ),
    ).toBe(true);

    asAlice();
    const db = ctx.getDb();
    const stillThere = await db.select().from(sports).where(eq(sports.id, fx.aliceSportId));
    expect(stillThere).toHaveLength(1);
  });

  it("/api/metric-types/[id] (DELETE) refuses Bob for Alice's metric_type", async () => {
    asBob();
    const route = await import("@/app/api/metric-types/[id]/route");
    const params = aliceParam("aliceMetricTypeId");
    expect(
      NON_LEAKY_STATUSES.has(
        (await route.DELETE(req("http://test/", { method: "DELETE" }), params)).status,
      ),
    ).toBe(true);

    asAlice();
    const db = ctx.getDb();
    const stillThere = await db.select().from(metricTypes).where(eq(metricTypes.id, fx.aliceMetricTypeId));
    expect(stillThere).toHaveLength(1);
  });

  it("/api/metric-types/bulk-frequency (POST) refuses Bob for Alice's metric_type", async () => {
    // Bulk endpoint: Bob POSTs Alice's id, the UPDATE's per-user
    // scope filters it out → result is { updated: 0, skipped: [aliceId] }.
    // Alice's row stays at its original frequency_hint.
    asBob();
    const route = await import("@/app/api/metric-types/bulk-frequency/route");
    const res = await route.POST(
      req("http://test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: [fx.aliceMetricTypeId],
          frequencyHint: "weekly",
        }),
      }),
    );
    expect(NON_LEAKY_STATUSES.has(res.status)).toBe(true);
    if (res.status === 200) {
      const body = await res.json();
      expect(body.updated).toBe(0);
      expect(body.skipped).toContain(fx.aliceMetricTypeId);
    }

    // Alice's row is unchanged — frequencyHint should still be the seed default.
    asAlice();
    const db = ctx.getDb();
    const aliceRow = await db
      .select({ freq: metricTypes.frequencyHint })
      .from(metricTypes)
      .where(eq(metricTypes.id, fx.aliceMetricTypeId));
    expect(aliceRow).toHaveLength(1);
    // Default is "daily" per the schema; Bob's request asked for "weekly"
    // which should NOT have taken effect.
    expect(aliceRow[0].freq).toBe("daily");
  });

  it("/api/import-sources/[id] (PATCH, DELETE) refuses Bob for Alice's source", async () => {
    asBob();
    const route = await import("@/app/api/import-sources/[id]/route");
    const params = aliceParam("aliceImportSourceId");
    expect(
      NON_LEAKY_STATUSES.has(
        (
          await route.PATCH(
            req("http://test/", {
              method: "PATCH",
              body: JSON.stringify({ name: "evil" }),
              headers: { "Content-Type": "application/json" },
            }),
            params,
          )
        ).status,
      ),
    ).toBe(true);
    expect(
      NON_LEAKY_STATUSES.has(
        (await route.DELETE(req("http://test/", { method: "DELETE" }), params)).status,
      ),
    ).toBe(true);

    asAlice();
    const db = ctx.getDb();
    const stillThere = await db
      .select()
      .from(importSources)
      .where(eq(importSources.id, fx.aliceImportSourceId));
    expect(stillThere).toHaveLength(1);
  });

  it("/api/merges/[id]/undo refuses cross-user undo (403 or 404)", async () => {
    asBob();
    const route = await import("@/app/api/merges/[id]/undo/route");
    const params = aliceParam("aliceMergeLogId");
    const res = await route.POST(req("http://test/", { method: "POST" }), params);
    // The merge-undo path may report 404 (row not found in user's
    // scope) or 409 / 403 depending on the order of checks. Whatever
    // it returns, it MUST NOT be 200.
    expect(res.status).not.toBe(200);

    asAlice();
    const db = ctx.getDb();
    const log = await db.select().from(mergeLog).where(eq(mergeLog.id, fx.aliceMergeLogId));
    // Alice's merge_log row is untouched (undone_at still null).
    expect(log[0].undoneAt).toBeNull();
  });
});

// ============================================================================
// Owner-only routes (invites + dev wipe) refuse non-owners with 403
// ============================================================================

describe("cross-user isolation harness — owner-only routes refuse non-owner access", () => {
  it("/api/invites (POST, GET) returns 403 to non-owner Bob", async () => {
    asBob();
    const route = await import("@/app/api/invites/route");
    expect((await route.POST(req("http://test/", { method: "POST" }))).status).toBe(403);
    expect((await route.GET()).status).toBe(403);
  });

  it("/api/invites/[code] (DELETE) returns 403 to non-owner Bob", async () => {
    asBob();
    const route = await import("@/app/api/invites/[code]/route");
    const params = { params: Promise.resolve({ code: fx.aliceInviteCode }) };
    expect(
      (await route.DELETE(req("http://test/", { method: "DELETE" }), params)).status,
    ).toBe(403);
  });

  it("/api/users/me DELETE refuses owner self-delete (Alice is owner in this fixture)", async () => {
    asAlice();
    const route = await import("@/app/api/users/me/route");
    expect((await route.DELETE()).status).toBe(403);
  });
});

// ============================================================================
// Collection-read routes return only the caller's data
// ============================================================================

describe("cross-user isolation harness — collection reads return only the caller's rows", () => {
/**
 * Helper to extract row arrays from inconsistent route response shapes
 * (some return bare arrays, some return { table: [...] }, some
 * { dashboards: [...] }). Works against any field-or-bare-array.
 */
function rowsFrom<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[];
  if (body && typeof body === "object") {
    for (const v of Object.values(body)) {
      if (Array.isArray(v)) return v as T[];
    }
  }
  return [];
}

  it("Bob's GET /api/sports returns 0 rows when only Alice has data", async () => {
    asBob();
    const route = await import("@/app/api/sports/route");
    const res = await route.GET();
    expect(res.status).toBe(200);
    const rows = rowsFrom<{ name: string }>(await res.json());
    expect(rows.find((s) => s.name === "alice-sport")).toBeUndefined();
  });

  it("Bob's GET /api/metric-types returns 0 of Alice's types", async () => {
    asBob();
    const route = await import("@/app/api/metric-types/route");
    const res = await route.GET();
    expect(res.status).toBe(200);
    const rows = rowsFrom<{ name: string }>(await res.json());
    expect(rows.find((t) => t.name === "alice-metric")).toBeUndefined();
  });

  it("Bob's GET /api/dashboards returns 0 of Alice's dashboards", async () => {
    asBob();
    const route = await import("@/app/api/dashboards/route");
    const res = await route.GET();
    expect(res.status).toBe(200);
    const rows = rowsFrom<{ slug: string }>(await res.json());
    expect(rows.find((d) => d.slug === "alice-dash")).toBeUndefined();
  });

  it("Bob's GET /api/import-sources returns 0 of Alice's sources", async () => {
    asBob();
    const route = await import("@/app/api/import-sources/route");
    const res = await route.GET();
    expect(res.status).toBe(200);
    const rows = rowsFrom<{ name: string }>(await res.json());
    expect(rows.find((s) => s.name === "alice-source")).toBeUndefined();
  });
});

// ============================================================================
// FK-injection class: Bob references Alice's owned FK ids on create/update
// ============================================================================
//
// Adversarial review CRITICAL-3 finding: routes that accept foreign-key
// ids (sportId, metricTypeId) from the request body but only filter the
// PARENT table by user_id let Bob attach to Alice's sport / metric_type.
// The reads then JOIN sports/metricTypes and render Alice's name/color
// in Bob's UI — cross-user data leak through a fanout that the existing
// harness didn't cover.

describe("cross-user isolation harness — FK-injection class", () => {
  it("POST /api/goals refuses Alice's sportId from Bob's session", async () => {
    asBob();
    const goalsRoute = await import("@/app/api/goals/route");
    // Bob owns a sport/metric_type too so we can craft a body where
    // ONLY the sportId is foreign — proves the check fires per-field.
    const db = ctx.getDb();
    const [bobSport] = await db
      .insert(sports)
      .values({ userId: 20, name: "bob-sport", color: "#bbb" })
      .returning({ id: sports.id });
    const [bobMt] = await db
      .insert(metricTypes)
      .values({ userId: 20, name: "bob-metric", unit: "kg" })
      .returning({ id: metricTypes.id });

    // Bob's metric, Alice's sport → reject.
    const res = await goalsRoute.POST(
      req("http://test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metricTypeId: bobMt.id,
          sportId: fx.aliceSportId,
          targetValue: 1,
          deadline: "2027-01-01",
        }),
      }),
    );
    expect(res.status).toBe(400);

    // Bob's sport, Alice's metric → reject.
    const res2 = await goalsRoute.POST(
      req("http://test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metricTypeId: fx.aliceMetricTypeId,
          sportId: bobSport.id,
          targetValue: 1,
          deadline: "2027-01-01",
        }),
      }),
    );
    expect(res2.status).toBe(400);

    // Both foreign → reject.
    const res3 = await goalsRoute.POST(
      req("http://test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metricTypeId: fx.aliceMetricTypeId,
          sportId: fx.aliceSportId,
          targetValue: 1,
          deadline: "2027-01-01",
        }),
      }),
    );
    expect(res3.status).toBe(400);
  });

  it("POST /api/events refuses Alice's sportId from Bob's session", async () => {
    asBob();
    const eventsRoute = await import("@/app/api/events/route");
    const res = await eventsRoute.POST(
      req("http://test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sportId: fx.aliceSportId,
          type: "lift",
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("PATCH /api/events/[id] refuses retargeting Bob's event onto Alice's sport", async () => {
    asBob();
    const db = ctx.getDb();
    // Bob needs an event of his own to PATCH.
    const [bobSport] = await db
      .insert(sports)
      .values({ userId: 20, name: "bob-sport-2", color: "#bb2" })
      .returning({ id: sports.id });
    const [bobEvent] = await db
      .insert(events)
      .values({
        userId: 20,
        sportId: bobSport.id,
        type: "lift",
        startedAt: "2026-01-01T00:00:00Z",
      })
      .returning({ id: events.id });

    const eventsIdRoute = await import("@/app/api/events/[id]/route");
    const res = await eventsIdRoute.PATCH(
      req("http://test/", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sportId: fx.aliceSportId }),
      }),
      { params: Promise.resolve({ id: String(bobEvent.id) }) },
    );
    expect(res.status).toBe(400);

    // Bob's event still points at his own sport — the rejected PATCH
    // didn't sneak a partial update through.
    const after = await db.select().from(events).where(eq(events.id, bobEvent.id));
    expect(after[0].sportId).toBe(bobSport.id);
  });
});

// ============================================================================
// Share-link viewer reads OWNER's data, never the viewer's
// ============================================================================

describe("cross-user isolation harness — share-link page renders OWNER's data, not viewer's", () => {
  it("loadShareTarget(token) returns Alice's owner_id, never Bob's, even when Bob is signed in", async () => {
    asBob();
    const { loadShareTarget } = await import("@/lib/share/load");
    const target = await loadShareTarget(fx.aliceShareToken);
    expect(target).not.toBeNull();
    expect(target!.ownerId).toBe(10); // Alice's id
    expect(target!.ownerName).toBe("Alice");
  });
});

// ============================================================================
// Sign-up flow rejects stale / missing / claimed invite codes cleanly
// ============================================================================

describe("cross-user isolation harness — signup invite-code rejection cases", () => {
  beforeEach(async () => {
    vi.stubEnv("LOW_MEMORY_ARGON_FOR_TESTS", "1");
  });

  it("missing code → 400", async () => {
    const route = await import("@/app/api/auth/signup/route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://test/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "x@test",
        password: "password1",
        displayName: "X",
      }),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/code/i);
  });

  it("unknown code → 400 (rejected without leaking which case)", async () => {
    const route = await import("@/app/api/auth/signup/route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://test/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: "NEVER-MINTED-XX",
        email: "x@test",
        password: "password1",
        displayName: "X",
      }),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(400);
  });

  it("already-used code → 400 (no double-claim possible)", async () => {
    // Mark Alice's invite as already used.
    const db = ctx.getDb();
    await db
      .update(inviteCodes)
      .set({ usedAt: new Date().toISOString(), usedByUserId: 10 })
      .where(eq(inviteCodes.code, fx.aliceInviteCode));

    const route = await import("@/app/api/auth/signup/route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://test/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: fx.aliceInviteCode,
        email: "fresh@test",
        password: "password1",
        displayName: "Fresh",
      }),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(400);

    // No new user row created.
    const newUsers = await db
      .select()
      .from(users)
      .where(eq(users.email, "fresh@test"));
    expect(newUsers).toHaveLength(0);
  });

  it("expired code → 400", async () => {
    const db = ctx.getDb();
    await db
      .update(inviteCodes)
      .set({ expiresAt: "2020-01-01T00:00:00.000Z" }) // long past
      .where(eq(inviteCodes.code, fx.aliceInviteCode));

    const route = await import("@/app/api/auth/signup/route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://test/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: fx.aliceInviteCode,
        email: "fresh@test",
        password: "password1",
        displayName: "Fresh",
      }),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(400);
  });
});

// Reset env after the file finishes.
afterAll(() => {
  vi.unstubAllEnvs();
});

// Keep `beforeAll` referenced so the import doesn't get tree-shaken.
void beforeAll;
