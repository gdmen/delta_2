import { NextResponse } from "next/server";
import { clearTokens } from "@/lib/strava/client";

/**
 * POST /api/ingest/strava/disconnect
 * Drops stored tokens. Does NOT revoke the grant on Strava's side - user can
 * do that in Strava's connected-apps settings if desired.
 */
export async function POST() {
  // TODO(pr2-phase-4): replace with `user.id` from requireUserOr401.
  await clearTokens(1);
  return NextResponse.json({ ok: true });
}
