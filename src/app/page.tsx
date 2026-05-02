import { DashboardRenderer } from "@/components/dashboards/DashboardRenderer";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ debug?: string }>;
}) {
  const { debug } = await searchParams;
  const debugOn = debug === "1" || process.env.NODE_ENV !== "production";
  return <DashboardRenderer slug="today" debug={debugOn} />;
}
