import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { dashboards, dashboardShareTokens } from "@/db/schema";
import { requireUserOr401 } from "@/lib/auth/require";

/**
 * POST   /api/dashboards/[id]/share — mint a fresh share token.
 * DELETE /api/dashboards/[id]/share — revoke the active token.
 *
 * Both require the SIGNED-IN owner of the dashboard. The
 * (dashboard_id) WHERE revoked_at IS NULL partial unique index in
 * the schema enforces "one active token per dashboard at a time"
 * — re-minting revokes the old one transactionally.
 *
 * Token format: 32 random bytes, base64url. 256 bits of entropy
 * makes brute-forcing infeasible at any realistic horizon.
 */

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function ownDashboard(userId: number, idStr: string) {
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id) || id <= 0) return null;
  const found = await db
    .select({ id: dashboards.id, userId: dashboards.userId })
    .from(dashboards)
    .where(and(eq(dashboards.id, id), eq(dashboards.userId, userId)))
    .limit(1);
  return found[0] ?? null;
}

export async function POST(_req: Request, ctx: RouteContext) {
  const { user, error } = await requireUserOr401();
  if (error) return error;
  const { id: idStr } = await ctx.params;

  const dash = await ownDashboard(user.id, idStr);
  if (!dash) {
    return NextResponse.json(
      { error: "dashboard not found" },
      { status: 404 },
    );
  }

  // Revoke any existing active token for this dashboard (the partial
  // unique index would otherwise block the new INSERT). Single
  // statement so the dashboard never has two active tokens
  // simultaneously.
  await db
    .update(dashboardShareTokens)
    .set({ revokedAt: new Date().toISOString() })
    .where(
      and(
        eq(dashboardShareTokens.dashboardId, dash.id),
        isNull(dashboardShareTokens.revokedAt),
      ),
    );

  // Mint the new token. 32 bytes base64url ≈ 43 chars.
  const token = randomBytes(32).toString("base64url");
  await db.insert(dashboardShareTokens).values({
    token,
    dashboardId: dash.id,
    createdByUserId: user.id,
  });

  return NextResponse.json({ token });
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  const { user, error } = await requireUserOr401();
  if (error) return error;
  const { id: idStr } = await ctx.params;

  const dash = await ownDashboard(user.id, idStr);
  if (!dash) {
    return NextResponse.json(
      { error: "dashboard not found" },
      { status: 404 },
    );
  }

  const result = await db
    .update(dashboardShareTokens)
    .set({ revokedAt: new Date().toISOString() })
    .where(
      and(
        eq(dashboardShareTokens.dashboardId, dash.id),
        isNull(dashboardShareTokens.revokedAt),
      ),
    )
    .returning({ token: dashboardShareTokens.token });

  return NextResponse.json({ ok: true, revoked: result.length });
}

export async function GET(_req: Request, ctx: RouteContext) {
  const { user, error } = await requireUserOr401();
  if (error) return error;
  const { id: idStr } = await ctx.params;

  const dash = await ownDashboard(user.id, idStr);
  if (!dash) {
    return NextResponse.json(
      { error: "dashboard not found" },
      { status: 404 },
    );
  }

  const rows = await db
    .select({
      token: dashboardShareTokens.token,
      createdAt: dashboardShareTokens.createdAt,
    })
    .from(dashboardShareTokens)
    .where(
      and(
        eq(dashboardShareTokens.dashboardId, dash.id),
        isNull(dashboardShareTokens.revokedAt),
      ),
    )
    .limit(1);

  return NextResponse.json({ active: rows[0] ?? null });
}
