import { cache } from "react";
import { db } from "@/db";
import { dashboards, dashboardWidgets } from "@/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { userScope } from "@/lib/auth/scope";

/**
 * React.cache: dedupe loads within a single request. Two server components
 * calling loadDashboard("recovery", uid) on the same render share one DB hit.
 *
 * Cache is keyed on the function arguments — passing userId in keeps the
 * dedupe per-(slug, user) so a shared render across users doesn't leak.
 */
export const loadDashboard = cache(async (slug: string, userId: number) => {
  const rows = await db
    .select()
    .from(dashboards)
    .where(and(userScope(userId).dashboards, eq(dashboards.slug, slug)))
    .limit(1);
  return rows[0] ?? null;
});

/**
 * dashboard_widgets is an INHERIT table — it has no user_id of its own.
 * Defense-in-depth: sub-select the user's dashboard ids, restrict to
 * those, then match dashboardId. The dashboardId restriction alone is
 * necessary-but-not-sufficient: if a future bug let a request pass a
 * dashboardId that doesn't belong to the user, this `inArray` blocks the
 * read.
 */
export const loadWidgets = cache(async (dashboardId: number, userId: number) => {
  const ownedDashboardIds = db
    .select({ id: dashboards.id })
    .from(dashboards)
    .where(userScope(userId).dashboards);
  return db
    .select()
    .from(dashboardWidgets)
    .where(
      and(
        eq(dashboardWidgets.dashboardId, dashboardId),
        inArray(dashboardWidgets.dashboardId, ownedDashboardIds),
      ),
    )
    .orderBy(asc(dashboardWidgets.position), asc(dashboardWidgets.gridY), asc(dashboardWidgets.gridX));
});

export const loadAllDashboards = cache(async (userId: number) => {
  return db
    .select()
    .from(dashboards)
    .where(userScope(userId).dashboards)
    .orderBy(asc(dashboards.position), asc(dashboards.id));
});

// Re-export types from row-types.ts so server-side callers don't need to
// know about the split. Client-side callers import from row-types directly
// to avoid Turbopack pulling `db` (postgres-js → net) into the client
// bundle.
export type { DashboardRow, WidgetRow } from "./row-types";
