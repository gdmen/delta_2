import { notFound } from "next/navigation";
import { DashboardRenderer } from "@/components/dashboards/DashboardRenderer";
import { SLUG_PATTERN } from "@/lib/dashboards/slug";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ debug?: string; edit?: string }>;
}) {
  const { slug } = await params;
  // Defensive read-side check using the same pattern the mutation routes
  // enforce on write — keeps path oddities from reaching the DB.
  if (!SLUG_PATTERN.test(slug)) notFound();
  const { debug, edit } = await searchParams;
  const debugOn = debug === "1" || process.env.NODE_ENV !== "production";
  return <DashboardRenderer slug={slug} edit={edit === "1"} debug={debugOn} />;
}
