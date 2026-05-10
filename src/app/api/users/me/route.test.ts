import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  buildDbMock,
  setupRouteTest,
  setTestUser,
  setTestUnauthenticated,
} from "@/test-utils/route-test";

vi.mock("@/db", () => buildDbMock());

import { GET, PATCH, DELETE } from "./route";
import { users, ingestConfigs, coachCalls } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

const ENC_KEY = "0".repeat(64);

beforeEach(() => {
  vi.stubEnv("OAUTH_ENCRYPTION_KEY", ENC_KEY);
  vi.stubEnv("LOW_MEMORY_ARGON_FOR_TESTS", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * /api/users/me — pin the security-critical properties:
 *   - Owner can't self-delete (refuses 403).
 *   - Password change requires currentPassword for credentials users
 *     (per the eng-review HIGH finding on re-auth).
 *   - Password change bumps password_hash_version (kill other sessions).
 *   - HAE key regenerate works.
 *   - Account delete cascades and stamps deleted_user_hash on
 *     coach_calls.
 */
describe("/api/users/me", () => {
  const ctx = setupRouteTest();

  async function seedCredentialsUser(id: number, password: string) {
    const db = ctx.getDb();
    await db.insert(users).values({
      id,
      displayName: `User ${id}`,
      email: `u${id}@test`,
      passwordHash: await hashPassword(password),
      isOwner: false,
      createdAt: new Date().toISOString(),
    });
  }

  it("U1: GET returns the current user shape", async () => {
    setTestUser(1, { isOwner: true });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: number; isOwner: boolean };
    expect(body.id).toBe(1);
    expect(body.isOwner).toBe(true);
  });

  it("U2: change-password requires correct current password", async () => {
    await seedCredentialsUser(20, "old-password-1");
    setTestUser(20, { isOwner: false });

    // Wrong current password → 400.
    const wrong = await PATCH(
      new Request("http://test/", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "password",
          currentPassword: "wrong",
          newPassword: "new-password-1",
        }),
      }),
    );
    expect(wrong.status).toBe(400);

    // Correct current → 200, new password works.
    const ok = await PATCH(
      new Request("http://test/", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "password",
          currentPassword: "old-password-1",
          newPassword: "new-password-1",
        }),
      }),
    );
    expect(ok.status).toBe(200);

    const db = ctx.getDb();
    const after = await db.select().from(users).where(eq(users.id, 20));
    const verify = await verifyPassword("new-password-1", after[0].passwordHash!);
    expect(verify).toBe(true);

    setTestUser(1, { isOwner: true });
  });

  it("U3: change-password bumps password_hash_version (kill other sessions)", async () => {
    await seedCredentialsUser(20, "old-password-2");
    setTestUser(20, { isOwner: false });

    const db = ctx.getDb();
    const before = await db.select().from(users).where(eq(users.id, 20));
    const v0 = before[0].passwordHashVersion;

    await PATCH(
      new Request("http://test/", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "password",
          currentPassword: "old-password-2",
          newPassword: "new-password-2",
        }),
      }),
    );

    const after = await db.select().from(users).where(eq(users.id, 20));
    expect(after[0].passwordHashVersion).toBe(v0 + 1);

    setTestUser(1, { isOwner: true });
  });

  it("U4: regenerate HAE key returns plaintext + persists encrypted+hashed", async () => {
    setTestUser(1, { isOwner: true });
    const res = await PATCH(
      new Request("http://test/", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "hae-key" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const db = ctx.getDb();
    const rows = await db
      .select()
      .from(ingestConfigs)
      .where(eq(ingestConfigs.userId, 1));
    expect(rows).toHaveLength(1);
    expect(rows[0].encryptedValue).not.toBeNull();
    expect(rows[0].encryptedValue).not.toContain(body.token); // encrypted
    expect(rows[0].lookupHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("U5: owner DELETE refuses with 403", async () => {
    setTestUser(1, { isOwner: true });
    const res = await DELETE();
    expect(res.status).toBe(403);
  });

  it("U6: non-owner DELETE removes the user; coach_calls gets anonymized hash", async () => {
    await seedCredentialsUser(20, "throwaway-password");
    const db = ctx.getDb();
    // Plant a coach_calls row for user 20 so we can verify the
    // anonymization happens.
    await db.insert(coachCalls).values({
      userId: 20,
      endpoint: "test",
      model: "claude",
    });

    setTestUser(20, { isOwner: false, email: "u20@test" });
    const res = await DELETE();
    expect(res.status).toBe(200);

    // User row gone.
    const u = await db.select().from(users).where(eq(users.id, 20));
    expect(u).toHaveLength(0);

    // coach_calls row preserved (cascade ON DELETE SET NULL); the
    // user_id is null but deleted_user_hash carries sha256(email).
    const calls = await db.select().from(coachCalls);
    const orphans = calls.filter((c) => c.userId === null);
    expect(orphans).toHaveLength(1);
    expect(orphans[0].deletedUserHash).toMatch(/^[a-f0-9]{64}$/);

    setTestUser(1, { isOwner: true });
  });

  it("U7: unauth → 401 for every method", async () => {
    setTestUnauthenticated(true);
    try {
      expect((await GET()).status).toBe(401);
      expect(
        (await PATCH(new Request("http://test/", { method: "PATCH", body: "{}" }))).status,
      ).toBe(401);
      expect((await DELETE()).status).toBe(401);
    } finally {
      setTestUnauthenticated(false);
      setTestUser(1, { isOwner: true });
    }
  });
});
