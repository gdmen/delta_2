import { NextResponse } from "next/server";
import { db } from "@/db";
import { dashboards, dashboardWidgets } from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { batchLayoutInput } from "@/lib/dashboards/validation";
import { readJson } from "@/lib/dashboards/request";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

interface Ctx {
  params: Promise<{ id: string }>;
}

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Batch layout update used during drag/resize. RGL/dnd-kit fires layout
 * changes with the entire grid state on every drag-end; this route accepts
 * one PATCH instead of N per-widget PATCHes.
 *
 * Each entry's id is verified to belong to this dashboard before applying;
 * an entry pointing at a widget on another dashboard is rejected wholesale.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const { user, error } = await requireUserOr401();
  if (error) return error;

  const { id: idRaw } = await params;
  const dashboardId = parseId(idRaw);
  if (dashboardId === null) return NextResponse.json({ error: "Invalid id." }, { status: 400 });

  // Confirm the dashboard belongs to this user before any work.
  const own = await db
    .select({ id: dashboards.id })
    .from(dashboards)
    .where(and(userScope(user.id).dashboards, eq(dashboards.id, dashboardId)))
    .limit(1);
  if (own.length === 0) {
    return NextResponse.json({ error: "Dashboard not found." }, { status: 404 });
  }

  const r = await readJson(req);
  if (!r.ok) return r.response;
  const parsed = batchLayoutInput.safeParse(r.value);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  // Defensive cross-check: every widget id must belong to this dashboard.
  // Without this, a malicious payload could mutate widget rows on other
  // dashboards by injecting their ids. dashboard_widgets is INHERIT —
  // also restrict via this user's owned dashboards.
  const ids = parsed.data.widgets.map((w) => w.id);
  const ownedDashboardIds = db
    .select({ id: dashboards.id })
    .from(dashboards)
    .where(userScope(user.id).dashboards);
  const owned = await db
    .select({ id: dashboardWidgets.id })
    .from(dashboardWidgets)
    .where(
      and(
        eq(dashboardWidgets.dashboardId, dashboardId),
        inArray(dashboardWidgets.dashboardId, ownedDashboardIds),
      ),
    );
  const ownedIds = new Set(owned.map((r) => r.id));
  const stray = ids.filter((id) => !ownedIds.has(id));
  if (stray.length > 0) {
    return NextResponse.json(
      { error: `Widget(s) not on this dashboard: ${stray.join(", ")}` },
      { status: 400 },
    );
  }

  // Apply updates one by one. better-sqlite3 + drizzle requires sync txn
  // callbacks (better-sqlite3 doesn't support async inside transactions) so
  // we just run them sequentially in autocommit mode — matches the pattern
  // already established in /api/dev/wipe-data.
  for (const w of parsed.data.widgets) {
    await db
      .update(dashboardWidgets)
      .set({ gridX: w.gridX, gridY: w.gridY, gridW: w.gridW, gridH: w.gridH })
      .where(
        and(
          eq(dashboardWidgets.id, w.id),
          eq(dashboardWidgets.dashboardId, dashboardId),
          inArray(dashboardWidgets.dashboardId, ownedDashboardIds),
        ),
      );
  }

  await db
    .update(dashboards)
    .set({ updatedAt: sql`(datetime('now'))` })
    .where(and(userScope(user.id).dashboards, eq(dashboards.id, dashboardId)));

  return NextResponse.json({ ok: true, updated: parsed.data.widgets.length });
}
