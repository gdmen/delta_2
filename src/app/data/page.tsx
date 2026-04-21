import { db } from "@/db";
import { metrics, metricTypes } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { MetricsTable } from "./metrics-table";
import { DataTabs } from "./tabs";
import { ImportExportBar } from "./import-export-bar";

export const dynamic = "force-dynamic";

/**
 * Data browser — Metrics tab. Lists every metric_type with row counts
 * and last-seen. Click a row to drill into its full history + CRUD.
 */
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

  return (
    <div className="max-w-[1100px]">
      <h1 className="text-2xl font-semibold mb-2">Data</h1>
      <p className="text-[0.875rem] text-text-secondary mb-6">
        Every row Delta has stored. Click a metric to view, edit, add, or delete data points.
      </p>

      <div className="mb-8">
        <ImportExportBar />
      </div>

      <DataTabs active="metrics" />

      <div className="flex items-baseline justify-between mb-3">
        <span className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">
          Metrics
        </span>
        <span className="font-mono text-[0.6875rem] text-muted">
          {metricTypeRows.length} types
        </span>
      </div>
      <MetricsTable
        rows={metricTypeRows.map((t) => ({
          id: t.id,
          name: t.name,
          unit: t.unit,
          count: Number(t.count),
          lastAt: t.lastAt,
        }))}
      />
    </div>
  );
}
