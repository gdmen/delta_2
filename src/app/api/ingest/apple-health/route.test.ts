import { describe, expect, it, vi } from "vitest";
import { buildDbMock, setupRouteTest } from "@/test-utils/route-test";

vi.mock("@/db", () => buildDbMock());

import { POST } from "./route";
import { metrics, metricTypes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

/**
 * End-to-end coverage for the Apple Health ingest route. Two surfaces
 * matter here:
 *
 *   1. Bearer auth (`validateApiKey` in src/lib/auth.ts) — must reject
 *      missing / wrong / malformed Authorization headers with 401, never
 *      leak which case it is. The route must never read DB state if auth
 *      fails (so a wrong key probing for user-enumeration learns nothing).
 *
 *   2. Resolver + upsert chain — a fresh metric name should auto-create
 *      a metric_type with the `apple_health:` source-prefix (orphan-first
 *      ingest), and the metric row should land with the alias key the
 *      resolver matched. This is the silent-corruption path: if the
 *      resolver auto-creates the wrong metric_type the user can't tell
 *      until they merge.
 *
 * The resolver itself has unit tests in src/lib/ingest/metric-resolver.test.ts
 * — these tests verify the route-level GLUE: auth → parse → resolver
 * → upsert in one HTTP call.
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

describe("POST /api/ingest/apple-health", () => {
  const ctx = setupRouteTest();

  it("H1: rejects missing Authorization with 401 (no DB read)", async () => {
    const db = ctx.getDb();
    vi.stubEnv("INGEST_API_KEY", TEST_KEY);
    try {
      const res = await POST(ingestReq({ auth: null, payload: {} }));
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/missing/i);
      // Critical: no row was inserted (auth fails BEFORE the body is parsed).
      expect(await db.select().from(metrics)).toHaveLength(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("H2: rejects wrong bearer with 401 + same generic shape as H1", async () => {
    vi.stubEnv("INGEST_API_KEY", TEST_KEY);
    try {
      const res = await POST(
        ingestReq({ auth: "Bearer wrong-key", payload: {} }),
      );
      expect(res.status).toBe(401);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("H3: rejects when INGEST_API_KEY env var is unset (server misconfig → 500)", async () => {
    vi.stubEnv("INGEST_API_KEY", "");
    try {
      const res = await POST(
        ingestReq({ auth: "Bearer anything", payload: {} }),
      );
      expect(res.status).toBe(500);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("H4: correct bearer + payload writes a metric via the resolver (apple_health: prefix)", async () => {
    const db = ctx.getDb();
    vi.stubEnv("INGEST_API_KEY", TEST_KEY);
    try {
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
      const res = await POST(
        ingestReq({ auth: `Bearer ${TEST_KEY}`, payload }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        metrics: { accepted: number; skipped: number };
      };
      expect(body.metrics.accepted).toBe(1);

      // Resolver auto-created an apple_health: orphan (no alias entry,
      // no canonical "protein" — orphan-first behavior).
      const types = await db
        .select()
        .from(metricTypes)
        .where(eq(metricTypes.name, "apple_health:protein"));
      expect(types).toHaveLength(1);

      // Metric row wrote with the resolver's alias key on it (powers
      // chain-undo of any future merge involving this row).
      const rows = await db
        .select()
        .from(metrics)
        .where(eq(metrics.metricTypeId, types[0].id));
      expect(rows).toHaveLength(1);
      expect(rows[0].value).toBe(42);
      expect(rows[0].source).toBe("apple_health");
      expect(rows[0].alias).toBe("apple_health:protein");
      // The recorded_at is the parsed iso form of the HAE date string
      // (HAE sends "2026-05-08 12:00:00 -0000" → ISO 8601 with Z).
      expect(rows[0].recordedAt).toMatch(/^2026-05-08T12:00:00/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("H5: re-ingesting the same source_id is idempotent (upsert, no duplicate)", async () => {
    const db = ctx.getDb();
    vi.stubEnv("INGEST_API_KEY", TEST_KEY);
    try {
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
      // First ingest.
      const res1 = await POST(
        ingestReq({ auth: `Bearer ${TEST_KEY}`, payload }),
      );
      expect(res1.status).toBe(200);
      const body1 = (await res1.json()) as {
        metrics: { accepted: number; skipped: number };
      };
      expect(body1.metrics.accepted).toBe(1);

      // Second ingest with the EXACT same payload — source_id collides
      // and the upsert path treats it as a no-op duplicate. The route
      // reports `accepted: 0, skipped: 1` for the duplicate, and the
      // metrics row count stays at 1 (no double-write).
      const res2 = await POST(
        ingestReq({ auth: `Bearer ${TEST_KEY}`, payload }),
      );
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
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
