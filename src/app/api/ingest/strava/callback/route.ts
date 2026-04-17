import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, saveTokens } from "@/lib/strava/client";

/**
 * GET /api/ingest/strava/callback?code=...&state=...&scope=...
 *
 * Handles the redirect back from Strava after user authorization.
 * Verifies CSRF state, exchanges the code for tokens, persists them,
 * then redirects the user to /data-sources/strava with a status flag.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const error = params.get("error");

  // Respect forwarded headers (Nginx sets these) so we redirect back to the
  // public origin rather than internal localhost:3000.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const host = forwardedHost ?? request.headers.get("host") ?? request.nextUrl.host;
  const proto = forwardedProto ?? request.nextUrl.protocol.replace(":", "");
  const publicOrigin = `${proto}://${host}`;

  const destUrl = new URL("/data-sources/strava", publicOrigin);

  if (error) {
    destUrl.searchParams.set("status", "error");
    destUrl.searchParams.set("reason", error);
    return NextResponse.redirect(destUrl.toString());
  }

  // Verify CSRF state.
  const expectedState = request.cookies.get("strava_oauth_state")?.value;
  if (!expectedState || !state || state !== expectedState) {
    destUrl.searchParams.set("status", "error");
    destUrl.searchParams.set("reason", "state_mismatch");
    return NextResponse.redirect(destUrl.toString());
  }

  if (!code) {
    destUrl.searchParams.set("status", "error");
    destUrl.searchParams.set("reason", "missing_code");
    return NextResponse.redirect(destUrl.toString());
  }

  try {
    const tokens = await exchangeCode(code);
    await saveTokens(tokens);
  } catch (err) {
    destUrl.searchParams.set("status", "error");
    destUrl.searchParams.set("reason", "token_exchange_failed");
    destUrl.searchParams.set("detail", err instanceof Error ? err.message : String(err));
    const response = NextResponse.redirect(destUrl.toString());
    response.cookies.delete("strava_oauth_state");
    return response;
  }

  destUrl.searchParams.set("status", "connected");
  const response = NextResponse.redirect(destUrl.toString());
  response.cookies.delete("strava_oauth_state");
  return response;
}
