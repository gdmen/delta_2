import { NextRequest, NextResponse } from "next/server";
import { loadUserTimezone, saveUserTimezone } from "@/lib/app-settings";

/**
 * GET /api/app-settings
 * Returns the resolved user TZ. Always succeeds — falls back to the
 * runtime default so the client can render even before the user has
 * picked anything.
 */
export async function GET() {
  const timezone = await loadUserTimezone();
  return NextResponse.json({ timezone });
}

/**
 * PATCH /api/app-settings
 * Body: { timezone: string | null }
 * - string: validated against `Intl.supportedValuesOf("timeZone")`.
 *   Bad values 400 (otherwise the formatter throws when the daily
 *   filter runs).
 * - null: clears the override; reads fall back to the runtime default.
 */
export async function PATCH(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || !("timezone" in body)) {
    return NextResponse.json({ error: "Body must include `timezone`" }, { status: 400 });
  }
  const { timezone } = body as { timezone: unknown };
  if (timezone !== null && typeof timezone !== "string") {
    return NextResponse.json(
      { error: "`timezone` must be a string IANA name or null" },
      { status: 400 },
    );
  }
  if (timezone !== null) {
    const supported = Intl.supportedValuesOf("timeZone");
    if (!supported.includes(timezone)) {
      return NextResponse.json(
        { error: `Unknown IANA timezone: ${timezone}` },
        { status: 400 },
      );
    }
  }
  await saveUserTimezone(timezone);
  return NextResponse.json({ timezone });
}
