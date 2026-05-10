import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/db";
import { oauthStates } from "@/db/schema";
import { auth } from "@/lib/auth/config";
import { getEnv, StravaNotConfiguredError } from "@/lib/strava/client";
import { publicOrigin } from "@/lib/auth/public-origin";

/**
 * GET /api/ingest/strava/connect
 *
 * Starts the Strava OAuth dance. Per the multi-user plan: the OAuth
 * `state` is now persisted in the `oauth_states` DB table (user_id-
 * bound) instead of a browser cookie. The previous cookie-based
 * approach couldn't bind state-to-user across the redirect — an
 * attacker could swap their own cookie before clicking through and
 * connect a different Strava account into someone else's row.
 *
 * Flow:
 *   1. requireUser (we need to know whose row to write tokens to).
 *   2. Generate random `state` token.
 *   3. INSERT INTO oauth_states (state, user_id, expires_at).
 *      5-minute TTL — Strava's auth UI is fast.
 *   4. Redirect to Strava's authorize endpoint with `state`.
 *
 * Callback verifies the state row, reads user_id from it, then
 * deletes the row (one-shot).
 *
 * NOTE: this endpoint is under /api/ingest/* which the proxy exempts
 * from cookie-gating (per the standard ingest pattern), so we have
 * to call auth() ourselves to get the user. Without auth() this
 * route would be reachable unauth and could spam state rows.
 */
export async function GET(request: NextRequest) {
  // Per-route auth. The proxy exempts /api/ingest/* from the
  // session-cookie gate, so we have to ask Auth.js directly.
  const session = await auth();
  const userIdStr = session?.user?.id;
  const userId = userIdStr ? parseInt(userIdStr, 10) : NaN;
  if (!Number.isFinite(userId)) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  let clientId: string;
  try {
    clientId = getEnv().clientId;
  } catch (err) {
    if (err instanceof StravaNotConfiguredError) {
      return NextResponse.json(
        { error: "Strava not configured. Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in .env.local and restart." },
        { status: 503 }
      );
    }
    throw err;
  }

  const state = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  // Persist state -> user binding. PK on `state` so collisions are
  // impossible (32 hex chars = 128 bits of entropy; collision odds
  // negligible in any realistic horizon).
  await db.insert(oauthStates).values({ state, userId, expiresAt });

  // Resolve the public origin from X-Forwarded-* but gate against
  // ALLOWED_PUBLIC_HOSTS so a spoofed header can't redirect Strava's
  // auth code to an attacker-controlled host. See public-origin.ts.
  let origin: string;
  try {
    origin = publicOrigin(request);
  } catch (err) {
    console.error("[strava/connect] publicOrigin rejected:", err);
    return NextResponse.json(
      { error: "host not allowed for OAuth redirect" },
      { status: 500 },
    );
  }
  const redirectUri = `${origin}/api/ingest/strava/callback`;

  const authUrl = new URL("https://www.strava.com/oauth/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("approval_prompt", "auto");
  authUrl.searchParams.set("scope", "read,activity:read_all");
  authUrl.searchParams.set("state", state);

  return NextResponse.redirect(authUrl.toString());
}
