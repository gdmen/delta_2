/**
 * Route-handler integration test helper.
 *
 * Use this from a test file that wants to invoke a Next.js route handler
 * (e.g. `src/app/api/.../route.ts`) directly while having the route's
 * `import { db } from "@/db"` resolve to a per-test pglite instance
 * instead of the production postgres-js connection.
 *
 * Pattern:
 *
 *   import { setupRouteTest } from "@/test-utils/route-test";
 *   import { POST } from "@/app/api/dev/wipe-data/route";
 *
 *   const ctx = setupRouteTest();
 *   it("does the thing", async () => {
 *     await ctx.db.insert(sports).values({ ... });
 *     const res = await POST();
 *     expect(res.status).toBe(200);
 *   });
 *
 * Internals: `vi.mock("@/db", ...)` returns a Proxy that defers every
 * property access to a `testDb` populated in `beforeAll`. pglite startup
 * is async (loads WASM) so the Proxy can't be the real db at mock-factory
 * time. `beforeEach` truncates every table so each test runs against
 * an empty schema. `afterAll` closes the pglite engine.
 *
 * Caller responsibility: call `vi.mock("@/db", ...)` at the TOP of your
 * test file (before any other imports), passing the mock-builder this
 * helper exports. vitest hoists `vi.mock` so the mock is in place before
 * the route module imports `@/db`.
 *
 * AUTH MOCK: this file ALSO globally mocks `@/lib/auth/require` and
 * `@/lib/auth/config` so route handlers calling `requireUserOr401()` /
 * `requireUserOrSignin()` get a fake user (default id=1, isOwner=true)
 * instead of trying to read a session cookie. Tests that want a
 * different user id can override via `setTestUser(id, { isOwner })`.
 */
import { afterAll, beforeAll, beforeEach, vi } from "vitest";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import type { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import * as schema from "@/db/schema";

// Module-scoped fake user. Defaults to the bootstrap owner (id=1) so any
// test that doesn't care about cross-user behavior passes the same auth
// gate the prod codebase had with the hardcoded `userId = 1`.
let testUser: { id: number; displayName: string; isOwner: boolean; jti: string; email: string | null } = {
  id: 1,
  displayName: "Test User",
  isOwner: true,
  jti: "test-jti",
  email: "test@example.com",
};

let testAuthEnabled = true;

/**
 * Override the test user for the next route invocation. Useful for
 * cross-user-isolation tests that need to make Bob's request inside a
 * test that seeded Alice's data.
 */
export function setTestUser(id: number, opts?: { isOwner?: boolean; displayName?: string; email?: string | null }) {
  testUser = {
    id,
    displayName: opts?.displayName ?? `Test User ${id}`,
    isOwner: opts?.isOwner ?? false,
    jti: `test-jti-${id}`,
    email: opts?.email ?? `user${id}@example.com`,
  };
}

/**
 * Force the auth helpers to behave as if no user is signed in. Use to
 * test 401 responses.
 */
export function setTestUnauthenticated(unauth: boolean) {
  testAuthEnabled = !unauth;
}

vi.mock("@/lib/auth/require", async () => {
  return {
    UnauthorizedError: class extends Error {
      status: number;
      constructor(reason: string, status = 401) {
        super(reason);
        this.name = "UnauthorizedError";
        this.status = status;
      }
    },
    async requireUser() {
      if (!testAuthEnabled) {
        const err = new Error("not signed in");
        err.name = "UnauthorizedError";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err as any).status = 401;
        throw err;
      }
      return testUser;
    },
    async requireUserOr401() {
      if (!testAuthEnabled) {
        return {
          user: null,
          error: NextResponse.json({ error: "not signed in" }, { status: 401 }),
        };
      }
      return { user: testUser, error: null };
    },
    async requireUserOrSignin() {
      if (!testAuthEnabled) {
        throw new Error("test: requireUserOrSignin called while unauthenticated");
      }
      return testUser;
    },
  };
});

vi.mock("@/lib/auth/config", () => ({
  auth: async () => ({ user: { id: String(testUser.id) } }),
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: {},
}));

// Module-scoped state. The vi.mock factory and the test setup helpers
// share this so the Proxy in the mock can defer to the real testDb
// once beforeAll initializes it.
let testDb: PgliteDatabase<typeof schema> | null = null;
let testPg: PGlite | null = null;

/**
 * Returns the mock module for `vi.mock("@/db", () => buildDbMock())`.
 * Drop-in `db` replacement that throws clearly if accessed before
 * `setupRouteTest()`'s beforeAll runs.
 */
export function buildDbMock() {
  return {
    db: new Proxy({} as PgliteDatabase<typeof schema>, {
      get(_target, prop, receiver) {
        if (!testDb) {
          throw new Error(
            "[route-test] @/db accessed before beforeAll initialized the test pglite. " +
              "Did you call setupRouteTest() at the top of your describe()?",
          );
        }
        const v = Reflect.get(testDb, prop, receiver);
        return typeof v === "function" ? v.bind(testDb) : v;
      },
    }),
  };
}

/**
 * Wires up beforeAll / beforeEach / afterAll for a route-handler test
 * file. Returns a `getDb()` so test cases can seed rows directly.
 *
 * The pglite instance is shared across all tests in a file (startup is
 * ~500ms; per-test would be slow). Tables are TRUNCATEd between tests
 * for isolation.
 */
export function setupRouteTest() {
  beforeAll(async () => {
    const { createTestDb } = await import("@/test-utils/in-memory-db");
    const setup = await createTestDb();
    testDb = setup.db;
    testPg = setup.pg;
  });

  beforeEach(async () => {
    if (!testDb) throw new Error("testDb not initialized");
    // Truncate everything in one statement (CASCADE handles FK order).
    // Don't truncate ingest_configs — it preserves test-time auth tokens
    // if any test sets them, mirroring the prod wipe behavior.
    await testDb.execute(
      sql.raw(
        `TRUNCATE TABLE
          workout_sets, event_metrics, goal_journal_entries, coach_calls,
          focuses, goals, events, metrics, metric_type_aliases, metric_types,
          sports, daily_summaries, reconcile_log, merge_log, source_settings,
          import_sources, dashboard_widgets, dashboards
        RESTART IDENTITY CASCADE`,
      ),
    );
  });

  afterAll(async () => {
    await testPg?.close();
    testPg = null;
    testDb = null;
  });

  return {
    /** Get the shared pglite db. Use inside `it(...)` for seeding/asserts. */
    getDb(): PgliteDatabase<typeof schema> {
      if (!testDb) throw new Error("testDb not initialized");
      return testDb;
    },
  };
}
