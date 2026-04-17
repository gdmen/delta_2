import { NextRequest, NextResponse } from "next/server";
import { getEnv, StravaNotConfiguredError } from "@/lib/strava/client";
import { randomBytes } from "crypto";

/**
 * GET /api/ingest/strava/connect
 *
 * Starts the Strava OAuth dance by redirecting the user's browser to Strava's
 * authorize page. Strava will redirect back to /api/ingest/strava/callback
 * with a code + state.
 */
export async function GET(request: NextRequest) {
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

  // CSRF state: random token round-tripped through Strava and validated in the callback.
  const state = randomBytes(16).toString("hex");

  // The redirect URI has to match the Authorization Callback Domain in Strava's app settings.
  // Behind Nginx (our prod setup), request.nextUrl.origin resolves to the internal
  // http://localhost:3000 because Next.js doesn't automatically trust X-Forwarded-*
  // headers. We respect them explicitly here so the redirect_uri we hand to Strava
  // is the public HTTPS origin. Falls back to the incoming URL for local dev.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const host = forwardedHost ?? request.headers.get("host") ?? request.nextUrl.host;
  const proto = forwardedProto ?? request.nextUrl.protocol.replace(":", "");
  const origin = `${proto}://${host}`;
  const redirectUri = `${origin}/api/ingest/strava/callback`;

  const authUrl = new URL("https://www.strava.com/oauth/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("approval_prompt", "auto");
  authUrl.searchParams.set("scope", "read,activity:read_all");
  authUrl.searchParams.set("state", state);

  // Stash state in a short-lived cookie so the callback can verify it.
  const response = NextResponse.redirect(authUrl.toString());
  response.cookies.set("strava_oauth_state", state, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    maxAge: 300, // 5 minutes to complete the auth flow
    path: "/",
  });

  return response;
}
