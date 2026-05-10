import { db } from "@/db";
import { ingestConfigs } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { encrypt, decrypt } from "@/lib/auth/secrets";

// Strava's stored config blob, AES-256-GCM encrypted in
// ingest_configs.encrypted_value. saveTokens encrypts on write;
// loadTokens decrypts on read. Decrypt failures (tag mismatch,
// wrong key) propagate as DecryptError; the route layer surfaces
// "Strava not connected" so the user re-runs OAuth instead of
// trying to figure out a crypto error.
export interface StravaTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix seconds
  athlete_id: number;
  athlete_name?: string;
}

// Strava activity shape - only the fields we actually use.
export interface StravaActivity {
  id: number;
  name: string;
  type: string;
  sport_type?: string;
  start_date: string; // ISO 8601
  elapsed_time: number; // seconds
  moving_time: number; // seconds
  distance: number; // meters
  total_elevation_gain?: number;
  average_speed?: number;
  max_speed?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  description?: string;
}

const STRAVA_OAUTH_URL = "https://www.strava.com/oauth/token";
const STRAVA_API_BASE = "https://www.strava.com/api/v3";

export class StravaNotConfiguredError extends Error {
  constructor() {
    super("Strava env vars not configured. Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET.");
  }
}

export class StravaNotConnectedError extends Error {
  constructor() {
    super("Strava not connected. Run the OAuth flow first.");
  }
}

export function getEnv(): { clientId: string; clientSecret: string } {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new StravaNotConfiguredError();
  return { clientId, clientSecret };
}

/** Read the stored tokens from the DB. Returns null if not connected. */
export async function loadTokens(userId: number): Promise<StravaTokens | null> {
  const rows = await db
    .select()
    .from(ingestConfigs)
    .where(and(eq(ingestConfigs.userId, userId), eq(ingestConfigs.source, "strava")))
    .limit(1);

  if (rows.length === 0) return null;
  const blob = rows[0].encryptedValue;
  if (!blob) return null;
  try {
    const plaintext = decrypt(blob);
    return JSON.parse(plaintext) as StravaTokens;
  } catch (err) {
    // Either decrypt failed (tampered or wrong key) or JSON parse
    // failed (legacy un-encrypted row from before this commit).
    // Returning null surfaces as "Strava not connected" — user
    // re-OAuths and the row gets rewritten as encrypted. Log so
    // tampering doesn't go silent: a normal "user is just not
    // connected" hits the rows.length === 0 branch above, never
    // this one.
    console.error(
      `[strava/loadTokens] decrypt/parse failed for user ${userId}:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/** Persist tokens. Upserts on (user_id, source=strava). */
export async function saveTokens(tokens: StravaTokens, userId: number, lastSyncAt?: string): Promise<void> {
  const payload = encrypt(JSON.stringify(tokens));
  const existing = await db
    .select({ id: ingestConfigs.id })
    .from(ingestConfigs)
    .where(and(eq(ingestConfigs.userId, userId), eq(ingestConfigs.source, "strava")))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(ingestConfigs).values({
      userId,
      source: "strava",
      encryptedValue: payload,
      lastSyncAt: lastSyncAt ?? null,
      enabled: true,
    });
  } else {
    const updates: Partial<typeof ingestConfigs.$inferInsert> = { encryptedValue: payload };
    if (lastSyncAt !== undefined) updates.lastSyncAt = lastSyncAt;
    await db
      .update(ingestConfigs)
      .set(updates)
      .where(and(eq(ingestConfigs.userId, userId), eq(ingestConfigs.source, "strava")));
  }
}

/** Drop stored tokens (disconnect). */
export async function clearTokens(userId: number): Promise<void> {
  await db
    .delete(ingestConfigs)
    .where(and(eq(ingestConfigs.userId, userId), eq(ingestConfigs.source, "strava")));
}

/** Update just last_sync_at. */
export async function touchLastSync(userId: number): Promise<void> {
  await db
    .update(ingestConfigs)
    .set({ lastSyncAt: new Date().toISOString() })
    .where(and(eq(ingestConfigs.userId, userId), eq(ingestConfigs.source, "strava")));
}

/** Exchange an authorization code for a token pair. */
export async function exchangeCode(code: string): Promise<StravaTokens> {
  const { clientId, clientSecret } = getEnv();
  const res = await fetch(STRAVA_OAUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Strava token exchange failed: ${res.status} ${text}`);
  }
  const json = await res.json();
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: json.expires_at,
    athlete_id: json.athlete?.id,
    athlete_name:
      json.athlete?.firstname || json.athlete?.lastname
        ? `${json.athlete?.firstname ?? ""} ${json.athlete?.lastname ?? ""}`.trim()
        : undefined,
  };
}

/** Refresh an expiring access token. Persists the new tokens. */
export async function refreshTokens(tokens: StravaTokens, userId: number): Promise<StravaTokens> {
  const { clientId, clientSecret } = getEnv();
  const res = await fetch(STRAVA_OAUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Strava token refresh failed: ${res.status} ${text}`);
  }
  const json = await res.json();
  const refreshed: StravaTokens = {
    ...tokens,
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: json.expires_at,
  };
  await saveTokens(refreshed, userId);
  return refreshed;
}

/** Get a valid access token, refreshing if within 60 seconds of expiry. */
export async function getValidAccessToken(userId: number): Promise<string> {
  const tokens = await loadTokens(userId);
  if (!tokens) throw new StravaNotConnectedError();
  const nowSec = Math.floor(Date.now() / 1000);
  if (tokens.expires_at - nowSec < 60) {
    const fresh = await refreshTokens(tokens, userId);
    return fresh.access_token;
  }
  return tokens.access_token;
}

/**
 * Fetch athlete activities with automatic pagination and token refresh.
 * Returns activities sorted newest-first by the API (we re-sort in caller).
 *
 * `after` is a Unix timestamp in seconds; only activities started after this
 * time are returned. Pass 0 for "everything". Strava's per_page cap is 200.
 */
export async function* iterateActivities(userId: number, afterUnix: number = 0): AsyncGenerator<StravaActivity> {
  const token = await getValidAccessToken(userId);
  let page = 1;
  const perPage = 100;

  while (true) {
    const url = new URL(`${STRAVA_API_BASE}/athlete/activities`);
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));
    if (afterUnix > 0) url.searchParams.set("after", String(afterUnix));

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 429) {
      // Rate limited. Strava's limits are 200/15min + 2000/day.
      const retryAfter = Number(res.headers.get("retry-after") ?? "60");
      throw new Error(`Strava rate limit hit. Retry after ${retryAfter}s.`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Strava activities fetch failed: ${res.status} ${text}`);
    }

    const batch = (await res.json()) as StravaActivity[];
    if (batch.length === 0) return;

    for (const a of batch) yield a;

    if (batch.length < perPage) return;
    page++;

    // Defensive: stop after many pages to avoid runaway.
    if (page > 50) return;
  }
}
