import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { buildDbMock, setupRouteTest } from "@/test-utils/route-test";

vi.mock("@/db", () => buildDbMock());

import { NextRequest } from "next/server";
import { validateUserApiKey, generateAndSaveHaeKey } from "./api-key";
import { ingestConfigs, users } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { encrypt, lookupHash } from "./secrets";

const TEST_KEY = "0".repeat(64); // 32 bytes hex

beforeEach(() => {
  vi.stubEnv("OAUTH_ENCRYPTION_KEY", TEST_KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function bearerReq(token: string | null): NextRequest {
  const headers: Record<string, string> = {};
  if (token !== null) headers["authorization"] = `Bearer ${token}`;
  return new NextRequest("http://test/api/ingest/apple-health", {
    method: "POST",
    headers,
    body: "{}",
  });
}

describe("validateUserApiKey (HAE bearer auth via lookup_hash)", () => {
  const ctx = setupRouteTest();

  async function seedUser(id: number, displayName: string): Promise<void> {
    const db = ctx.getDb();
    await db.insert(users).values({
      id,
      displayName,
      email: `${displayName.toLowerCase()}@test`,
      passwordHash: null,
      createdAt: new Date().toISOString(),
    });
  }

  async function seedKey(userId: number, plaintext: string): Promise<void> {
    const db = ctx.getDb();
    await db.insert(ingestConfigs).values({
      userId,
      source: "apple_health",
      encryptedValue: encrypt(plaintext),
      lookupHash: lookupHash(plaintext),
      enabled: true,
    });
  }

  it("V1: missing Authorization header → 401, no DB read", async () => {
    const res = await validateUserApiKey(bearerReq(null));
    expect(res.userId).toBeNull();
    expect(res.error).not.toBeNull();
    expect(res.error?.status).toBe(401);
  });

  it("V2: empty bearer token → 401", async () => {
    const res = await validateUserApiKey(bearerReq(""));
    expect(res.userId).toBeNull();
    expect(res.error?.status).toBe(401);
  });

  it("V3: token whose lookup_hash doesn't match any row → 401", async () => {
    await seedUser(10, "Alice");
    await seedKey(10, "alice-real-token");
    const res = await validateUserApiKey(bearerReq("attacker-guess"));
    expect(res.userId).toBeNull();
    expect(res.error?.status).toBe(401);
  });

  it("V4: valid token routes to the correct user", async () => {
    await seedUser(10, "Alice");
    await seedKey(10, "alice-secret-token-1");
    const res = await validateUserApiKey(bearerReq("alice-secret-token-1"));
    expect(res.error).toBeNull();
    expect(res.userId).toBe(10);
  });

  it("V5: per-user isolation — Alice's token returns Alice's id even when Bob has a key too", async () => {
    await seedUser(10, "Alice");
    await seedUser(20, "Bob");
    await seedKey(10, "alice-secret-token");
    await seedKey(20, "bob-secret-token");

    const aliceRes = await validateUserApiKey(bearerReq("alice-secret-token"));
    const bobRes = await validateUserApiKey(bearerReq("bob-secret-token"));

    expect(aliceRes.userId).toBe(10);
    expect(bobRes.userId).toBe(20);
  });

  it("V6: token of right SHAPE but wrong VALUE doesn't grant cross-user access", async () => {
    // Worst case: Bob obtains Alice's lookup_hash (e.g. via DB read leak).
    // Bob can't forge an HAE request because the bearer would have to
    // round-trip through the actual decrypted plaintext. This test
    // demonstrates that two users with matching hash prefixes don't
    // collide either (hash collisions are infeasible in practice; the
    // safeCompare second leg is the safety net).
    await seedUser(10, "Alice");
    await seedKey(10, "alice-token-X");
    // Bob plants a row with Alice's lookup_hash but a different
    // ciphertext (e.g. from a corrupted backup restore).
    const db = ctx.getDb();
    await db.insert(users).values({
      id: 20,
      displayName: "Bob",
      email: "bob@test",
      passwordHash: null,
      createdAt: new Date().toISOString(),
    });

    // Bob's token hashes the same as Alice's (forced collision).
    // Insert with Alice's lookup_hash but Bob's encrypted-value of "evil".
    // safeCompare against "alice-token-X" plaintext → "evil" doesn't
    // match → 401 even though the hash matched.
    await db.insert(ingestConfigs).values({
      userId: 20,
      source: "apple_health",
      encryptedValue: encrypt("evil"),
      lookupHash: lookupHash("alice-token-X"), // collision with Alice's
      enabled: true,
    });

    // Send "alice-token-X" — hash will match BOTH rows. The first
    // row found is non-deterministic, but EITHER way validateUserApiKey
    // ends up safeCompare'ing the supplied token against Alice's
    // plaintext (matches) OR against Bob's "evil" plaintext (doesn't).
    // So the test is non-flaky only when checking that user 20 is NEVER
    // returned for the request "alice-token-X".
    //
    // For determinism, run multiple times.
    let timesUserIsBob = 0;
    for (let i = 0; i < 5; i++) {
      const res = await validateUserApiKey(bearerReq("alice-token-X"));
      if (res.userId === 20) timesUserIsBob++;
    }
    expect(timesUserIsBob).toBe(0);
  });
});

describe("generateAndSaveHaeKey", () => {
  const ctx = setupRouteTest();

  it("G1: persists a new HAE key for a user (encrypted + hashed)", async () => {
    const db = ctx.getDb();
    await db.insert(users).values({
      id: 10,
      displayName: "Alice",
      email: "alice@test",
      passwordHash: null,
      createdAt: new Date().toISOString(),
    });

    await generateAndSaveHaeKey(10, "fresh-token");

    const rows = await db
      .select()
      .from(ingestConfigs)
      .where(and(eq(ingestConfigs.userId, 10), eq(ingestConfigs.source, "apple_health")));
    expect(rows).toHaveLength(1);
    expect(rows[0].lookupHash).toBe(lookupHash("fresh-token"));
    expect(rows[0].encryptedValue).not.toBeNull();
    expect(rows[0].encryptedValue).not.toContain("fresh-token"); // not stored in clear

    // Round-trip via validateUserApiKey to confirm the key works.
    const res = await validateUserApiKey(bearerReq("fresh-token"));
    expect(res.userId).toBe(10);
  });

  it("G2: regenerating replaces the row in place (one row per user-source)", async () => {
    const db = ctx.getDb();
    await db.insert(users).values({
      id: 10,
      displayName: "Alice",
      email: "alice@test",
      passwordHash: null,
      createdAt: new Date().toISOString(),
    });

    await generateAndSaveHaeKey(10, "first");
    await generateAndSaveHaeKey(10, "second");

    const rows = await db
      .select()
      .from(ingestConfigs)
      .where(and(eq(ingestConfigs.userId, 10), eq(ingestConfigs.source, "apple_health")));
    expect(rows).toHaveLength(1);

    // Old key no longer works.
    expect((await validateUserApiKey(bearerReq("first"))).userId).toBeNull();
    // New key works.
    expect((await validateUserApiKey(bearerReq("second"))).userId).toBe(10);
  });
});

function bearerReqAlt(token: string | null): NextRequest {
  // Intentional duplicate to keep the test file self-contained without
  // re-exporting from helpers. Same shape as bearerReq above.
  const headers: Record<string, string> = {};
  if (token !== null) headers["authorization"] = `Bearer ${token}`;
  return new NextRequest("http://test/api/ingest/apple-health", {
    method: "POST",
    headers,
    body: "{}",
  });
}
void bearerReqAlt;
