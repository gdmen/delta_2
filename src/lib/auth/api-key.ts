import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { ingestConfigs } from "@/db/schema";
import { lookupHash, safeCompare, decrypt } from "./secrets";

/**
 * HAE (Apple Health) bearer-token validation against the per-user
 * ingest_configs row. Replaces the legacy single INGEST_API_KEY env
 * var — multi-user requires per-user keys so the iOS Shortcut bound
 * to user A's key can't write into user B's metrics.
 *
 * Flow per the eng-review CRITICAL finding on HAE lookup:
 *
 *   1. Parse `Authorization: Bearer <token>` header. 401 on missing
 *      or malformed.
 *   2. Compute sha256(token) = lookup_hash.
 *   3. SELECT user_id, encrypted_value FROM ingest_configs
 *      WHERE source='apple_health' AND lookup_hash=?
 *      (Indexed; O(log n).)
 *   4. Decrypt encrypted_value (AES-256-GCM, throws on tag mismatch).
 *      Constant-time-compare to the supplied bearer token as a
 *      defense-in-depth check that the lookup_hash maps to the same
 *      plaintext.
 *   5. Return { userId, error: null } on success;
 *      { userId: null, error: NextResponse } on any failure.
 *
 * Why both lookup_hash AND constant-time compare:
 *
 *   - lookup_hash gives us O(log n) equality lookup. Without it we'd
 *     have to scan + decrypt every row, which is a) slow and b) leaks
 *     timing info per row.
 *   - sha256 is collision-resistant but not authentication. The
 *     decrypt+compare is the actual auth — confirms the supplied
 *     bytes match what's stored, not just that they hash the same.
 *     Belt + suspenders.
 *
 * Failure modes — all return generic 401 (no enumeration leak):
 *   - missing Authorization header
 *   - non-Bearer scheme
 *   - empty token
 *   - lookup_hash miss (no row)
 *   - decrypt failure (tag mismatch)
 *   - constant-time compare mismatch (lookup_hash collision; lottery-
 *     ticket-rare for sha256, but the safety net catches it)
 */

export interface ValidatedHaeKey {
  userId: number;
}

export async function validateUserApiKey(
  request: NextRequest,
): Promise<{ userId: number; error: null } | { userId: null; error: NextResponse }> {
  const authHeader = request.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return {
      userId: null,
      error: NextResponse.json(
        { error: "Missing Authorization header. Use: Bearer <api-key>" },
        { status: 401 },
      ),
    };
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return {
      userId: null,
      error: NextResponse.json({ error: "Empty bearer token" }, { status: 401 }),
    };
  }

  const hash = lookupHash(token);
  let row: { userId: number; encryptedValue: string | null } | undefined;
  try {
    const found = await db
      .select({
        userId: ingestConfigs.userId,
        encryptedValue: ingestConfigs.encryptedValue,
      })
      .from(ingestConfigs)
      .where(
        and(
          eq(ingestConfigs.source, "apple_health"),
          eq(ingestConfigs.lookupHash, hash),
        ),
      )
      .limit(1);
    row = found[0];
  } catch {
    // DB blip — fail closed. 503 instead of 401 so the iOS Shortcut
    // retries (the user's data isn't lost; the request just retries
    // when the DB is back).
    return {
      userId: null,
      error: NextResponse.json({ error: "Service temporarily unavailable" }, { status: 503 }),
    };
  }

  if (!row) {
    return {
      userId: null,
      error: NextResponse.json({ error: "Invalid API key" }, { status: 401 }),
    };
  }

  if (!row.encryptedValue) {
    // Hash matched but no ciphertext — corrupt row, treat as missing.
    return {
      userId: null,
      error: NextResponse.json({ error: "Invalid API key" }, { status: 401 }),
    };
  }

  let plaintext: string;
  try {
    plaintext = decrypt(row.encryptedValue);
  } catch {
    // Decryption failed — possibly a key-rotation event or tampering.
    // Generic 401, log somewhere if instrumented.
    return {
      userId: null,
      error: NextResponse.json({ error: "Invalid API key" }, { status: 401 }),
    };
  }

  if (!safeCompare(plaintext, token)) {
    // sha256 collision (or someone got the lookup_hash and tried to
    // forge a request with a different token). Generic 401.
    return {
      userId: null,
      error: NextResponse.json({ error: "Invalid API key" }, { status: 401 }),
    };
  }

  return { userId: row.userId, error: null };
}

/**
 * Generate + persist a fresh HAE bearer token for a user. Returns
 * the plaintext token for one-time display to the user. The
 * encrypted value + lookup_hash are stored on ingest_configs;
 * regenerate via /preferences/account replaces the stored row in
 * place (preserving the user_id, last_sync_at, enabled fields).
 */
export async function generateAndSaveHaeKey(
  userId: number,
  plaintext: string,
): Promise<void> {
  const { encrypt } = await import("./secrets");
  const encryptedValue = encrypt(plaintext);
  const hash = lookupHash(plaintext);

  // Upsert: per-user uniqueness on (user_id, source).
  const existing = await db
    .select({ id: ingestConfigs.id })
    .from(ingestConfigs)
    .where(
      and(eq(ingestConfigs.userId, userId), eq(ingestConfigs.source, "apple_health")),
    )
    .limit(1);

  if (existing.length === 0) {
    await db.insert(ingestConfigs).values({
      userId,
      source: "apple_health",
      encryptedValue,
      lookupHash: hash,
      enabled: true,
    });
  } else {
    await db
      .update(ingestConfigs)
      .set({ encryptedValue, lookupHash: hash, enabled: true })
      .where(
        and(eq(ingestConfigs.userId, userId), eq(ingestConfigs.source, "apple_health")),
      );
  }
}
