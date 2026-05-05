import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  eventMetrics,
  goals,
  metrics,
  metricTypes,
  metricTypeAliases,
  workoutSets,
} from "@/db/schema";
import { asc, desc, eq, sql } from "drizzle-orm";
import { MetricHistoryEditor } from "./editor";
import { AliasesSection } from "./aliases-section";
import { MetricTargetEditor } from "./target-editor";
import { DeleteMetricTypeButton } from "./delete-button";
import { PaginationControls } from "@/components/pagination-controls";
import { describeComputedSource, matchComputed } from "@/lib/computed-metrics";

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

  // Computed metric (read-time synthesized from underlying tables — see
  // src/lib/computed-metrics.ts). The metric_types row exists for catalog
  // / goal-target purposes but holds no metrics rows; the per-row editor
  // is hidden and we render an explanatory banner instead.
  const computed = matchComputed(decoded);
  const computedDescription = computed ? describeComputedSource(decoded) : null;

  // Synthesized count (per-rep readings derived from workout_sets, see
  // src/lib/metric-history.ts). Surface separately so the count on this
  // page matches the count on /data without pretending the readings are
  // editable here — they're not, the user has to edit the underlying set.
  const synthRow = await db
    .select({
      reps: sql<number>`coalesce(sum(${workoutSets.reps}), 0)`,
    })
    .from(workoutSets)
    .where(eq(workoutSets.exerciseMetricTypeId, type.id));
  const synthCount = Number(synthRow[0]?.reps ?? 0);

  // Reference counts that gate deletion. The DELETE endpoint repeats
  // these checks server-side, but we use them here to decide whether
  // to render the delete button at all.
  const [wsRefRow, emRefRow, goalRefRow] = await Promise.all([
    db.select({ c: sql<number>`count(*)` }).from(workoutSets).where(eq(workoutSets.exerciseMetricTypeId, type.id)),
    db.select({ c: sql<number>`count(*)` }).from(eventMetrics).where(eq(eventMetrics.metricTypeId, type.id)),
    db.select({ c: sql<number>`count(*)` }).from(goals).where(eq(goals.metricTypeId, type.id)),
  ]);
  const refCounts = {
    metrics: total,
    workoutSets: Number(wsRefRow[0]?.c ?? 0),
    eventMetrics: Number(emRefRow[0]?.c ?? 0),
    goals: Number(goalRefRow[0]?.c ?? 0),
  };
  const isDeletable =
    refCounts.metrics === 0 &&
    refCounts.workoutSets === 0 &&
    refCounts.eventMetrics === 0 &&
    refCounts.goals === 0;

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
          {computed ? (
            <>computed</>
          ) : (
            <>
              {total.toLocaleString()} stored
              {synthCount > 0 && ` · ${synthCount.toLocaleString()} from sets`}
              {pageCount > 1 && ` · page ${currentPage} of ${pageCount}`}
            </>
          )}
          {type.unit && ` · unit: ${type.unit}`}
        </span>
      </div>
      {computed ? (
        <p className="mb-6 text-[0.875rem] text-text-secondary">
          Computed at read time. This metric has no stored rows; values are
          synthesized from underlying tables on each query.
        </p>
      ) : (
        <p className="text-[0.875rem] text-text-secondary mb-6">
          All measurements for this metric, across every source. Edits to
          source-imported rows may be overwritten on the next sync.
        </p>
      )}
      {computedDescription && (
        <p className="mb-6 text-[0.8125rem] text-muted border-l-2 border-border pl-3">
          Source: {computedDescription}. Not editable from this page — change
          the underlying data ({computed?.family.startsWith("sport_") ? "events" : "workout sets"})
          and the value will update on the next read.
        </p>
      )}
      {!computed && synthCount > 0 && (
        <p className="mb-6 text-[0.8125rem] text-muted border-l-2 border-border pl-3">
          {synthCount.toLocaleString()} additional readings are synthesized at
          read time from workout_sets (one reading per rep, value = added
          weight). They drive charts and goal progress but are not editable
          from this page — edit the underlying sets via the{" "}
          <Link href="/data/exercises" className="underline hover:text-foreground">
            exercises tab
          </Link>
          .
        </p>
      )}
      <MetricTargetEditor
        metricTypeId={type.id}
        unit={type.unit}
        initialTarget={type.target}
        initialHigherIsBetter={type.higherIsBetter}
      />
      {!computed && (
        <AliasesSection
          metricTypeId={type.id}
          initialAliases={aliases.map((a) => a.alias)}
        />
      )}
      {!computed && (
        <PaginationControls
          currentPage={currentPage}
          pageCount={pageCount}
          linkWithPage={linkWithPage}
          className="mb-4"
        />
      )}
      {!computed && (
        // key forces a remount when paginating — the editor uses useState
        // to host optimistic edits, so without a key change it keeps showing
        // page 1's rows after navigation.
        <MetricHistoryEditor
          key={`${type.id}-${currentPage}`}
          metricTypeId={type.id}
          unit={type.unit}
          initialRows={rows}
        />
      )}
      {!computed && (
        <PaginationControls
          currentPage={currentPage}
          pageCount={pageCount}
          linkWithPage={linkWithPage}
          className="mt-4"
        />
      )}
      {isDeletable && (
        <DeleteMetricTypeButton metricTypeId={type.id} metricName={type.name} />
      )}
    </div>
  );
}
