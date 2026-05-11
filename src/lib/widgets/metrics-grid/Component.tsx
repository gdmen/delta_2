import { MetricBlock } from "@/components/metric-block";
import type { Series } from "@/lib/metric-history";
import { isDataDepError, type WidgetData } from "../types";
import type { MetricsGridConfig } from "./schema";
import { cellKey } from "./keys";

/**
 * Body-Comp-style multi-chart grid. All charts share one x-range computed
 * across all loaded series, so an inflection in one chart visually lines
 * up with the same week in another.
 */
export function MetricsGridComponent({
  config,
  data,
}: {
  config: MetricsGridConfig;
  data: WidgetData;
}) {
  if (config.metrics.length === 0) {
    return (
      <div className="border border-border border-dashed rounded p-4 h-full flex items-center justify-center text-center text-[0.875rem] text-muted">
        No metrics configured. Open the gear to add some.
      </div>
    );
  }

  const seriesByCell: (Series | null)[] = config.metrics.map((c) => {
    if (!c.metric) return null;
    const raw = data.get(cellKey(c));
    if (isDataDepError(raw) || raw === undefined) return null;
    return raw as Series;
  });

  const sharedRange = unionRange(seriesByCell);

  const gridCols =
    config.columns === 1 ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2";

  return (
    <section>
      {config.title && (
        <div className="flex items-baseline justify-between mb-4 border-b border-border pb-2">
          <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">
            {config.title}
          </h2>
        </div>
      )}
      <div className={`grid ${gridCols} gap-8`}>
        {config.metrics.map((c, i) => {
          const s: Series =
            seriesByCell[i] ?? {
              samples: [],
              unit: "",
              target: null,
              higherIsBetter: true,
            };
          return (
            <MetricBlock
              key={`${c.metric}:${i}`}
              title={c.title ?? c.metric}
              metricName={c.metric}
              series={s}
              headline={c.headline}
              xMin={sharedRange?.min}
              xMax={sharedRange?.max}
            />
          );
        })}
      </div>
    </section>
  );
}

function unionRange(
  seriesList: (Series | null)[],
): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const s of seriesList) {
    if (!s) continue;
    for (const sample of s.samples) {
      const ts = new Date(sample.date).getTime();
      if (Number.isFinite(ts)) {
        if (ts < min) min = ts;
        if (ts > max) max = ts;
      }
    }
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}
