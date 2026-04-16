import { db } from "@/db";
import { metrics, metricTypes } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { MetricTrend } from "@/components/metric-trend";

export const dynamic = "force-dynamic";

async function getMetricSeries(metricName: string, days = 90) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const rows = await db
    .select({ value: metrics.value, recordedAt: metrics.recordedAt, unit: metricTypes.unit })
    .from(metrics)
    .innerJoin(metricTypes, eq(metrics.metricTypeId, metricTypes.id))
    .where(eq(metricTypes.name, metricName))
    .orderBy(desc(metrics.recordedAt))
    .limit(500);

  const samples = rows
    .filter((r) => new Date(r.recordedAt) >= since)
    .map((r) => ({ date: r.recordedAt, value: r.value }))
    .reverse();

  return { samples, unit: rows[0]?.unit ?? "" };
}

export default async function BodyCompPage() {
  const [weight, bodyFat, leanMass, protein, water] = await Promise.all([
    getMetricSeries("bodyweight"),
    getMetricSeries("body_fat_pct"),
    getMetricSeries("lean_mass"),
    getMetricSeries("protein_g"),
    getMetricSeries("water_oz"),
  ]);

  return (
    <div className="max-w-[1200px]">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold mb-2">Body Composition</h1>
        <p className="text-[0.875rem] text-text-secondary">
          Weight, body fat, and lean mass trends. Daily protein and water compliance. Last 90 days.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <MetricBlock title="Weight" samples={weight.samples} unit={weight.unit || "lb"} />
        <MetricBlock title="Body Fat %" samples={bodyFat.samples} unit={bodyFat.unit || "%"} />
        <MetricBlock title="Lean Mass" samples={leanMass.samples} unit={leanMass.unit || "lb"} />
        <MetricBlock title="Protein" samples={protein.samples} unit={protein.unit || "g"} target={180} />
        <MetricBlock title="Water" samples={water.samples} unit={water.unit || "oz"} target={100} />
      </div>
    </div>
  );
}

function MetricBlock({
  title,
  samples,
  unit,
  target,
}: {
  title: string;
  samples: Array<{ date: string; value: number }>;
  unit: string;
  target?: number;
}) {
  const latest = samples[samples.length - 1]?.value;
  const first = samples[0]?.value;
  const delta = latest !== undefined && first !== undefined ? latest - first : null;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">{title}</h2>
        <div className="flex items-baseline gap-3">
          {latest !== undefined ? (
            <>
              <span className="font-mono text-[1.25rem] font-medium">{latest.toFixed(1)}{unit}</span>
              {delta !== null && (
                <span className={`font-mono text-[0.75rem] ${delta > 0 ? "text-accent-green" : delta < 0 ? "text-accent-orange" : "text-muted"}`}>
                  {delta > 0 ? "+" : ""}{delta.toFixed(1)} / 90d
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
      <MetricTrend samples={samples} unit={unit} target={target} height={180} />
    </div>
  );
}
