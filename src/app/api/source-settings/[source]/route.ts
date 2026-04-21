import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sourceSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getLastReconcile } from "@/lib/reconcile";

/**
 * GET  /api/source-settings/:source - returns current toggle + last reconcile.
 * PATCH /api/source-settings/:source - body: { reconcileEnabled: boolean }.
 *
 * Source value is the `source` tag written to metrics/events
 * (lowercase + underscore-joined for custom sources, e.g. "fitnotes_bodyweight").
 */

async function readSettings(source: string) {
  const rows = await db
    .select()
    .from(sourceSettings)
    .where(eq(sourceSettings.source, source))
    .limit(1);
  return {
    source,
    reconcileEnabled: rows[0]?.reconcileEnabled === true,
    updatedAt: rows[0]?.updatedAt ?? null,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ source: string }> }
) {
  const { source } = await params;
  const settings = await readSettings(source);
  const lastReconcile = await getLastReconcile(source);
  return NextResponse.json({ ...settings, lastReconcile });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ source: string }> }
) {
  const { source } = await params;

  let body: { reconcileEnabled?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.reconcileEnabled !== "boolean") {
    return NextResponse.json(
      { error: "reconcileEnabled must be a boolean" },
      { status: 400 }
    );
  }

  await db
    .insert(sourceSettings)
    .values({
      source,
      reconcileEnabled: body.reconcileEnabled,
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: sourceSettings.source,
      set: {
        reconcileEnabled: body.reconcileEnabled,
        updatedAt: new Date().toISOString(),
      },
    });

  return NextResponse.json(await readSettings(source));
}
