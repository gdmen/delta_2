import { db } from "@/db";
import { ingestConfigs } from "@/db/schema";
import { eq } from "drizzle-orm";

// Strava's stored config blob, stashed JSON-encoded in ingest_configs.api_key_encrypted.
// (Not actually encrypted yet - the column name is aspirational. Fine for single-user self-host.)
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
export async function loadTokens(): Promise<StravaTokens | null> {
  const rows = await db
    .select()
    .from(ingestConfigs)
    .where(eq(ingestConfigs.source, "strava"))
    .limit(1);

  if (rows.length === 0) return null;
  const blob = rows[0].apiKeyEncrypted;
  if (!blob) return null;
  try {
    return JSON.parse(blob) as StravaTokens;
  } catch {
    return null;
  }
}

/** Persist tokens. Upserts on source=strava. */
export async function saveTokens(tokens: StravaTokens, lastSyncAt?: string): Promise<void> {
  const payload = JSON.stringify(tokens);
  const existing = await db
    .select({ id: ingestConfigs.id })
    .from(ingestConfigs)
    .where(eq(ingestConfigs.source, "strava"))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(ingestConfigs).values({
      source: "strava",
      apiKeyEncrypted: payload,
      lastSyncAt: lastSyncAt ?? null,
      enabled: true,
    });
  } else {
    const updates: Partial<typeof ingestConfigs.$inferInsert> = { apiKeyEncrypted: payload };
    if (lastSyncAt !== undefined) updates.lastSyncAt = lastSyncAt;
    await db.update(ingestConfigs).set(updates).where(eq(ingestConfigs.source, "strava"));
  }
}

/** Drop stored tokens (disconnect). */
export async function clearTokens(): Promise<void> {
  await db.delete(ingestConfigs).where(eq(ingestConfigs.source, "strava"));
}

/** Update just last_sync_at. */
export async function touchLastSync(): Promise<void> {
  await db
    .update(ingestConfigs)
    .set({ lastSyncAt: new Date().toISOString() })
    .where(eq(ingestConfigs.source, "strava"));
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
export async function refreshTokens(tokens: StravaTokens): Promise<StravaTokens> {
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
  await saveTokens(refreshed);
  return refreshed;
}

/** Get a valid access token, refreshing if within 60 seconds of expiry. */
export async function getValidAccessToken(): Promise<string> {
  const tokens = await loadTokens();
  if (!tokens) throw new StravaNotConnectedError();
  const nowSec = Math.floor(Date.now() / 1000);
  if (tokens.expires_at - nowSec < 60) {
    const fresh = await refreshTokens(tokens);
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
export async function* iterateActivities(afterUnix: number = 0): AsyncGenerator<StravaActivity> {
  const token = await getValidAccessToken();
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
