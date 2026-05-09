import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { clearTokens } from "@/lib/strava/client";

/**
 * POST /api/ingest/strava/disconnect
 *
 * Drops stored tokens for the SIGNED-IN user. Does NOT revoke the
 * grant on Strava's side — user can do that in Strava's connected-
 * apps settings if desired.
 *
 * /api/ingest/* is exempt from the proxy session-cookie gate so we
 * call auth() ourselves; without this an unauth POST would clear
 * user_id=1's tokens by default (cross-user write).
 */
export async function POST() {
  const session = await auth();
  const userIdStr = session?.user?.id;
  const userId = userIdStr ? parseInt(userIdStr, 10) : NaN;
  if (!Number.isFinite(userId)) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  await clearTokens(userId);
  return NextResponse.json({ ok: true });
}
