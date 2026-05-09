import { describe, expect, it, vi } from "vitest";
import {
  buildDbMock,
  setupRouteTest,
  setTestUser,
} from "@/test-utils/route-test";

vi.mock("@/db", () => buildDbMock());

import { POST, DELETE, GET } from "./route";
import { dashboards, dashboardShareTokens, users } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

/**
 * /api/dashboards/[id]/share — mint, list, revoke share tokens.
 *
 * Pin properties:
 *   - Owner of the dashboard can mint, list, revoke.
 *   - Non-owner gets 404 (never confirms the dashboard exists).
 *   - Mint revokes any existing active token (one-active invariant
 *     from the partial unique index).
 *   - Revoke is idempotent (revoking when none active returns ok with
 *     count 0).
 *   - Tokens are 32 bytes base64url ≈ 43 chars.
 */

function paramsFor(id: number) {
  return { params: Promise.resolve({ id: String(id) }) };
}

describe("POST/DELETE/GET /api/dashboards/[id]/share", () => {
  const ctx = setupRouteTest();

  async function seedDash(userId: number, slug: string): Promise<number> {
    const db = ctx.getDb();
    const [row] = await db
      .insert(dashboards)
      .values({ userId, slug, name: `Dashboard ${slug}` })
      .returning({ id: dashboards.id });
    return row.id;
  }

  async function seedUser(id: number, displayName: string) {
    const db = ctx.getDb();
    await db.insert(users).values({
      id,
      displayName,
      email: `${displayName.toLowerCase()}@test`,
      passwordHash: null,
      createdAt: new Date().toISOString(),
    });
  }

  it("S1: owner mints a token; row inserted with active state", async () => {
    setTestUser(1, { isOwner: true });
    const dashId = await seedDash(1, "today");

    const res = await POST(new Request("http://test/"), paramsFor(dashId));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const db = ctx.getDb();
    const tokens = await db
      .select()
      .from(dashboardShareTokens)
      .where(eq(dashboardShareTokens.dashboardId, dashId));
    expect(tokens).toHaveLength(1);
    expect(tokens[0].token).toBe(body.token);
    expect(tokens[0].revokedAt).toBeNull();
    expect(tokens[0].createdByUserId).toBe(1);
  });

  it("S2: re-minting revokes the previous active token (one-active invariant)", async () => {
    setTestUser(1, { isOwner: true });
    const dashId = await seedDash(1, "today");

    const r1 = await POST(new Request("http://test/"), paramsFor(dashId));
    const t1 = ((await r1.json()) as { token: string }).token;

    const r2 = await POST(new Request("http://test/"), paramsFor(dashId));
    const t2 = ((await r2.json()) as { token: string }).token;

    expect(t1).not.toBe(t2);

    const db = ctx.getDb();
    // First token revoked.
    const old = await db
      .select()
      .from(dashboardShareTokens)
      .where(eq(dashboardShareTokens.token, t1));
    expect(old[0].revokedAt).not.toBeNull();
    // Second token active.
    const fresh = await db
      .select()
      .from(dashboardShareTokens)
      .where(eq(dashboardShareTokens.token, t2));
    expect(fresh[0].revokedAt).toBeNull();
    // Exactly one active token per dashboard.
    const active = await db
      .select()
      .from(dashboardShareTokens)
      .where(
        and(
          eq(dashboardShareTokens.dashboardId, dashId),
          isNull(dashboardShareTokens.revokedAt),
        ),
      );
    expect(active).toHaveLength(1);
  });

  it("S3: DELETE revokes the active token; idempotent on re-call", async () => {
    setTestUser(1, { isOwner: true });
    const dashId = await seedDash(1, "today");
    await POST(new Request("http://test/"), paramsFor(dashId));

    const r1 = await DELETE(new Request("http://test/"), paramsFor(dashId));
    expect(r1.status).toBe(200);
    expect(((await r1.json()) as { revoked: number }).revoked).toBe(1);

    const r2 = await DELETE(new Request("http://test/"), paramsFor(dashId));
    expect(r2.status).toBe(200);
    expect(((await r2.json()) as { revoked: number }).revoked).toBe(0);
  });

  it("S4: GET returns the active token if one exists, else null", async () => {
    setTestUser(1, { isOwner: true });
    const dashId = await seedDash(1, "today");

    let r = await GET(new Request("http://test/"), paramsFor(dashId));
    expect(((await r.json()) as { active: unknown }).active).toBeNull();

    await POST(new Request("http://test/"), paramsFor(dashId));
    r = await GET(new Request("http://test/"), paramsFor(dashId));
    const body = (await r.json()) as { active: { token: string } };
    expect(body.active).not.toBeNull();
    expect(body.active.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("S5: non-owner mint returns 404 (no confirmation that dashboard exists)", async () => {
    // Alice owns dashboard.
    await seedUser(10, "Alice");
    const aliceDash = await seedDash(10, "alice-only");

    // Bob tries to mint a token for Alice's dashboard.
    await seedUser(20, "Bob");
    setTestUser(20, { isOwner: false });

    const res = await POST(new Request("http://test/"), paramsFor(aliceDash));
    expect(res.status).toBe(404);

    // Token table is still empty — Bob's request didn't create anything.
    const db = ctx.getDb();
    const all = await db.select().from(dashboardShareTokens);
    expect(all).toHaveLength(0);

    // Reset for cleanup.
    setTestUser(1, { isOwner: true });
  });

  it("S6: malformed id returns 404 without DB hit", async () => {
    setTestUser(1, { isOwner: true });
    const res = await POST(
      new Request("http://test/"),
      { params: Promise.resolve({ id: "not-a-number" }) },
    );
    expect(res.status).toBe(404);
  });

  it("S7: unauth → 401", async () => {
    const { setTestUnauthenticated } = await import("@/test-utils/route-test");
    setTestUnauthenticated(true);
    try {
      const res = await POST(new Request("http://test/"), paramsFor(1));
      expect(res.status).toBe(401);
    } finally {
      setTestUnauthenticated(false);
      setTestUser(1, { isOwner: true });
    }
  });
});
