import { NextResponse } from "next/server";
import { clearTokens } from "@/lib/strava/client";

/**
 * POST /api/ingest/strava/disconnect
 * Drops stored tokens. Does NOT revoke the grant on Strava's side — user can
 * do that in Strava's connected-apps settings if desired.
 */
export async function POST() {
  await clearTokens();
  return NextResponse.json({ ok: true });
}
