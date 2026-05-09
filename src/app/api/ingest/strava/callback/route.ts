import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { oauthStates } from "@/db/schema";
import { exchangeCode, saveTokens } from "@/lib/strava/client";

/**
 * GET /api/ingest/strava/callback?code=...&state=...
 *
 * Handles Strava's redirect after user authorization. Per the multi-
 * user plan, the OAuth `state` is now a row in `oauth_states`
 * (user_id-bound) instead of a cookie. This route:
 *
 *   1. Reads `state` from query.
 *   2. Looks it up in oauth_states; if not found OR expired → reject.
 *   3. Reads user_id from the row — that's the user this Strava
 *      account is being connected for.
 *   4. Exchanges the code for tokens and persists them on
 *      ingest_configs (user_id, source='strava').
 *   5. Deletes the oauth_states row (one-shot use).
 *
 * Strava itself sends no auth header (it's a server-to-browser
 * redirect), so this route is exempt from the proxy's session
 * cookie gate. The state row IS the auth — only a user who started
 * the flow has a matching state.
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

  if (!state) {
    destUrl.searchParams.set("status", "error");
    destUrl.searchParams.set("reason", "missing_state");
    return NextResponse.redirect(destUrl.toString());
  }

  // Look up the state row. If absent or expired, reject — the user
  // didn't initiate this flow (or the link is stale).
  const found = await db
    .select({ userId: oauthStates.userId, expiresAt: oauthStates.expiresAt })
    .from(oauthStates)
    .where(eq(oauthStates.state, state))
    .limit(1);
  const stateRow = found[0];

  if (!stateRow) {
    destUrl.searchParams.set("status", "error");
    destUrl.searchParams.set("reason", "state_mismatch");
    return NextResponse.redirect(destUrl.toString());
  }

  if (stateRow.expiresAt < new Date().toISOString()) {
    // Expired — clean up and reject.
    await db.delete(oauthStates).where(eq(oauthStates.state, state));
    destUrl.searchParams.set("status", "error");
    destUrl.searchParams.set("reason", "state_expired");
    return NextResponse.redirect(destUrl.toString());
  }

  if (!code) {
    destUrl.searchParams.set("status", "error");
    destUrl.searchParams.set("reason", "missing_code");
    return NextResponse.redirect(destUrl.toString());
  }

  const userId = stateRow.userId;

  try {
    const tokens = await exchangeCode(code);
    await saveTokens(tokens, userId);
  } catch (err) {
    // Lazy-delete the state row even on token-exchange failure so a
    // retry doesn't replay the dead state.
    await db.delete(oauthStates).where(eq(oauthStates.state, state));
    destUrl.searchParams.set("status", "error");
    destUrl.searchParams.set("reason", "token_exchange_failed");
    destUrl.searchParams.set("detail", err instanceof Error ? err.message : String(err));
    return NextResponse.redirect(destUrl.toString());
  }

  // One-shot: delete the state row.
  await db.delete(oauthStates).where(eq(oauthStates.state, state));

  destUrl.searchParams.set("status", "connected");
  return NextResponse.redirect(destUrl.toString());
}
