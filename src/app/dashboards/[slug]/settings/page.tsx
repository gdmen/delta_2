import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/db";
import { sports } from "@/db/schema";
import { asc } from "drizzle-orm";
import { loadDashboard } from "@/lib/dashboards/load";
import { SLUG_PATTERN } from "@/lib/dashboards/slug";
import { DashboardSettingsForm } from "./DashboardSettingsForm";

export const dynamic = "force-dynamic";

export default async function DashboardSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!SLUG_PATTERN.test(slug)) notFound();

  const dashboard = await loadDashboard(slug);
  if (!dashboard) notFound();

  const sportRows = await db
    .select({ id: sports.id, name: sports.name, color: sports.color })
    .from(sports)
    .orderBy(asc(sports.name));

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
          This is a system dashboard. You can rename it and change the sport
          color, but its URL slug stays put and it can&apos;t be deleted.
        </p>
      )}
      <DashboardSettingsForm dashboard={dashboard} sports={sportRows} />
    </div>
  );
}
