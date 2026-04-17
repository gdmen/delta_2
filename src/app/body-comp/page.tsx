import { db } from "@/db";
import { metrics, metricTypes } from "@/db/schema";
import { eq, asc, gte } from "drizzle-orm";
import { MetricTrend } from "@/components/metric-trend";

export const dynamic = "force-dynamic";

interface Series {
  samples: Array<{ date: string; value: number }>;
  unit: string;
}

/** Pull the full history of a metric, no time window. */
async function getAllHistory(metricName: string): Promise<Series> {
  const rows = await db
    .select({ value: metrics.value, recordedAt: metrics.recordedAt, unit: metricTypes.unit })
    .from(metrics)
    .innerJoin(metricTypes, eq(metrics.metricTypeId, metricTypes.id))
    .where(eq(metricTypes.name, metricName))
    .orderBy(asc(metrics.recordedAt));

  return {
    samples: rows.map((r) => ({ date: r.recordedAt, value: r.value })),
    unit: rows[0]?.unit ?? "",
  };
}

/** Pull the last N days of a metric, ordered oldest-to-newest. */
async function getLastDays(metricName: string, days: number): Promise<Series> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceIso = since.toISOString();

  const rows = await db
    .select({ value: metrics.value, recordedAt: metrics.recordedAt, unit: metricTypes.unit })
    .from(metrics)
    .innerJoin(metricTypes, eq(metrics.metricTypeId, metricTypes.id))
    .where(eq(metricTypes.name, metricName))
    .orderBy(asc(metrics.recordedAt));

  return {
    samples: rows
      .filter((r) => r.recordedAt >= sinceIso)
      .map((r) => ({ date: r.recordedAt, value: r.value })),
    unit: rows[0]?.unit ?? "",
  };
}

export default async function BodyCompPage() {
  // DEXA + body composition: fully historical. These are the metrics a DEXA scan
  // produces, plus daily bodyweight. Occasional measurements benefit from a
  // full-history view, not a rolling window.
  const [weight, bodyFat, leanMass, fatMass, boneDensity, visceralFat] = await Promise.all([
    getAllHistory("bodyweight"),
    getAllHistory("body_fat_pct"),
    getAllHistory("lean_mass"),
    getAllHistory("fat_mass"),
    getAllHistory("bone_mineral_density"),
    getAllHistory("visceral_fat_mass"),
  ]);

  // Nutrition: last 30 days. Daily compliance data. Older history isn't
  // actionable - you care about the recent trend.
  const [protein, water] = await Promise.all([
    getLastDays("protein_g", 30),
    getLastDays("water_oz", 30),
  ]);

  return (
    <div className="max-w-[1200px]">
      <h1 className="text-2xl font-semibold mb-8">Body Composition</h1>

      {/* Nutrition - last 30 days. Appears first: these are the daily levers you pull. */}
      <section className="mb-12">
        <div className="flex items-baseline justify-between mb-4 border-b border-border pb-2">
          <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">
            Nutrition
          </h2>
          <span className="font-mono text-[0.6875rem] text-muted">last 30 days</span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <MetricBlock title="Protein" series={protein} fallbackUnit="g" target={180} window="30d" />
          <MetricBlock title="Water" series={water} fallbackUnit="oz" target={100} window="30d" />
        </div>
      </section>

      {/* Historical body composition. Appears below: these are the downstream outcomes. */}
      <section>
        <div className="flex items-baseline justify-between mb-4 border-b border-border pb-2">
          <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">
            Body Composition
          </h2>
          <span className="font-mono text-[0.6875rem] text-muted">full history</span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <MetricBlock title="Weight" series={weight} fallbackUnit="lb" />
          <MetricBlock title="Body Fat %" series={bodyFat} fallbackUnit="%" />
          <MetricBlock title="Lean Mass" series={leanMass} fallbackUnit="lb" />
          <MetricBlock title="Fat Mass" series={fatMass} fallbackUnit="lb" />
          <MetricBlock title="Bone Mineral Density" series={boneDensity} fallbackUnit="g/cm²" />
          <MetricBlock title="Visceral Fat" series={visceralFat} fallbackUnit="lb" />
        </div>
      </section>
    </div>
  );
}

function MetricBlock({
  title,
  series,
  fallbackUnit,
  target,
  window,
}: {
  title: string;
  series: Series;
  fallbackUnit: string;
  target?: number;
  window?: string;
}) {
  const unit = series.unit || fallbackUnit;
  const latest = series.samples[series.samples.length - 1]?.value;
  const first = series.samples[0]?.value;
  const delta = latest !== undefined && first !== undefined ? latest - first : null;

  // Label the delta based on context. "full history" = delta is since first recorded.
  const deltaLabel = window ?? "all time";

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">{title}</h3>
        <div className="flex items-baseline gap-3">
          {latest !== undefined ? (
            <>
              <span className="font-mono text-[1.25rem] font-medium">
                {latest.toFixed(unit === "g/cm²" ? 3 : 1)}{unit}
              </span>
              {delta !== null && series.samples.length > 1 && (
                <span
                  className={`font-mono text-[0.75rem] ${
                    delta > 0 ? "text-accent-green" : delta < 0 ? "text-accent-orange" : "text-muted"
                  }`}
                >
                  {delta > 0 ? "+" : ""}{delta.toFixed(unit === "g/cm²" ? 3 : 1)} / {deltaLabel}
                </span>
              )}
              {target !== undefined && (
                <span className="font-mono text-[0.75rem] text-muted">
                  target {target}{unit}
                </span>
              )}
            </>
          ) : (
            <span className="font-mono text-[0.875rem] text-muted">No data</span>
          )}
        </div>
      </div>
      <MetricTrend samples={series.samples} unit={unit} target={target} height={180} />
    </div>
  );
}
