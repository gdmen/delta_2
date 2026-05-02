import { notFound } from "next/navigation";
import { DashboardRenderer } from "@/components/dashboards/DashboardRenderer";

export const dynamic = "force-dynamic";

/**
 * Defensive read-side enforcement of the same slug shape PR4's mutation
 * routes will require on write. Keeps `..`, whitespace, capital letters,
 * and other path oddities from reaching the DB lookup. Any non-conforming
 * slug 404s before any query runs.
 */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ debug?: string }>;
}) {
  const { slug } = await params;
  if (!SLUG_RE.test(slug)) notFound();
  const { debug } = await searchParams;
  const debugOn = debug === "1" || process.env.NODE_ENV !== "production";
  return <DashboardRenderer slug={slug} debug={debugOn} />;
}
