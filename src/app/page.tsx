import { DashboardRenderer } from "@/components/dashboards/DashboardRenderer";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ debug?: string; edit?: string }>;
}) {
  const { debug, edit } = await searchParams;
  const debugOn = debug === "1" || process.env.NODE_ENV !== "production";
  return <DashboardRenderer slug="today" edit={edit === "1"} debug={debugOn} />;
}
