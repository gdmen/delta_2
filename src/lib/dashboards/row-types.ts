import type { InferSelectModel } from "drizzle-orm";
import { dashboards, dashboardWidgets } from "@/db/schema";

/**
 * Row types derived directly from the Drizzle table schemas, without
 * pulling in `@/db` (which imports postgres-js — a server-only
 * driver). Client components import these instead of the row types
 * declared in `load.ts` so Turbopack doesn't try to resolve `net` etc.
 * into the client bundle.
 */
export type DashboardRow = InferSelectModel<typeof dashboards>;
export type WidgetRow = InferSelectModel<typeof dashboardWidgets>;
