import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildDbMock, setupRouteTest } from "@/test-utils/route-test";

vi.mock("@/db", () => buildDbMock());

import { POST } from "./route";
import { ingestConfigs, metrics, metricTypes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { encrypt, lookupHash } from "@/lib/auth/secrets";

/**
 * End-to-end coverage for the Apple Health ingest route.
 *
 * Post-multi-user (PR 2 phase 4), HAE auth is per-user via
 * sha256(token) lookup against ingest_configs.lookup_hash. The
 * INGEST_API_KEY env var is gone; each user has their own key
 * stored encrypted in their ingest_configs row.
 *
 * Three surfaces matter:
 *
 *   1. Bearer auth (validateUserApiKey) — must reject missing /
 *      wrong / malformed Authorization headers with 401, never leak
 *      which case it is. The route must never read DB state if auth
 *      fails (so a wrong key probing for user-enumeration learns
 *      nothing).
 *
 *   2. Resolver + upsert chain — a fresh metric name should auto-
 *      create a metric_type with the `apple_health:` source-prefix
 *      (orphan-first ingest), and the metric row should land with
 *      the alias key the resolver matched. This is the silent-
 *      corruption path: if the resolver auto-creates the wrong
 *      metric_type the user can't tell until they merge.
 *
 *   3. Per-user isolation — Alice's key must NEVER write into
 *      Bob's metric_types catalog or his metrics rows. The resolver
 *      cache is per-user (silent-corruption fix from phase 3a).
 */

function ingestReq(opts: { auth?: string | null; payload: unknown }): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.auth !== null && opts.auth !== undefined) {
    headers["authorization"] = opts.auth;
  }
  return new NextRequest("http://test/api/ingest/apple-health", {
    method: "POST",
    headers,
    body: JSON.stringify(opts.payload),
  });
}

const TEST_KEY = "test-bearer-key-for-vitest";
const ENC_KEY = "0".repeat(64);

describe("POST /api/ingest/apple-health", () => {
  const ctx = setupRouteTest();

  beforeEach(() => {
    vi.stubEnv("OAUTH_ENCRYPTION_KEY", ENC_KEY);
  });

  async function seedKeyForUser1(plaintext: string): Promise<void> {
    // The bootstrap user (id=1) is auto-seeded in route-test.ts's
    // beforeEach; just attach a key.
    const db = ctx.getDb();
    await db.insert(ingestConfigs).values({
      userId: 1,
      source: "apple_health",
      encryptedValue: encrypt(plaintext),
      lookupHash: lookupHash(plaintext),
      enabled: true,
    });
  }

  it("H1: rejects missing Authorization with 401 (no DB read)", async () => {
    const db = ctx.getDb();
    await seedKeyForUser1(TEST_KEY);
    const res = await POST(ingestReq({ auth: null, payload: {} }));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/missing/i);
    // Critical: no row was inserted (auth fails BEFORE the body is parsed).
    expect(await db.select().from(metrics)).toHaveLength(0);
  });

  it("H2: rejects wrong bearer with 401", async () => {
    await seedKeyForUser1(TEST_KEY);
    const res = await POST(
      ingestReq({ auth: "Bearer wrong-key", payload: {} }),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    // Generic "Invalid API key" — no enumeration leak.
    expect(body.error).toMatch(/invalid/i);
  });

  it("H3: rejects when no user has a registered HAE key (any token → 401)", async () => {
    // No seed call — empty ingest_configs.
    const res = await POST(
      ingestReq({ auth: "Bearer anything", payload: {} }),
    );
    expect(res.status).toBe(401);
  });

  it("H4: correct bearer + payload writes a metric via the resolver (apple_health: prefix)", async () => {
    const db = ctx.getDb();
    await seedKeyForUser1(TEST_KEY);
    const payload = {
      data: {
        metrics: [
          {
            name: "protein",
            units: "g",
            data: [{ date: "2026-05-08 12:00:00 -0000", qty: 42 }],
          },
        ],
      },
    };
    const res = await POST(ingestReq({ auth: `Bearer ${TEST_KEY}`, payload }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      metrics: { accepted: number; skipped: number };
    };
    expect(body.metrics.accepted).toBe(1);

    // Resolver auto-created an apple_health: orphan in user 1's catalog.
    const types = await db
      .select()
      .from(metricTypes)
      .where(eq(metricTypes.name, "apple_health:protein"));
    expect(types).toHaveLength(1);
    expect(types[0].userId).toBe(1);

    // Metric row landed under user 1.
    const rows = await db
      .select()
      .from(metrics)
      .where(eq(metrics.metricTypeId, types[0].id));
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(1);
    expect(rows[0].value).toBe(42);
    expect(rows[0].source).toBe("apple_health");
    expect(rows[0].alias).toBe("apple_health:protein");
    expect(rows[0].recordedAt).toMatch(/^2026-05-08T12:00:00/);
  });

  it("H5: re-ingesting the same source_id is idempotent (upsert, no duplicate)", async () => {
    const db = ctx.getDb();
    await seedKeyForUser1(TEST_KEY);
    const payload = {
      data: {
        metrics: [
          {
            name: "fiber",
            units: "g",
            data: [{ date: "2026-05-08 12:00:00 -0000", qty: 30 }],
          },
        ],
      },
    };
    const res1 = await POST(ingestReq({ auth: `Bearer ${TEST_KEY}`, payload }));
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as {
      metrics: { accepted: number; skipped: number };
    };
    expect(body1.metrics.accepted).toBe(1);

    const res2 = await POST(ingestReq({ auth: `Bearer ${TEST_KEY}`, payload }));
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as {
      metrics: { accepted: number; skipped: number };
    };
    expect(body2.metrics.accepted).toBe(0);
    expect(body2.metrics.skipped).toBe(1);

    const types = await db
      .select()
      .from(metricTypes)
      .where(eq(metricTypes.name, "apple_health:fiber"));
    const rows = await db
      .select()
      .from(metrics)
      .where(eq(metrics.metricTypeId, types[0].id));
    expect(rows).toHaveLength(1);
  });

  it("H6: per-user isolation — Bob's key writes to Bob's catalog, not user 1's", async () => {
    // Seed user 1 with one HAE key (auto-bootstrap row already exists).
    await seedKeyForUser1("alice-token");

    // Seed Bob (id=20) with his own key.
    const db = ctx.getDb();
    const { users } = await import("@/db/schema");
    await db.insert(users).values({
      id: 20,
      displayName: "Bob",
      email: "bob@test",
      passwordHash: null,
      createdAt: new Date().toISOString(),
    });
    await db.insert(ingestConfigs).values({
      userId: 20,
      source: "apple_health",
      encryptedValue: encrypt("bob-token"),
      lookupHash: lookupHash("bob-token"),
      enabled: true,
    });

    // Bob ingests "weight" via his bearer token.
    const res = await POST(
      ingestReq({
        auth: "Bearer bob-token",
        payload: {
          data: {
            metrics: [
              { name: "weight", units: "lb", data: [{ date: "2026-05-08 08:00:00 -0000", qty: 200 }] },
            ],
          },
        },
      }),
    );
    expect(res.status).toBe(200);

    // Bob's metric_type lands under user_id=20.
    const types = await db.select().from(metricTypes);
    expect(types).toHaveLength(1);
    expect(types[0].userId).toBe(20);
    expect(types[0].name).toBe("apple_health:weight");

    // Bob's metric row lands under user_id=20.
    const ms = await db.select().from(metrics);
    expect(ms).toHaveLength(1);
    expect(ms[0].userId).toBe(20);
  });
});
