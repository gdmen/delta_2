import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { metrics, metricTypes, metricTypeAliases } from "@/db/schema";
import { asc, desc, eq, sql } from "drizzle-orm";
import { MetricHistoryEditor } from "./editor";
import { AliasesSection } from "./aliases-section";
import { PaginationControls } from "@/components/pagination-controls";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

interface SearchParams {
  page?: string;
}

export default async function MetricHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { name } = await params;
  const sp = await searchParams;
  const decoded = decodeURIComponent(name);
  const requestedPage = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const typeRows = await db
    .select()
    .from(metricTypes)
    .where(eq(metricTypes.name, decoded))
    .limit(1);
  if (typeRows.length === 0) notFound();
  const type = typeRows[0];

  const totalRow = await db
    .select({ c: sql<number>`count(*)` })
    .from(metrics)
    .where(eq(metrics.metricTypeId, type.id));
  const total = Number(totalRow[0]?.c ?? 0);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(requestedPage, pageCount);

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
    .limit(PAGE_SIZE)
    .offset((currentPage - 1) * PAGE_SIZE);

  const aliases = await db
    .select({ alias: metricTypeAliases.alias })
    .from(metricTypeAliases)
    .where(eq(metricTypeAliases.canonicalMetricTypeId, type.id))
    .orderBy(asc(metricTypeAliases.alias));

  const linkWithPage = (p: number) => {
    const base = `/data/metrics/${encodeURIComponent(decoded)}`;
    return p === 1 ? base : `${base}?page=${p}`;
  };

  return (
    <div className="max-w-[940px]">
      <Link href="/data" className="text-[0.8125rem] text-muted hover:text-foreground">
        ← Data
      </Link>
      <div className="flex items-baseline justify-between mt-3 mb-2 gap-3">
        <h1 className="text-2xl font-semibold font-mono">{type.name}</h1>
        <span className="font-mono text-[0.6875rem] text-muted">
          {total.toLocaleString()} total
          {pageCount > 1 && ` · page ${currentPage} of ${pageCount}`}
          {type.unit && ` · unit: ${type.unit}`}
        </span>
      </div>
      <p className="text-[0.875rem] text-text-secondary mb-6">
        All measurements for this metric, across every source. Edits to
        source-imported rows may be overwritten on the next sync.
      </p>
      <AliasesSection
        metricTypeId={type.id}
        initialAliases={aliases.map((a) => a.alias)}
      />
      <PaginationControls
        currentPage={currentPage}
        pageCount={pageCount}
        linkWithPage={linkWithPage}
        className="mb-4"
      />
      <MetricHistoryEditor metricTypeId={type.id} unit={type.unit} initialRows={rows} />
      <PaginationControls
        currentPage={currentPage}
        pageCount={pageCount}
        linkWithPage={linkWithPage}
        className="mt-4"
      />
    </div>
  );
}
