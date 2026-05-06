import { redirect } from "next/navigation";
import { db } from "@/db";
import { dashboards } from "@/db/schema";
import { asc } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Root route now redirects to the lowest-position dashboard. The
 * "Today" dashboard used to live here directly, but as of migration
 * 0023 it's gone — `/` is just a router. If no dashboards exist, send
 * the user to the create page so they're not staring at a 404.
 */
export default async function Home() {
  const rows = await db
    .select({ slug: dashboards.slug })
    .from(dashboards)
    .orderBy(asc(dashboards.position), asc(dashboards.id))
    .limit(1);
  if (rows.length === 0) redirect("/dashboards/new");
  redirect(`/dashboards/${rows[0].slug}`);
}
