import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/db";
import { activities, dashboardShareTokens } from "@/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";
import { loadDashboard } from "@/lib/dashboards/load";
import { SLUG_PATTERN } from "@/lib/dashboards/slug";
import { requireUserOrSignin } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";
import { DashboardSettingsForm } from "./DashboardSettingsForm";

export const dynamic = "force-dynamic";

export default async function DashboardSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const user = await requireUserOrSignin();
  const { slug } = await params;
  if (!SLUG_PATTERN.test(slug)) notFound();

  const dashboard = await loadDashboard(slug, user.id);
  if (!dashboard) notFound();

  const activityRows = await db
    .select({ id: activities.id, name: activities.name, color: activities.color })
    .from(activities)
    .where(userScope(user.id).activities)
    .orderBy(asc(activities.name));

  // Active share token (if any). Direct DB read avoids an internal
  // HTTP round-trip; the API route uses the same query.
  const tokenRows = await db
    .select({ token: dashboardShareTokens.token })
    .from(dashboardShareTokens)
    .where(
      and(
        eq(dashboardShareTokens.dashboardId, dashboard.id),
        isNull(dashboardShareTokens.revokedAt),
      ),
    )
    .limit(1);
  const activeShareToken = tokenRows[0]?.token ?? null;

  const backHref = `/dashboards/${slug}`;

  return (
    <div className="max-w-[36rem]">
      <Link
        href={backHref}
        className="inline-block mb-4 text-[0.8125rem] text-muted hover:text-foreground"
      >
        ← Back to {dashboard.name}
      </Link>
      <h1 className="text-2xl font-semibold mb-2">{dashboard.name} settings</h1>
      {dashboard.isSystem && (
        <p className="text-[0.875rem] text-muted mb-6">
          This is a system dashboard. You can rename it and change the activity
          color, but its URL slug stays put and it can&apos;t be deleted.
        </p>
      )}
      <DashboardSettingsForm
        dashboard={dashboard}
        activities={activityRows}
        activeShareToken={activeShareToken}
      />
    </div>
  );
}
