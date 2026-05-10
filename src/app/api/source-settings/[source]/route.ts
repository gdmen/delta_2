import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sourceSettings } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getLastReconcile } from "@/lib/reconcile";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

/**
 * GET  /api/source-settings/:source - returns current toggle + last reconcile.
 * PATCH /api/source-settings/:source - body: { reconcileEnabled: boolean }.
 *
 * Source value is the `source` tag written to metrics/events
 * (lowercase + underscore-joined for custom sources, e.g. "fitnotes_bodyweight").
 */

async function readSettings(source: string, userId: number) {
  const rows = await db
    .select()
    .from(sourceSettings)
    .where(and(userScope(userId).sourceSettings, eq(sourceSettings.source, source)))
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
  const { user, error } = await requireUserOr401();
  if (error) return error;

  const { source } = await params;
  const settings = await readSettings(source, user.id);
  const lastReconcile = await getLastReconcile(source, user.id);
  return NextResponse.json({ ...settings, lastReconcile });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ source: string }> }
) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

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
      userId: user.id,
      source,
      reconcileEnabled: body.reconcileEnabled,
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: [sourceSettings.userId, sourceSettings.source],
      set: {
        reconcileEnabled: body.reconcileEnabled,
        updatedAt: new Date().toISOString(),
      },
    });

  return NextResponse.json(await readSettings(source, user.id));
}
