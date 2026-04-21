import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { metrics, metricTypes } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { MetricHistoryEditor } from "./editor";

export const dynamic = "force-dynamic";

export default async function MetricHistoryPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);

  const typeRows = await db
    .select()
    .from(metricTypes)
    .where(eq(metricTypes.name, decoded))
    .limit(1);
  if (typeRows.length === 0) notFound();
  const type = typeRows[0];

  const rows = await db
    .select({
      id: metrics.id,
      value: metrics.value,
      recordedAt: metrics.recordedAt,
      source: metrics.source,
      sourceId: metrics.sourceId,
    })
    .from(metrics)
    .where(eq(metrics.metricTypeId, type.id))
    .orderBy(desc(metrics.recordedAt))
    .limit(1000);

  return (
    <div className="max-w-[940px]">
      <Link href="/data" className="text-[0.8125rem] text-muted hover:text-foreground">
        ← Data
      </Link>
      <div className="flex items-baseline justify-between mt-3 mb-2 gap-3">
        <h1 className="text-2xl font-semibold font-mono">{type.name}</h1>
        <span className="font-mono text-[0.6875rem] text-muted">
          {rows.length.toLocaleString()} row{rows.length === 1 ? "" : "s"}
          {type.unit && ` · unit: ${type.unit}`}
        </span>
      </div>
      <p className="text-[0.875rem] text-text-secondary mb-6">
        All measurements for this metric, across every source. Edits to
        source-imported rows may be overwritten on the next sync.
      </p>
      <MetricHistoryEditor metricTypeId={type.id} unit={type.unit} initialRows={rows} />
    </div>
  );
}
