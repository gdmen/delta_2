import { describe, expect, it, vi } from "vitest";
import {
  buildDbMock,
  setupRouteTest,
  setTestUser,
} from "@/test-utils/route-test";

vi.mock("@/db", () => buildDbMock());

import { POST, GET } from "./route";
import { DELETE } from "./[code]/route";
import { inviteCodes, users } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * /api/invites — owner-only mint/list/revoke flow. Pin properties:
 *   - Owner can mint, list, revoke unused codes.
 *   - Non-owner is 403 on every action.
 *   - Codes claimed by a user can't be revoked (would dangle the
 *     auth-trail entry).
 */

function deleteCtx(code: string) {
  return { params: Promise.resolve({ code }) };
}

describe("/api/invites (owner-only)", () => {
  const ctx = setupRouteTest();

  it("I1: owner can mint, list, revoke", async () => {
    setTestUser(1, { isOwner: true });
    const db = ctx.getDb();

    const mintRes = await POST(new Request("http://test/", { method: "POST" }));
    expect(mintRes.status).toBe(200);
    const mintBody = (await mintRes.json()) as { code: string };
    expect(mintBody.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    // List should include the new code.
    const listRes = await GET();
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { invites: Array<{ code: string }> };
    expect(listBody.invites.map((r) => r.code)).toContain(mintBody.code);

    // Revoke.
    const delRes = await DELETE(new Request("http://test/", { method: "DELETE" }), deleteCtx(mintBody.code));
    expect(delRes.status).toBe(200);
    const delBody = (await delRes.json()) as { ok: boolean; deleted: number };
    expect(delBody.deleted).toBe(1);

    // After revoke, the code is gone from the DB.
    const remaining = await db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.code, mintBody.code));
    expect(remaining).toHaveLength(0);
  });

  it("I2: non-owner gets 403 on mint, list, revoke", async () => {
    // Bootstrap is owner; set up Bob as non-owner.
    const db = ctx.getDb();
    await db.insert(users).values({
      id: 20,
      displayName: "Bob",
      email: "bob@test",
      passwordHash: null,
      createdAt: new Date().toISOString(),
    });
    setTestUser(20, { isOwner: false });

    expect((await POST(new Request("http://test/", { method: "POST" }))).status).toBe(403);
    expect((await GET()).status).toBe(403);
    expect(
      (await DELETE(new Request("http://test/", { method: "DELETE" }), deleteCtx("ANY-CODE-X"))).status,
    ).toBe(403);

    setTestUser(1, { isOwner: true });
  });

  it("I3: claimed code can't be revoked (returns 409)", async () => {
    setTestUser(1, { isOwner: true });
    const db = ctx.getDb();

    // Mint a code, then mark it as claimed manually.
    const mintRes = await POST(new Request("http://test/", { method: "POST" }));
    const { code } = (await mintRes.json()) as { code: string };
    await db
      .update(inviteCodes)
      .set({ usedAt: new Date().toISOString(), usedByUserId: 1 })
      .where(eq(inviteCodes.code, code));

    const delRes = await DELETE(new Request("http://test/", { method: "DELETE" }), deleteCtx(code));
    expect(delRes.status).toBe(409);
    const body = (await delRes.json()) as { error: string };
    expect(body.error).toMatch(/claimed/i);
  });

  it("I4: revoke of unknown code → 404", async () => {
    setTestUser(1, { isOwner: true });
    const res = await DELETE(
      new Request("http://test/", { method: "DELETE" }),
      deleteCtx("NEVER-MINTED-CODE"),
    );
    expect(res.status).toBe(404);
  });

  it("I5: minting with ttlDays sets expiresAt", async () => {
    setTestUser(1, { isOwner: true });
    const res = await POST(
      new Request("http://test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ttlDays: 7 }),
      }),
    );
    const body = (await res.json()) as { code: string; expiresAt: string };
    expect(body.expiresAt).not.toBeNull();
    const ttl = new Date(body.expiresAt).getTime() - Date.now();
    // Should be ~7 days; allow 1 minute slack for the round-trip.
    expect(ttl).toBeGreaterThan(6.99 * 24 * 60 * 60 * 1000);
    expect(ttl).toBeLessThan(7.01 * 24 * 60 * 60 * 1000);
  });
});
