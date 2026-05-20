import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { metricTypes } from "@/db/schema";
import { and, inArray } from "drizzle-orm";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

const VALID_FREQUENCY_HINTS = ["daily", "weekly", "occasional"] as const;

interface BulkFrequencyBody {
  ids: number[];
  frequencyHint: "daily" | "weekly" | "occasional";
}

/**
 * POST /api/metric-types/bulk-frequency
 *
 * Bulk-update `frequency_hint` across many metric_type rows in one
 * round-trip. The per-row PATCH endpoint at
 * `src/app/api/metric-types/[id]/route.ts` is fine for one-at-a-time
 * edits from the metric-detail page; this endpoint is what the
 * `/data` metrics catalog uses when the user multi-selects rows and
 * clicks "Reclassify N selected".
 *
 * The motivating case: every `bodyspec_dexa:*` metric_type is
 * auto-created with `frequency_hint = "daily"` by the resolver
 * (`src/lib/ingest/metric-resolver.ts:138`), which is right for
 * Apple Health steps + Strava sport_minutes but wrong for
 * point-in-time DEXA scans. There are ~55 such rows, so a per-row
 * UI is tedious; this endpoint reclassifies them in one shot.
 *
 * Per-user scoping: the UPDATE filters on `userScope.metricTypes` so
 * the caller can only touch rows they own. IDs that don't match
 * (wrong user, or don't exist) are silently dropped — the response's
 * `updated` count tells the caller how many actually changed.
 */
export async function POST(request: NextRequest) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  let body: BulkFrequencyBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return NextResponse.json(
      { error: "ids must be a non-empty array of metric_type ids" },
      { status: 400 },
    );
  }
  if (!body.ids.every((id) => typeof id === "number" && Number.isFinite(id))) {
    return NextResponse.json(
      { error: "ids must all be finite numbers" },
      { status: 400 },
    );
  }
  if (
    typeof body.frequencyHint !== "string" ||
    !(VALID_FREQUENCY_HINTS as readonly string[]).includes(body.frequencyHint)
  ) {
    return NextResponse.json(
      {
        error: `frequencyHint must be one of: ${VALID_FREQUENCY_HINTS.join(", ")}`,
      },
      { status: 400 },
    );
  }

  // Cap on `ids.length` keeps a runaway client from sending a 100K-item
  // payload that locks the table for seconds. The /data catalog can hold
  // a few thousand metric_types at most; 2K is well above any realistic
  // multi-select.
  if (body.ids.length > 2000) {
    return NextResponse.json(
      { error: "Too many ids in one request (max 2000)" },
      { status: 400 },
    );
  }

  const result = await db
    .update(metricTypes)
    .set({ frequencyHint: body.frequencyHint })
    .where(
      and(
        userScope(user.id).metricTypes,
        inArray(metricTypes.id, body.ids),
      ),
    )
    .returning({ id: metricTypes.id });

  const updatedIds = new Set(result.map((r) => r.id));
  const skipped = body.ids.filter((id) => !updatedIds.has(id));

  return NextResponse.json({
    updated: result.length,
    skipped,
  });
}
