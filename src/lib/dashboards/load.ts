import { cache } from "react";
import { db } from "@/db";
import { dashboards, dashboardWidgets } from "@/db/schema";
import { asc, eq } from "drizzle-orm";

/**
 * React.cache: dedupe loads within a single request. Two server components
 * calling loadDashboard("recovery") on the same render share one DB hit.
 */
export const loadDashboard = cache(async (slug: string) => {
  const rows = await db.select().from(dashboards).where(eq(dashboards.slug, slug)).limit(1);
  return rows[0] ?? null;
});

export const loadWidgets = cache(async (dashboardId: number) => {
  return db
    .select()
    .from(dashboardWidgets)
    .where(eq(dashboardWidgets.dashboardId, dashboardId))
    .orderBy(asc(dashboardWidgets.position), asc(dashboardWidgets.gridY), asc(dashboardWidgets.gridX));
});

export const loadAllDashboards = cache(async () => {
  return db.select().from(dashboards).orderBy(asc(dashboards.position), asc(dashboards.id));
});

// Re-export types from row-types.ts so server-side callers don't need to
// know about the split. Client-side callers import from row-types directly
// to avoid Turbopack pulling `db` (better-sqlite3 → fs) into the client
// bundle.
export type { DashboardRow, WidgetRow } from "./row-types";
