import { db } from "@/db";
import { metrics, metricTypes } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { MetricsTable } from "./metrics-table";
import { DataTabShell } from "@/components/data-tab-shell";

export const dynamic = "force-dynamic";

export default async function DataPage() {
  const metricTypeRows = await db
    .select({
      id: metricTypes.id,
      name: metricTypes.name,
      unit: metricTypes.unit,
      count: sql<number>`count(${metrics.id})`,
      lastAt: sql<string>`max(${metrics.recordedAt})`,
    })
    .from(metricTypes)
    .leftJoin(metrics, eq(metrics.metricTypeId, metricTypes.id))
    .groupBy(metricTypes.id)
    .orderBy(sql`count(${metrics.id}) desc`);

  const rows = metricTypeRows.map((t) => ({
    id: t.id,
    name: t.name,
    unit: t.unit,
    count: Number(t.count),
    lastAt: t.lastAt,
  }));

  return (
    <DataTabShell
      active="metrics"
      description="Every row Delta has stored. Click a metric to view, edit, add, or delete data points."
      label="Metrics"
      count={{ value: rows.length, unit: "types" }}
    >
      <MetricsTable rows={rows} />
    </DataTabShell>
  );
}
